/**
 * Spells cast as a Reaction over the socket: Shield asked once a hit is known
 * and before its damage, Counterspell as a spell is cast, Hellish Rebuke once
 * damage is dealt, Feather Fall on a fall. Each spends its slot and the
 * reaction only when taken.
 *
 * The fixtures are those of deflectAttacks.integration.test.ts.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson } from '../../utils/prisma-json';
import { createWsTestServer, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { advanceTurn, clearState, getState, setState, type CombatantEntry } from '../initiativeState';
import * as d20 from '../../rules/dnd/d20';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);
let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let mapId: string;
let heroCharacterId: string;
let mageCharacterId: string;
let dm: ClientSocket;
let player: ClientSocket;

const HERO = randomUUID();
const OGRE = randomUUID();
const FAR = randomUUID();
const MAGE = randomUUID();

interface Answer {
  ok: boolean;
  error?: string;
  summary?: string;
  targets?: Array<{ tokenId: string; saved: boolean; total: number | null; dealt: number }>;
  hit?: boolean;
  critical?: boolean;
  dealt?: number;
  distanceFeet?: number;
  total?: number;
  success?: boolean | null;
  hidden?: boolean;
  reasons?: string[];
  actions?: Array<{
    index: number;
    name: string;
    cost: string;
    attack: { kind: string; bonus: number; damage: string } | null;
  }>;
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
    {
      name: 'Greatclub',
      description: 'Melee Attack Roll: +6, reach 5 ft. Hit: 13 (2d8 + 4) Bludgeoning damage.',
    },
    {
      name: 'Javelin',
      description: 'Ranged Attack Roll: +6, range 30/120 ft. Hit: 11 (2d6 + 4) Piercing damage.',
    },
    { name: 'Roar', description: 'The ogre roars.' },
    {
      name: 'Stomp',
      description:
        'Dexterity Saving Throw: DC 13, each creature within 10 feet. Failure: 9 (2d8) Thunder damage. Success: Half damage.',
    },
  ],
};
const freshTokens = () => [
  token(HERO, 'Hero', 1, { controlledBy: playerId, characterId: heroCharacterId, type: 'player' }),
  token(OGRE, 'Ogre', 2, { hp: { current: 59, max: 59, temp: 0 }, statBlock: ogreBlock }),
  token(FAR, 'Far Ogre', 8, { hp: { current: 59, max: 59, temp: 0 }, statBlock: ogreBlock }),
  // A hostile caster with a sheet, the DM's to answer for.
  token(MAGE, 'Mage', 3, { position: { x: 3, y: 3 }, characterId: mageCharacterId, type: 'npc', disposition: 'hostile' }),
];
const heroSheet = (prepared: string[] = []) => ({
  featuresAndTraits: [],
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
  attacks: [{ name: 'Longsword', attackBonus: 5, damageRoll: '1d8+3', damageType: 'slashing' }],
  proficiencyBonus: 2,
  stats: { strength: { score: 16, modifier: 3 }, wisdom: { score: 12, modifier: 1 } },
  skills: {
    stealth: { proficient: true, expertise: false, bonus: 6 },
    perception: { proficient: true, expertise: false, bonus: 4 },
  },
  spellcasting: {
    spellAttackBonus: 6,
    spellSaveDC: 14,
    cantrips: ['Fire Bolt'],
    spells: [
      { name: 'Fireball', level: 3, prepared: true },
      { name: 'Cure Wounds', level: 1, prepared: true },
      ...prepared.map((name) => ({ name, level: 1, prepared: true })),
    ],
    slots: { '1': { total: 2, expended: 0 }, '3': { total: 1, expended: 0 } },
  },
});
const mageSheet = (slots = 1) => ({
  hp: { current: 20, maximum: 20, temporary: 0 },
  armorClass: 12,
  savingThrows: { dexterity: { bonus: 2 }, constitution: { bonus: 1 } },
  spellcasting: {
    spellAttackBonus: 7,
    spellSaveDC: 15,
    cantrips: [],
    spells: [{ name: 'Counterspell', level: 3, prepared: true }],
    slots: { '3': { total: slots, expended: 0 } },
  },
});

let rolls: number[] = [];

beforeAll(async () => {
  dmId = (
    await prisma.user.create({
      data: { email: `rxspell-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `rxspell-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `Reaction Spells ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
    })
  ).id;
  heroCharacterId = (
    await prisma.character.create({
      data: {
        userId: playerId,
        campaignId,
        name: 'Hero',
        gameSystem: 'DND_5E',
        data: toJson(heroSheet()),
      },
    })
  ).id;
  mageCharacterId = (
    await prisma.character.create({
      data: { userId: dmId, campaignId, name: 'Mage', gameSystem: 'DND_5E', data: toJson(mageSheet()) },
    })
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
        name: 'Attack',
        imageUrl: '/api/assets/maps/x',
        baseLayerUrl: '/api/assets/maps/x',
        width: 10,
        height: 10,
        gridSize: 50,
        annotations: [],
        fogEnabled: false,
        tokens: toJson([]),
      },
    })
  ).id;
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { currentMapId: mapId, status: 'ACTIVE' },
  });
  server = await createWsTestServer();
});

beforeEach(async () => {
  clearState(campaignId);
  await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(freshTokens()) } });
  await prisma.character.update({
    where: { id: heroCharacterId },
    data: { data: toJson(heroSheet()) },
  });
  await prisma.character.update({ where: { id: mageCharacterId }, data: { data: toJson(mageSheet()) } });
  // The dice come up as the test says: the d20 first, then each damage die.
  rolls = [];
  jest
    .spyOn(d20, 'rollDie')
    .mockImplementation((sides: number) => rolls.shift() ?? Math.ceil(sides / 2));
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
const fight = (currentTokenId = OGRE) =>
  setState(campaignId, {
    active: true,
    round: 1,
    currentTokenId,
    combatants: [entry(HERO, 'Hero', 18), entry(OGRE, 'Ogre', 9), entry(FAR, 'Far Ogre', 5), entry(MAGE, 'Mage', 3)],
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0 },
  });
const actionIndex = async (tokenId: string, name: string) => {
  const listed = (await ask(dm, 'combat.actions', { tokenId })) as unknown as { actions: Array<{ index: number; name: string }> };
  return listed.actions.find((action) => action.name === name)!.index;
};
const prepare = (...spells: string[]) =>
  prisma.character.update({ where: { id: heroCharacterId }, data: { data: toJson(heroSheet(spells)) } });
interface Offer {
  promptId: string;
  text: string;
  options: string[];
}
/** Answer every prompt the socket is sent with `choose`, and keep what was offered. */
const answering = (socket: ClientSocket, choose: (offer: Offer) => string | null): Offer[] => {
  const offers: Offer[] = [];
  socket.on('combat.prompt', (offer: Offer) => {
    offers.push(offer);
    socket.emit('combat.react', { promptId: offer.promptId, choice: choose(offer) }, () => undefined);
  });
  return offers;
};
const slotsOf = async (characterId: string) => {
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  const slots = (character!.data as { spellcasting: { slots: Record<string, { expended: number }> } }).spellcasting.slots;
  return Object.fromEntries(Object.entries(slots).map(([level, slot]) => [level, slot.expended]));
};
const heroHp = async () =>
  ((await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data as { hp: { current: number } }).hp.current;
const ogreHp = async () => {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  return (map!.tokens as unknown as Array<{ id: string; hp: { current: number } }>).find((t) => t.id === OGRE)!.hp.current;
};
const until = async (done: () => Promise<boolean>) => {
  for (let tries = 0; tries < 100 && !(await done()); tries++) await new Promise((resolve) => setTimeout(resolve, 30));
};

describe('Shield', () => {
  it('turns a hit into a miss when taken: no damage, the slot and the reaction spent', async () => {
    fight();
    await prepare('Shield');
    const offers = answering(player, (offer) => offer.options[0]);
    // 12 + 6 = 18 hits AC 16, and misses AC 21. The damage dice were rolled, and are not shown or dealt.
    rolls = [12, 5, 5];
    const attack = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: await actionIndex(OGRE, 'Greatclub') });
    expect(offers).toHaveLength(1);
    expect(offers[0].options).toEqual(['Shield (level 1 slot)']);
    expect(offers[0].text).toContain('18 against AC 16');
    expect(offers[0].text).not.toContain('damage');
    expect(attack.hit).toBe(false);
    expect(attack.dealt).toBe(0);
    expect(attack.summary).toContain('(AC 21): miss');
    expect(attack.summary).toContain('Shield (level 1 slot): +5 AC');
    expect(await heroHp()).toBe(30);
    expect(await slotsOf(heroCharacterId)).toEqual({ '1': 1, '3': 0 });
    expect(getState(campaignId).reactionsSpent).toContain(HERO);
  });

  it('leaves the hit as it was when declined, and spends nothing', async () => {
    fight();
    await prepare('Shield');
    const offers = answering(player, () => null);
    rolls = [12, 5, 5];
    const attack = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: await actionIndex(OGRE, 'Greatclub') });
    expect(offers).toHaveLength(1);
    expect(attack.hit).toBe(true);
    expect(attack.dealt).toBe(14);
    expect(await slotsOf(heroCharacterId)).toEqual({ '1': 0, '3': 0 });
    expect(getState(campaignId).reactionsSpent).not.toContain(HERO);
    expect(getState(campaignId).marks.some((mark) => mark.kind === 'shield')).toBe(false);
  });

  it('keeps its +5 against later attacks until the start of the caster\'s next turn', async () => {
    fight();
    await prepare('Shield');
    const offers = answering(player, (offer) => (offers.length === 1 ? offer.options[0] : null));
    const greatclub = await actionIndex(OGRE, 'Greatclub');
    rolls = [12, 5, 5];
    await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: greatclub });
    // 14 + 6 = 20 would hit AC 16; the Shield still up makes it AC 21, and nobody is asked.
    rolls = [14];
    const second = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: greatclub });
    expect(second.hit).toBe(false);
    expect(second.summary).toContain('(AC 21): miss');
    expect(offers).toHaveLength(1);
    expect(await slotsOf(heroCharacterId)).toEqual({ '1': 1, '3': 0 });
    // The Hero's next turn starts: the Shield is gone, and its reaction is back.
    const state = getState(campaignId);
    while (state.currentTokenId !== HERO) advanceTurn(state);
    setState(campaignId, state);
    expect(getState(campaignId).marks.some((mark) => mark.kind === 'shield')).toBe(false);
    rolls = [14, 5, 5];
    const third = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: greatclub });
    expect(offers).toHaveLength(2);
    expect(third.hit).toBe(true);
    expect(third.summary).toContain('(AC 16): hit');
  });

  it('asks nobody when +5 would not turn the hit, or when the spell, the slot or the reaction is missing', async () => {
    fight();
    await prepare('Shield');
    const offers = answering(player, (offer) => offer.options[0]);
    const greatclub = await actionIndex(OGRE, 'Greatclub');
    // 15 + 6 = 21 hits AC 21 all the same.
    rolls = [15, 5, 5];
    expect((await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: greatclub })).dealt).toBe(14);
    // A natural 20 hits whatever the Armor Class.
    rolls = [20, 1, 1, 1, 1];
    expect((await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: greatclub })).hit).toBe(true);
    // Not prepared.
    await prepare();
    rolls = [12, 1, 1];
    expect((await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: greatclub })).hit).toBe(true);
    // The reaction spent.
    await prepare('Shield');
    setState(campaignId, { ...getState(campaignId), reactionsSpent: [HERO] });
    rolls = [12, 1, 1];
    expect((await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: greatclub })).hit).toBe(true);
    expect(offers).toHaveLength(0);
  });
});

