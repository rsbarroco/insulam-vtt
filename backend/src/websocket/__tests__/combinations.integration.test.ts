/**
 * Features of different classes that answer the same roll, over the socket:
 * the questions asked after an attack roll, a save or a check, in the order
 * the server asks them, with what each spends and what the summary keeps.
 * Prompts are answered by the text of their options, not by their order.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson } from '../../utils/prisma-json';
import { createWsTestServer, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { clearState, getState, setState, type CombatantEntry } from '../initiativeState';
import * as d20 from '../../rules/dnd/d20';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);
let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let mapId: string;
let heroCharacterId: string;
let foeCharacterId: string;
let dm: ClientSocket;
let player: ClientSocket;

const HERO = randomUUID();
const OGRE = randomUUID();
const ALLY = randomUUID();
const FOE = randomUUID();

interface Answer {
  ok: boolean;
  error?: string;
  summary?: string;
  targets?: Array<{ tokenId: string; saved: boolean; total: number | null; dealt: number }>;
  hit?: boolean;
  dealt?: number;
  total?: number;
  success?: boolean | null;
}
const ask = (socket: ClientSocket, event: string, payload: unknown) =>
  new Promise<Answer>((resolve) => socket.emit(event, payload, resolve));

const token = (id: string, name: string, x: number, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  imageUrl: '',
  position: { x, y: 1 },
  size: { width: 1, height: 1 },
  layer: 'token',
  visible: true,
  controlledBy: null,
  rotation: 0,
  conditions: [],
  metadata: {},
  ...extra,
});
const ogreBlock = {
  ac: 11,
  abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
  actions: [
    { name: 'Greatclub', description: 'Melee Attack Roll: +6, reach 5 ft. Hit: 13 (2d8 + 4) Bludgeoning damage.' },
    {
      name: 'Dread Roar',
      description: 'Wisdom Saving Throw: DC 13, each creature within 30 feet. Failure: The target has the Frightened condition until the end of its next turn.',
    },
    {
      name: 'Mind Blast',
      description: 'Wisdom Saving Throw: DC 30, each creature within 30 feet. Failure: 20 (4d8 + 4) Psychic damage. Success: Half damage.',
    },
    {
      name: 'Terror Wave',
      description:
        'Wisdom Saving Throw: DC 13, each creature within 30 feet. Failure: 9 (2d8) Psychic damage, and the target has the Frightened condition until the end of its next turn. Success: Half damage.',
    },
  ],
};
// The Hero is the player's; the Foe is a character the DM runs, on the other side, 5 feet from the Hero.
const freshTokens = () => [
  token(HERO, 'Hero', 1, { controlledBy: playerId, characterId: heroCharacterId, type: 'player' }),
  token(OGRE, 'Ogre', 2, { hp: { current: 59, max: 59, temp: 0 }, statBlock: ogreBlock }),
  token(ALLY, 'Ally', 3, { type: 'player', hp: { current: 10, max: 10, temp: 0 }, statBlock: ogreBlock }),
  token(FOE, 'Foe', 1, { position: { x: 1, y: 2 }, characterId: foeCharacterId, type: 'npc', disposition: 'hostile' }),
];
const sheet = (cls: string, level: number, features: string[] = [], more: Record<string, unknown> = {}) => ({
  class: cls,
  level,
  featuresAndTraits: features.map((name) => ({ name, description: '' })),
  hp: { current: 30, maximum: 30, temporary: 0 },
  armorClass: 16,
  savingThrows: {
    strength: { bonus: 2 },
    dexterity: { bonus: 4 },
    constitution: { bonus: 2 },
    intelligence: { bonus: 0 },
    wisdom: { bonus: 1 },
    charisma: { bonus: 0 },
  },
  attacks: [
    { name: 'Longsword', attackBonus: 5, damageRoll: '1d8+3', damageType: 'slashing' },
    { name: 'Rapier', attackBonus: 6, damageRoll: '1d8+3', damageType: 'piercing' },
  ],
  proficiencyBonus: 3,
  stats: { strength: { score: 16, modifier: 3 }, wisdom: { score: 12, modifier: 1 }, charisma: { score: 16, modifier: 3 } },
  skills: { stealth: { proficient: true, expertise: false, bonus: 6 } },
  spellcasting: {
    spellAttackBonus: 6,
    spellSaveDC: 14,
    cantrips: ['Fire Bolt'],
    spells: [{ name: 'Fireball', level: 3, prepared: true, ritual: false, concentration: false }],
    slots: { '1': { total: 2, expended: 0 }, '3': { total: 2, expended: 0 } },
  },
  ...more,
});
const withSpells = (base: ReturnType<typeof sheet>, ...names: string[]) => ({
  ...base,
  spellcasting: { ...base.spellcasting, spells: [...base.spellcasting.spells, ...names.map((name) => ({ name, level: 1, prepared: true, ritual: false, concentration: false }))] },
});

let rolls: number[] = [];

beforeAll(async () => {
  dmId = (await prisma.user.create({ data: { email: `combos-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' } })).id;
  playerId = (await prisma.user.create({ data: { email: `combos-player-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Player' } })).id;
  campaignId = (await prisma.campaign.create({ data: { name: `Combinations ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' } })).id;
  heroCharacterId = (
    await prisma.character.create({ data: { userId: playerId, campaignId, name: 'Hero', gameSystem: 'DND_5E', data: toJson(sheet('Fighter', 1)) } })
  ).id;
  foeCharacterId = (
    await prisma.character.create({ data: { userId: dmId, campaignId, name: 'Foe', gameSystem: 'DND_5E', data: toJson(sheet('Fighter', 1)) } })
  ).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [heroCharacterId] },
    ],
  });
  mapId = (
    await prisma.map.create({
      data: {
        campaignId,
        name: 'Combinations',
        imageUrl: '/api/assets/maps/x',
        baseLayerUrl: '/api/assets/maps/x',
        width: 10,
        height: 10,
        gridSize: 50,
        annotations: [],
        fogEnabled: false,
        tokens: toJson(freshTokens()),
      },
    })
  ).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId, status: 'ACTIVE' } });
  server = await createWsTestServer();
});

beforeEach(async () => {
  clearState(campaignId);
  await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(freshTokens()) } });
  await setSheet(heroCharacterId, sheet('Fighter', 1));
  await setSheet(foeCharacterId, sheet('Fighter', 1));
  // The dice come up as the test says, in the order the server rolls them.
  rolls = [];
  jest.spyOn(d20, 'rollDie').mockImplementation((sides: number) => rolls.shift() ?? Math.ceil(sides / 2));
  dm = await server.connectAndAuth(await server.loginAs(dmId), campaignId);
  player = await server.connectAndAuth(await server.loginAs(playerId), campaignId);
});
afterEach(() => {
  jest.restoreAllMocks();
  dm.disconnect();
  player.disconnect();
});

afterAll(async () => {
  await server.close();
  clearState(campaignId);
  await prisma.diceRoll.deleteMany({ where: { campaignId } });
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await prisma.map.deleteMany({ where: { campaignId } });
  await prisma.character.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: { in: [dmId, playerId] } } });
  await prisma.$disconnect();
});

const entry = (tokenId: string, name: string, initiative: number): CombatantEntry => ({
  tokenId,
  mapId,
  name,
  imageUrl: '',
  initiative,
  hp: null,
  type: 'npc',
  disposition: null,
});
const fight = (currentTokenId: string = OGRE) =>
  setState(campaignId, {
    active: true,
    round: 1,
    currentTokenId,
    combatants: [entry(HERO, 'Hero', 18), entry(ALLY, 'Ally', 12), entry(OGRE, 'Ogre', 9), entry(FOE, 'Foe', 5)],
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0 },
  });
async function setSheet(characterId: string, data: Record<string, unknown>) {
  await prisma.character.update({ where: { id: characterId }, data: { data: toJson(data) } });
}
const setTokens = (change: (entry: ReturnType<typeof token>) => Record<string, unknown>) =>
  prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(freshTokens().map(change)) } });
const tokenNow = async (id: string) =>
  ((await prisma.map.findUnique({ where: { id: mapId } }))!.tokens as unknown as Array<ReturnType<typeof token>>).find((t) => t.id === id)!;
const sheetNow = async (characterId: string) =>
  (await prisma.character.findUnique({ where: { id: characterId } }))!.data as {
    featureUses?: Record<string, number>;
    inspiration?: boolean;
    spellcasting: { slots: Record<string, { expended: number }> };
  };
const used = async (characterId: string, name: string) => (await sheetNow(characterId)).featureUses?.[name] ?? 0;
const actionIndex = async (socket: ClientSocket, tokenId: string, name: string) => {
  const listed = (await ask(socket, 'combat.actions', { tokenId })) as unknown as { actions: Array<{ index: number; name: string }> };
  return listed.actions.find((action) => action.name === name)!.index;
};
interface Offer {
  promptId: string;
  tokenName: string;
  text: string;
  options: string[];
}
/** Answer every question the socket is asked with the first option that starts with one of `wanted` (none otherwise); what was asked comes back. */
const answering = (socket: ClientSocket, wanted: string[]): Offer[] => {
  const offers: Offer[] = [];
  socket.on('combat.prompt', (offer: Offer) => {
    offers.push(offer);
    const choice = offer.options.find((option) => wanted.some((want) => option.startsWith(want))) ?? null;
    socket.emit('combat.react', { promptId: offer.promptId, choice }, () => undefined);
  });
  return offers;
};
const optionsOf = (offers: Offer[]) => offers.map((offer) => offer.options);
const heldDie = () => ({ bardicInspiration: { sides: 8, from: 'Bard', until: Date.now() + 3_600_000 } });