describe('Shield against Magic Missile', () => {
  const withMissiles = () =>
    prisma.character.update({
      where: { id: mageCharacterId },
      data: {
        data: toJson({
          ...mageSheet(),
          spellcasting: {
            ...mageSheet().spellcasting,
            spells: [{ name: 'Magic Missile', level: 1, prepared: true }],
            slots: { '1': { total: 2, expended: 0 } },
          },
        }),
      },
    });

  it('stops the darts when taken, and again while it is up', async () => {
    fight(MAGE);
    await prepare('Shield');
    await withMissiles();
    const offers = answering(player, (offer) => offer.options[0]);
    const missile = await actionIndex(MAGE, 'Magic Missile');
    const cast = await ask(dm, 'combat.save', { sourceId: MAGE, targetIds: [HERO], action: missile });
    expect(offers).toHaveLength(1);
    expect(offers[0].text).toBe('Mage casts Magic Missile at Hero: 3 darts.');
    expect(cast.targets![0].dealt).toBe(0);
    expect(cast.summary).toContain("Hero's Shield (level 1 slot) stops the darts: no damage");
    expect(await heroHp()).toBe(30);
    expect(await slotsOf(heroCharacterId)).toEqual({ '1': 1, '3': 0 });
    expect(getState(campaignId).reactionsSpent).toContain(HERO);
    // The Shield is still up: the next darts are stopped without a question or a slot.
    const again = await ask(dm, 'combat.save', { sourceId: MAGE, targetIds: [HERO], action: missile });
    expect(again.targets![0].dealt).toBe(0);
    expect(offers).toHaveLength(1);
    expect(await slotsOf(heroCharacterId)).toEqual({ '1': 1, '3': 0 });
  });

  it('lets the darts strike when declined', async () => {
    fight(MAGE);
    await prepare('Shield');
    await withMissiles();
    answering(player, () => null);
    // Three darts of 1d4 + 1: 2 + 1 each.
    rolls = [2, 2, 2];
    const cast = await ask(dm, 'combat.save', { sourceId: MAGE, targetIds: [HERO], action: await actionIndex(MAGE, 'Magic Missile') });
    expect(cast.targets![0].dealt).toBe(9);
    expect(await heroHp()).toBe(21);
    expect(await slotsOf(heroCharacterId)).toEqual({ '1': 0, '3': 0 });
  });
});