describe('a failed save answered by several features of one creature', () => {
  it('Indomitable, Bardic Inspiration, Stroke of Luck and Superior Hunter’s Defense each keep what the last one did', async () => {
    fight();
    await setSheet(heroCharacterId, sheet('Fighter/Rogue/Ranger', 20, [], { subclass: 'Hunter' }));
    await setTokens((t) => (t.id === HERO ? { ...t, metadata: heldDie() } : t));
    const offers = answering(player, ['Indomitable', 'Bardic Inspiration', 'Stroke of Luck', "Superior Hunter's Defense"]);
    // 4d8 + 4 = 20 Psychic. The save: 2 + 1 = 3; Indomitable, 3 + 1 + 20 = 24; the d8 adds 4: 28; Stroke of Luck: 45 saves, half is 10, resisted 5.
    rolls = [4, 4, 4, 4, 2, 3, 4];
    const blast = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [HERO], action: await actionIndex(dm, OGRE, 'Mind Blast') });
    expect(optionsOf(offers)).toEqual([['Indomitable'], ['Bardic Inspiration'], ['Stroke of Luck'], ["Superior Hunter's Defense (psychic)"]]);
    expect(blast.targets?.[0]).toMatchObject({ saved: true, total: 45, dealt: 5 });
    expect(blast.summary).toContain('Hero fails (3), Indomitable: fails (24), Bardic Inspiration +4: fails (28), Stroke of Luck, the d20 becomes a 20: saves (45), 5 damage');
    expect(blast.summary).toContain("Hero resists psychic damage until the turn ends (Superior Hunter's Defense)");
    expect(await used(heroCharacterId, 'Indomitable')).toBe(1);
    expect(await used(heroCharacterId, 'Stroke of Luck')).toBe(1);
    expect((await tokenNow(HERO)).metadata).toEqual({});
    expect(getState(campaignId).reactionsSpent).toEqual([HERO]);

    // Undone, the save gives back every use it spent.
    expect((await ask(dm, 'combat.undo', {})).ok).toBe(true);
    expect(await used(heroCharacterId, 'Indomitable')).toBe(0);
    expect(await used(heroCharacterId, 'Stroke of Luck')).toBe(0);
  });

  it('keeps Empowered Spell in the summary after the target rolls again with Indomitable', async () => {
    fight(HERO);
    await setSheet(heroCharacterId, sheet('Sorcerer', 5, ['Empowered Spell']));
    await setSheet(foeCharacterId, sheet('Fighter', 9));
    const asked = answering(player, ['Empowered Spell']);
    const foeAsked = answering(dm, ['Indomitable']);
    // 8d6 of 1s; the Foe's 2 + 4 fails DC 14; three 1s become 6s: 23; Indomitable, 3 + 4 + 9 = 16 saves: 11.
    rolls = [1, 1, 1, 1, 1, 1, 1, 1, 2, 6, 6, 6, 3];
    const cast = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [FOE], action: await actionIndex(player, HERO, 'Fireball'), slotLevel: 3 });
    expect(optionsOf(asked)).toEqual([['Empowered Spell']]);
    expect(optionsOf(foeAsked)).toEqual([['Indomitable']]);
    expect(cast.targets?.[0]).toMatchObject({ saved: true, dealt: 11 });
    expect(cast.summary).toContain('Foe fails (6), Indomitable: saves (16), 11 damage');
    expect(cast.summary).toContain('Empowered Spell');
    expect(await used(heroCharacterId, 'Sorcery Points')).toBe(1);
    expect(await used(foeCharacterId, 'Indomitable')).toBe(1);
  });
});

describe('Shield, and the attacker turning the miss back into a hit', () => {
  const mage = () => withSpells(sheet('Wizard/Rogue', 5, ['Uncanny Dodge']), 'Shield');
  const longsword = async () => ask(player, 'combat.attack', { attackerId: HERO, targetId: FOE, action: await actionIndex(player, HERO, 'Longsword') });

  it('Heroic Inspiration: Shield is not asked again, its slot is spent once, and the target has no reaction left for Uncanny Dodge', async () => {
    fight(HERO);
    await setSheet(heroCharacterId, sheet('Fighter', 1, [], { inspiration: true }));
    await setSheet(foeCharacterId, mage());
    const heroAsked = answering(player, ['Heroic Inspiration']);
    const foeAsked = answering(dm, ['Shield', 'Uncanny Dodge']);
    // 11 + 5 = 16 hits AC 16, and misses AC 21; rolled again, 18 + 5 = 23 hits: 5 + 3 slashing.
    rolls = [11, 4, 18, 5];
    const swing = await longsword();
    expect(optionsOf(foeAsked)).toEqual([['Shield (level 1 slot)']]);
    expect(optionsOf(heroAsked)).toEqual([['Heroic Inspiration']]);
    expect(swing).toMatchObject({ ok: true, hit: true, dealt: 8 });
    expect(swing.summary).toContain('Shield (level 1 slot): +5 AC');
    expect(swing.summary).toContain('Heroic Inspiration: the d20 is rolled again');
    expect((await sheetNow(foeCharacterId)).spellcasting.slots['1'].expended).toBe(1);
    expect((await sheetNow(heroCharacterId)).inspiration).toBe(false);
    expect(getState(campaignId).reactionsSpent).toEqual([FOE]);
  });

  it('Bardic Inspiration: the die that beats the Shield stands, and Shield is not asked again', async () => {
    fight(HERO);
    await setSheet(foeCharacterId, mage());
    await setTokens((t) => (t.id === HERO ? { ...t, metadata: heldDie() } : t));
    const heroAsked = answering(player, ['Bardic Inspiration']);
    const foeAsked = answering(dm, ['Shield', 'Uncanny Dodge']);
    // 16 hits AC 16; Shield: AC 21; the d8 adds 6: 22 hits; 5 + 3.
    rolls = [11, 4, 6, 5];
    const swing = await longsword();
    expect(optionsOf(foeAsked)).toEqual([['Shield (level 1 slot)']]);
    expect(optionsOf(heroAsked)).toEqual([['Bardic Inspiration']]);
    expect(swing).toMatchObject({ ok: true, hit: true, dealt: 8 });
    expect(swing.summary).toContain('Shield (level 1 slot): +5 AC');
    expect(swing.summary).toContain('Bardic Inspiration +6');
    expect((await sheetNow(foeCharacterId)).spellcasting.slots['1'].expended).toBe(1);
  });

  it('Seeking Spell after a Shield keeps the Shield in the line', async () => {
    fight(HERO);
    await setSheet(heroCharacterId, sheet('Sorcerer', 5, ['Seeking Spell']));
    await setSheet(foeCharacterId, mage());
    answering(player, ['Seeking Spell']);
    const foeAsked = answering(dm, ['Shield']);
    // Fire Bolt: 12 + 6 = 18 hits AC 16, misses AC 21; Seeking Spell rolls 17: 23 hits; 2d10 of 4s.
    rolls = [12, 3, 3, 17, 4, 4];
    const bolt = await ask(player, 'combat.attack', { attackerId: HERO, targetId: FOE, action: await actionIndex(player, HERO, 'Fire Bolt') });
    expect(optionsOf(foeAsked)).toEqual([['Shield (level 1 slot)']]);
    expect(bolt).toMatchObject({ ok: true, hit: true, dealt: 8 });
    expect(bolt.summary).toContain('Shield (level 1 slot): +5 AC');
    expect(bolt.summary).toContain('Seeking Spell');
    expect(await used(heroCharacterId, 'Sorcery Points')).toBe(1);
  });

  it('Peerless Skill that a Shield then turns back into a miss keeps its use', async () => {
    fight(HERO);
    await setSheet(heroCharacterId, sheet('Bard', 14, ['Peerless Skill']));
    await setSheet(foeCharacterId, mage());
    const heroAsked = answering(player, ['Peerless Skill']);
    const foeAsked = answering(dm, ['Shield']);
    // 6 + 5 = 11 misses AC 16; the d10 adds 7: 18 hits; Shield: AC 21, a miss.
    rolls = [6, 7, 4];
    const swing = await longsword();
    expect(optionsOf(heroAsked)).toEqual([['Peerless Skill']]);
    expect(optionsOf(foeAsked)).toEqual([['Shield (level 1 slot)']]);
    expect(swing).toMatchObject({ ok: true, hit: false, dealt: 0 });
    expect(await used(heroCharacterId, 'Bardic Inspiration')).toBe(0);
    expect((await sheetNow(foeCharacterId)).spellcasting.slots['1'].expended).toBe(1);
  });
});