describe('Counterspell', () => {
  it('makes the caster save or lose the spell: the action is spent, the slot kept', async () => {
    fight(HERO);
    const offers = answering(dm, (offer) => offer.options[0]);
    // The Hero's Constitution save: 5 + 2 = 7 against the Mage's DC 15.
    rolls = [5];
    const cast = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: await actionIndex(HERO, 'Fireball') });
    expect(offers).toHaveLength(1);
    expect(offers[0].options).toEqual(['Counterspell (level 3 slot)']);
    expect(offers[0].text).toContain('Hero casts Fireball');
    expect(cast.ok).toBe(true);
    expect((cast as unknown as { countered?: boolean }).countered).toBe(true);
    expect(cast.summary).toContain('Fireball dissipates');
    expect(await ogreHp()).toBe(59);
    expect(await slotsOf(heroCharacterId)).toEqual({ '1': 0, '3': 0 });
    expect(await slotsOf(mageCharacterId)).toEqual({ '3': 1 });
    expect(getState(campaignId).reactionsSpent).toContain(MAGE);
    expect(getState(campaignId).turn?.action).toBe('Magic');
  });

  it('lets the spell through when the caster saves, or when the counterspeller declines', async () => {
    fight(HERO);
    const offers = answering(dm, (offer) => (offers.length === 1 ? offer.options[0] : null));
    // The Constitution save: 15 + 2 = 17 against DC 15. Then Fire Bolt: 15 + 6 hits AC 11 for 7.
    rolls = [15, 15, 7];
    const bolt = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await actionIndex(HERO, 'Fire Bolt') });
    expect(offers).toHaveLength(1);
    expect(bolt.hit).toBe(true);
    expect(await ogreHp()).toBe(52);
    expect(await slotsOf(mageCharacterId)).toEqual({ '3': 1 });
    // The Mage has no slot and no reaction left: nobody is asked about the healing spell.
    rolls = [4];
    const heal = await ask(player, 'combat.heal', { casterId: HERO, targetId: HERO, action: await actionIndex(HERO, 'Cure Wounds') });
    expect(heal.ok).toBe(true);
    expect(offers).toHaveLength(1);
  });

  it('asks about a healing spell too, and a refusal lets it heal', async () => {
    fight(HERO);
    const offers = answering(dm, () => null);
    const heal = await ask(player, 'combat.heal', { casterId: HERO, targetId: HERO, action: await actionIndex(HERO, 'Cure Wounds') });
    expect(offers).toHaveLength(1);
    expect(heal.ok).toBe(true);
    expect((heal as unknown as { countered?: boolean }).countered).toBeUndefined();
    expect(await slotsOf(heroCharacterId)).toEqual({ '1': 1, '3': 0 });
    expect(await slotsOf(mageCharacterId)).toEqual({ '3': 0 });
  });
});