describe('Cutting Words against a hit that had more to come', () => {
  it('spends neither the Sneak Attack of the turn, a Divine Smite slot nor the Bonus Action when it turns the hit into a miss', async () => {
    fight(HERO);
    await setSheet(heroCharacterId, withSpells(sheet('Paladin/Rogue', 5, ['Extra Attack']), 'Divine Smite'));
    await setSheet(foeCharacterId, sheet('Bard', 5, ['Cutting Words']));
    const heroAsked = answering(player, ['Divine Smite (level 1)']);
    const bardAsked = answering(dm, ['Cutting Words (attack roll)']);
    const rapier = await actionIndex(player, HERO, 'Rapier');
    // 8 + 6 = 14 hits AC 11 (the Ally beside the Ogre: Sneak Attack); the Bard's d8 takes 5 off: 9 misses.
    rolls = [8, 4, 1, 1, 1, 5];
    const first = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: rapier });
    expect(optionsOf(bardAsked)).toEqual([['Cutting Words (attack roll)']]);
    expect(first).toMatchObject({ ok: true, hit: false, dealt: 0 });
    expect(first.summary).toContain("Foe's Cutting Words -5");
    expect(first.summary).not.toContain('Sneak Attack');
    expect(heroAsked).toHaveLength(0);
    expect(await used(foeCharacterId, 'Bardic Inspiration')).toBe(1);

    // The second attack of the turn still has its Sneak Attack, a slot for Divine Smite and the Bonus Action.
    rolls = [15, 4, 2, 2, 2, 3, 3];
    const second = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: rapier });
    expect(second).toMatchObject({ ok: true, hit: true });
    expect(second.summary).toContain('Sneak Attack (3d6)');
    expect(second.summary).toContain('Divine Smite (level 1)');
    expect(optionsOf(heroAsked).flat()).toContain('Divine Smite (level 1)');
    expect(bardAsked).toHaveLength(1);
    expect((await sheetNow(heroCharacterId)).spellcasting.slots['1'].expended).toBe(1);
  });

  it('turning a check that Tactical Mind made a success back into a failure keeps the use of Second Wind', async () => {
    fight(HERO);
    await setSheet(heroCharacterId, sheet('Fighter', 14, ['Tactical Mind']));
    await setSheet(foeCharacterId, sheet('Bard', 5, ['Cutting Words']));
    const heroAsked = answering(player, ['Tactical Mind']);
    answering(dm, ['Cutting Words']);
    // 3 + 6 = 9 fails DC 15; Tactical Mind adds 7: 16; the Bard's d8 takes 5 off: 11, a failure.
    rolls = [3, 7, 5];
    const check = await ask(player, 'combat.check', { tokenId: HERO, skill: 'stealth', dc: 15 });
    expect(optionsOf(heroAsked)).toEqual([['Tactical Mind']]);
    expect(check).toMatchObject({ ok: true, total: 11, success: false });
    expect(await used(heroCharacterId, 'Second Wind')).toBe(0);
    expect(await used(foeCharacterId, 'Bardic Inspiration')).toBe(1);
  });
});

describe('Countercharm with other features on the same save', () => {
  const roar = async (targetId: string) => ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [targetId], action: await actionIndex(dm, OGRE, 'Dread Roar') });

  it('is not asked for a creature an Aura of Courage keeps from being Frightened, and is asked outside the aura', async () => {
    fight();
    await setSheet(heroCharacterId, sheet('Bard/Paladin', 10, ['Aura of Courage']));
    const asked = answering(player, ['Countercharm']);
    // The Ally, 10 feet from the Paladin, fails: 5 - 2 = 3.
    rolls = [5];
    const inAura = await roar(ALLY);
    expect(asked).toHaveLength(0);
    expect(inAura.targets?.[0]).toMatchObject({ saved: false });
    expect(inAura.summary).toContain("Ally is immune to the Frightened condition (Hero's Aura of Courage)");
    expect(getState(campaignId).reactionsSpent).toEqual([]);

    // 20 feet away, out of the aura and within 30 feet of the Bard: asked, and rolled again with Advantage.
    await setTokens((t) => (t.id === ALLY ? { ...t, position: { x: 5, y: 1 } } : t));
    rolls = [5, 16, 8];
    const outside = await roar(ALLY);
    expect(optionsOf(asked)).toEqual([['Countercharm']]);
    expect(outside.targets?.[0]).toMatchObject({ saved: true, total: 14 });
    expect(getState(campaignId).reactionsSpent).toEqual([HERO]);
  });

  it('a Bard that took Countercharm for itself is not asked about Superior Hunter’s Defense with the same reaction', async () => {
    fight();
    await setSheet(heroCharacterId, sheet('Bard/Ranger', 15, [], { subclass: 'Hunter' }));
    const asked = answering(player, ['Countercharm', "Superior Hunter's Defense"]);
    // 2d8 of 4s; 2 + 1 = 3 fails; again with Advantage, 3 and 4: 5 fails: 8 Psychic.
    rolls = [4, 4, 2, 3, 4];
    const wave = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [HERO], action: await actionIndex(dm, OGRE, 'Terror Wave') });
    expect(optionsOf(asked)).toEqual([['Countercharm']]);
    expect(wave.targets?.[0]).toMatchObject({ saved: false, dealt: 8 });
    expect(getState(campaignId).reactionsSpent).toEqual([HERO]);
  });
});