describe('Hellish Rebuke', () => {
  it('is asked once the damage is dealt, with the slot to cast it with', async () => {
    fight();
    await prepare('Hellish Rebuke');
    const offers = answering(player, (offer) => offer.options[1]);
    // 17 + 6 hits for 5 + 5 + 4 = 14. Then the rebuke with a level 3 slot: 4d10 = 6 + 4 + 2 + 8 = 20 Fire,
    // and the Ogre's Dexterity save of 3 - 1 fails against DC 14.
    rolls = [17, 5, 5, 6, 4, 2, 8, 3];
    const attack = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: await actionIndex(OGRE, 'Greatclub') });
    expect(attack.dealt).toBe(14);
    await until(async () => (await ogreHp()) < 59);
    expect(offers).toHaveLength(1);
    expect(offers[0].options).toEqual(['Hellish Rebuke (level 1 slot)', 'Hellish Rebuke (level 3 slot)']);
    expect(offers[0].text).toContain('Ogre deals 14 damage to Hero');
    expect(await ogreHp()).toBe(39);
    expect(await slotsOf(heroCharacterId)).toEqual({ '1': 0, '3': 1 });
    expect(getState(campaignId).reactionsSpent).toContain(HERO);
  });

  it('deals half on a successful save, and nothing when declined', async () => {
    fight();
    await prepare('Hellish Rebuke');
    const offers = answering(player, (offer) => (offers.length === 1 ? offer.options[0] : null));
    // 2d10 = 7 + 4 = 11 Fire; the Ogre's save of 18 - 1 succeeds: 5.
    rolls = [17, 5, 5, 7, 4, 18];
    const greatclub = await actionIndex(OGRE, 'Greatclub');
    await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: greatclub });
    await until(async () => (await ogreHp()) < 59);
    expect(await ogreHp()).toBe(54);
    // The Hero's turn comes and goes; hit again, it declines.
    const state = getState(campaignId);
    advanceTurn(state);
    while (state.currentTokenId !== OGRE) advanceTurn(state);
    setState(campaignId, state);
    rolls = [17, 1, 1];
    await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: greatclub });
    await until(async () => offers.length === 2);
    expect(offers).toHaveLength(2);
    expect(await ogreHp()).toBe(54);
    expect(await slotsOf(heroCharacterId)).toEqual({ '1': 1, '3': 0 });
  });
});