describe('a Sorcerer’s Fire Bolt and an Evoker’s', () => {
  it('Transmuted Spell, then Elemental Affinity of the new type, then Empowered Spell on the dice', async () => {
    fight(HERO);
    await setSheet(heroCharacterId, sheet('Sorcerer', 5, ['Elemental Affinity: Cold (Sorcerer 6)', 'Transmuted Spell', 'Empowered Spell']));
    const asked = answering(player, ['Empowered Spell']);
    // 15 + 6 hits AC 11; 2d10 of 1 and 2, + 3 Cold; both dice rolled again: 9 and 8, + 3.
    rolls = [15, 1, 2, 9, 8];
    const bolt = await ask(player, 'combat.attack', {
      attackerId: HERO,
      targetId: OGRE,
      action: await actionIndex(player, HERO, 'Fire Bolt'),
      metamagic: { option: 'transmuted', damageType: 'cold' },
    });
    expect(optionsOf(asked)).toEqual([['Empowered Spell']]);
    expect(asked[0].text).toContain('for 6 damage');
    expect(bolt).toMatchObject({ ok: true, hit: true, dealt: 20 });
    expect(bolt.summary).toContain('20 cold damage');
    expect(bolt.summary).toContain('Empowered Spell');
    expect(await used(heroCharacterId, 'Sorcery Points')).toBe(2);
  });

  it('a Potent Cantrip miss asks a Lore Bard nothing', async () => {
    fight(HERO);
    await setSheet(heroCharacterId, sheet('Wizard', 14, ['Potent Cantrip']));
    await setSheet(foeCharacterId, sheet('Bard', 5, ['Cutting Words']));
    const bardAsked = answering(dm, ['Cutting Words']);
    // 2 + 6 misses AC 11; 3d10 of 7, 4 and 4: half of 15.
    rolls = [2, 7, 4, 4];
    const bolt = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await actionIndex(player, HERO, 'Fire Bolt') });
    expect(bolt).toMatchObject({ ok: true, hit: false, dealt: 7 });
    expect(bardAsked).toHaveLength(0);
    expect(await used(foeCharacterId, 'Bardic Inspiration')).toBe(0);
  });
});