describe('Hellish Rebuke with Pact Magic', () => {
  it('is cast by a Warlock with its Pact slot, the only level offered', async () => {
    fight();
    const sheet = heroSheet(['Hellish Rebuke']);
    await prisma.character.update({
      where: { id: heroCharacterId },
      data: {
        data: toJson({
          ...sheet,
          class: 'Warlock',
          level: 5,
          featuresAndTraits: [{ name: 'Pact Magic', description: '' }],
          spellcasting: { ...sheet.spellcasting, slots: { '3': { total: 2, expended: 0 } } },
        }),
      },
    });
    const offers = answering(player, (offer) => offer.options[0]);
    // 17 + 6 hits for 14. The rebuke with the level 3 Pact slot: 4d10 = 5 + 5 + 5 + 5 = 20 Fire; the Ogre's save of 2 - 1 fails.
    rolls = [17, 5, 5, 5, 5, 5, 5, 2];
    await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: await actionIndex(OGRE, 'Greatclub') });
    await until(async () => (await ogreHp()) < 59);
    expect(offers).toHaveLength(1);
    expect(offers[0].options).toEqual(['Hellish Rebuke (level 3 slot)']);
    expect(await ogreHp()).toBe(39);
    expect(await slotsOf(heroCharacterId)).toEqual({ '3': 1 });
  });
});

describe('Feather Fall', () => {
  it('is asked on a fall, before the damage: none is taken and the creature stays on its feet', async () => {
    fight();
    await prepare('Feather Fall');
    const offers = answering(player, (offer) => offer.options[0]);
    rolls = [4, 4, 4];
    const fall = (await ask(player, 'combat.fall', { tokenId: HERO, feet: 30 })) as unknown as { dealt: number; prone: boolean; summary: string };
    expect(offers).toHaveLength(1);
    expect(offers[0].text).toBe('Hero falls 30 ft.');
    expect(fall.dealt).toBe(0);
    expect(fall.prone).toBe(false);
    expect(fall.summary).toContain('no damage (Feather Fall)');
    expect(await heroHp()).toBe(30);
    expect(await slotsOf(heroCharacterId)).toEqual({ '1': 1, '3': 0 });
    expect(getState(campaignId).reactionsSpent).toContain(HERO);
  });

  it('leaves the fall as it was when declined', async () => {
    fight();
    await prepare('Feather Fall');
    answering(player, () => null);
    rolls = [4, 4, 4];
    const fall = (await ask(player, 'combat.fall', { tokenId: HERO, feet: 30 })) as unknown as { dealt: number };
    expect(fall.dealt).toBe(12);
    expect(await slotsOf(heroCharacterId)).toEqual({ '1': 0, '3': 0 });
  });
});
