/**
 * A Warlock's features and the Fiend Patron over the socket: Dark One's
 * Blessing, Dark One's Own Luck, Magical Cunning and Pact Magic on a Short
 * Rest, the pact weapon's invocations, Fiendish Vigor, Fiendish Resilience
 * and Hurl Through Hell.
 *
 * The fixtures are those of areaPoint.integration.test.ts.
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
let dm: ClientSocket;
let player: ClientSocket;

const HERO = randomUUID();
const OGRE = randomUUID();
const FAR = randomUUID();
const LURKER = randomUUID();
const ALLY = randomUUID();

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
  token(ALLY, 'Ally', 3, {
    type: 'player',
    hp: { current: 10, max: 10, temp: 0 },
    statBlock: ogreBlock,
  }),
  token(OGRE, 'Ogre', 2, { hp: { current: 59, max: 59, temp: 0 }, statBlock: ogreBlock }),
  token(FAR, 'Far Ogre', 8, { hp: { current: 59, max: 59, temp: 0 }, statBlock: ogreBlock }),
  token(LURKER, 'Lurker', 1, {
    position: { x: 1, y: 2 },
    visible: false,
    hp: { current: 10, max: 10, temp: 0 },
    statBlock: ogreBlock,
  }),
];
const heroSheet = (features: string[] = []) => ({
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
    spells: [{ name: 'Fireball', level: 3, prepared: true, ritual: false, concentration: false }],
    slots: { '3': { total: 2, expended: 0 }, '4': { total: 1, expended: 0 } },
  },
});

let rolls: number[] = [];

beforeAll(async () => {
  dmId = (
    await prisma.user.create({
      data: { email: `warlock-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `warlock-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `Warlock ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
        tokens: toJson(freshTokens()),
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
const fight = (currentTokenId: string = OGRE) =>
  setState(campaignId, {
    active: true,
    round: 1,
    currentTokenId,
    combatants: [
      entry(HERO, 'Hero', 18),
      entry(ALLY, 'Ally', 12),
      entry(OGRE, 'Ogre', 9),
      entry(FAR, 'Far Ogre', 5),
    ],
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0 },
  });
const actionIndex = async (socket: ClientSocket, tokenId: string, name: string) => {
  const listed = (await ask(socket, 'combat.actions', { tokenId })) as unknown as {
    actions: Array<{ index: number; name: string }>;
  };
  return listed.actions.find((action) => action.name === name)!.index;
};
const DARK_LUCK = "Dark One's Own Luck";
const SMITE_PRONE = 'Eldritch Smite and Prone';
const HURL = 'Hurl Through Hell';

/** Answer each question the player is asked with the next of `choices`; what was asked comes back. */
const answerAll = (choices: Array<string | null>) => {
  const asked: Array<{ promptId: string; text: string; options: string[] }> = [];
  const left = [...choices];
  player.on('combat.prompt', (offer: { promptId: string; text: string; options: string[] }) => {
    asked.push(offer);
    player.emit('combat.react', { promptId: offer.promptId, choice: left.shift() ?? null }, () => undefined);
  });
  return asked;
};
const sheetNow = async () =>
  (await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data as unknown as {
    hp: { current: number; temporary: number };
    featureUses?: Record<string, number>;
    hitDice?: Array<{ remaining: number }>;
    spellcasting: { slots: Record<string, { total: number; expended: number }> };
  };
const tokensNow = async () =>
  (await prisma.map.findUnique({ where: { id: mapId } }))!.tokens as unknown as Array<{ id: string; conditions?: string[]; hp?: { current: number } }>;
/** The hero as a Warlock of `level` with Charisma +3 and these features; `extra` overrides the sheet. */
const asWarlock = (level: number, features: string[], extra: Record<string, unknown> = {}) =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: {
      data: toJson({
        ...heroSheet(features),
        class: 'Warlock',
        level,
        stats: { ...heroSheet().stats, charisma: { score: 16, modifier: 3 }, constitution: { score: 14, modifier: 2 } },
        ...extra,
      }),
    },
  });
const withOgreAt = (hp: number) =>
  prisma.map.update({
    where: { id: mapId },
    data: { tokens: toJson(freshTokens().map((t) => (t.id === OGRE ? { ...t, hp: { current: hp, max: 59, temp: 0 } } : t))) },
  });
const swing = async (extra: Record<string, unknown> = {}) =>
  ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await actionIndex(player, HERO, 'Longsword'), ...extra });

describe("Dark One's Blessing", () => {
  it('gives the Warlock that drops an enemy Temporary Hit Points of its Charisma modifier plus its level', async () => {
    fight(HERO);
    await asWarlock(5, ['Dark One’s Blessing (Warlock 3)']);
    await withOgreAt(4);
    rolls = [15, 5];
    const answer = await swing();
    expect(answer).toMatchObject({ ok: true, hit: true });
    expect(answer.summary).toContain("Dark One's Blessing: Hero has 8 Temporary Hit Points");
    expect((await sheetNow()).hp.temporary).toBe(8);
  });

  it('gives them when someone else drops an enemy within 10 feet, and not without the feature', async () => {
    fight(ALLY);
    await asWarlock(5, ["Dark One's Blessing"]);
    await withOgreAt(4);
    rolls = [15, 5, 5];
    const answer = await ask(dm, 'combat.attack', { attackerId: ALLY, targetId: OGRE, action: await actionIndex(dm, ALLY, 'Greatclub') });
    expect(answer.summary).toContain("Dark One's Blessing: Hero has 8 Temporary Hit Points");

    await asWarlock(5, []);
    await withOgreAt(4);
    fight(ALLY);
    rolls = [15, 5, 5];
    const plain = await ask(dm, 'combat.attack', { attackerId: ALLY, targetId: OGRE, action: await actionIndex(dm, ALLY, 'Greatclub') });
    expect(plain.summary).not.toContain("Dark One's Blessing");
    expect((await sheetNow()).hp.temporary).toBe(0);
  });

  it('follows an enemy dropped by a saving throw effect', async () => {
    fight(HERO);
    await asWarlock(5, ["Dark One's Blessing"]);
    await withOgreAt(4);
    // 8d6 of Fireball at 3 each, then the Ogre's save.
    rolls = [3, 3, 3, 3, 3, 3, 3, 3, 2];
    const answer = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: await actionIndex(player, HERO, 'Fireball') });
    expect(answer.summary).toContain("Dark One's Blessing: Hero has 8 Temporary Hit Points");
  });
});

describe("Dark One's Own Luck", () => {
  it('is asked after a failed save, adds 1d10 and spends a use', async () => {
    fight();
    await asWarlock(6, ['Dark One’s Own Luck']);
    const asked = answerAll([DARK_LUCK]);
    // 4 + 6 = 10 thunder; 2 + 4 = 6 fails, the d10 adds 7: 13 saves, for half.
    rolls = [4, 6, 2, 7];
    const answer = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [HERO], action: await actionIndex(dm, OGRE, 'Stomp') });
    expect(asked[0]?.options).toEqual([DARK_LUCK]);
    expect(answer.targets?.[0]).toMatchObject({ saved: true, total: 13, dealt: 5 });
    expect(answer.summary).toContain("Hero fails (6), Dark One's Own Luck +7: saves (13)");
    expect((await sheetNow()).featureUses?.[DARK_LUCK]).toBe(1);
  });

  it('is asked after a failed check and after one with no DC, and not once its uses are spent', async () => {
    await asWarlock(6, ["Dark One's Own Luck"]);
    const asked = answerAll([DARK_LUCK, DARK_LUCK, null]);
    // 3 + 6 = 9 fails DC 15; the d10 adds 8: 17.
    rolls = [3, 8];
    const failed = await ask(player, 'combat.check', { tokenId: HERO, skill: 'stealth', dc: 15 });
    expect(failed).toMatchObject({ ok: true, success: true, total: 17 });
    expect(failed.summary).toContain("Dark One's Own Luck +8: 17, success");
    rolls = [10, 4];
    const open = await ask(player, 'combat.check', { tokenId: HERO, skill: 'stealth' });
    expect(open).toMatchObject({ ok: true, success: null, total: 20 });
    expect(open.summary).toContain("Dark One's Own Luck +4: 20");
    // A success is not asked about.
    rolls = [15];
    await ask(player, 'combat.check', { tokenId: HERO, skill: 'stealth', dc: 15 });
    expect(asked).toHaveLength(2);
    // Charisma +3: three uses.
    rolls = [3];
    await ask(player, 'combat.check', { tokenId: HERO, skill: 'stealth', dc: 15 });
    expect(asked).toHaveLength(3);
    expect((await sheetNow()).featureUses?.[DARK_LUCK]).toBe(2);
  });
});

describe('Pact Magic and Magical Cunning', () => {
  const pact = { spellcasting: { ...heroSheet().spellcasting, slots: { '3': { total: 2, expended: 2 } } } };

  it('regains half the Pact Magic slots, rounded up, once until a Long Rest', async () => {
    await asWarlock(5, [], pact);
    const rite = await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'magicalCunning' });
    expect(rite).toMatchObject({ ok: true, summary: 'Hero performs the rite of Magical Cunning: 1 Pact Magic slot regained' });
    expect((await sheetNow()).spellcasting.slots['3'].expended).toBe(1);
    expect((await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'magicalCunning' })).error).toBe(
      'Hero: Magical Cunning is used until a Long Rest'
    );
  });

  it('is refused with no slot expended, for another class, and to a player in a fight', async () => {
    await asWarlock(5, []);
    expect((await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'magicalCunning' })).error).toBe(
      'Hero: No Pact Magic slot is expended to regain'
    );
    await asWarlock(5, [], { ...pact, class: 'Wizard' });
    expect((await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'magicalCunning' })).error).toBe('Hero: The sheet has no Magical Cunning');
    await asWarlock(5, [], pact);
    fight(HERO);
    expect((await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'magicalCunning' })).error).toBe(
      'Magical Cunning is a 1-minute rite, not one for the middle of a fight'
    );
  });

  it('gives the Pact Magic slots back as a Short Rest ends', async () => {
    await asWarlock(5, [], pact);
    const rest = await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'shortFinish' });
    expect(rest.summary).toBe('Hero finishes a Short Rest: 2 Pact Magic slots');
    expect((await sheetNow()).spellcasting.slots['3'].expended).toBe(0);
  });
});

describe('The pact weapon', () => {
  const blade = 'Pact of the Blade (Longsword)';
  const pact = { spellcasting: { ...heroSheet().spellcasting, slots: { '3': { total: 2, expended: 0 } } } };

  it('deals the damage type its Warlock chooses, and only it', async () => {
    fight(HERO);
    await asWarlock(5, [blade]);
    rolls = [15, 5];
    const answer = await swing({ pactDamage: 'radiant' });
    expect(answer).toMatchObject({ ok: true, hit: true, dealt: 8 });
    expect(answer.summary).toContain('radiant');
    await asWarlock(5, []);
    fight(HERO);
    expect((await swing({ pactDamage: 'radiant' })).error).toBe("Longsword is not Hero's pact weapon");
  });

  it('attacks twice in the Attack action with Thirsting Blade', async () => {
    fight(HERO);
    await asWarlock(5, [blade]);
    rolls = [2];
    await swing();
    expect((await swing()).error).toBe('Hero has made its attack with the Attack action this turn');
    fight(HERO);
    await asWarlock(5, [blade, 'Thirsting Blade']);
    rolls = [2, 2];
    await swing();
    expect((await swing()).ok).toBe(true);
    expect((await swing()).error).toBe('Hero has made its 2 attacks with the Attack action this turn');
    // Both attacks are the pact weapon's: one with another weapon, before or after, leaves the Attack action at one.
    const armed = { attacks: [...heroSheet().attacks, { name: 'Dagger', attackBonus: 5, damageRoll: '1d4+3', damageType: 'piercing' }] };
    const stab = async () => ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await actionIndex(player, HERO, 'Dagger') });
    await asWarlock(5, [blade, 'Thirsting Blade'], armed);
    fight(HERO);
    rolls = [2];
    expect((await stab()).ok).toBe(true);
    expect((await swing()).error).toBe('Hero has made its attack with the Attack action this turn');
    fight(HERO);
    setState(campaignId, { ...getState(campaignId), round: 2 });
    rolls = [2];
    expect((await swing()).ok).toBe(true);
    expect((await stab()).error).toBe('Hero has made its attack with the Attack action this turn');
  });

  it('smites with a Pact Magic slot after a hit, once a turn, and can knock the target Prone', async () => {
    fight(HERO);
    await asWarlock(5, [blade, 'Thirsting Blade', 'Eldritch Smite'], pact);
    const asked = answerAll([SMITE_PRONE]);
    // 5 + 3 slashing, then 4d8 Force at 2 each.
    rolls = [15, 5, 2, 2, 2, 2];
    const answer = await swing();
    expect(asked[0]?.options).toEqual(['Eldritch Smite', SMITE_PRONE]);
    expect(answer).toMatchObject({ ok: true, hit: true, dealt: 16 });
    expect(answer.summary).toContain('Eldritch Smite (level 3)');
    expect(answer.summary).toContain('Eldritch Smite: Ogre is Prone');
    expect((await sheetNow()).spellcasting.slots['3'].expended).toBe(1);
    expect((await tokensNow()).find((t) => t.id === OGRE)?.conditions).toContain('Prone');
    // Once a turn: the second hit is not asked about.
    rolls = [15, 5];
    await swing();
    expect(asked).toHaveLength(1);
  });

  it('drinks life once a turn: 1d6 of a chosen type, and a Hit Point Die spent to heal', async () => {
    fight(HERO);
    await asWarlock(9, [blade, 'Lifedrinker'], {
      hp: { current: 10, maximum: 30, temporary: 0 },
      hitDice: [{ die: 'd8', maximum: 9, remaining: 9 }],
    });
    const asked = answerAll(['Lifedrinker (Necrotic)', 'Spend a Hit Point Die']);
    // 5 + 3 slashing, 4 necrotic; the Hit Point Die rolls 6, + 2 Constitution.
    rolls = [15, 5, 4, 6];
    const answer = await swing();
    expect(asked.map((offer) => offer.options)).toEqual([
      ['Lifedrinker (Necrotic)', 'Lifedrinker (Psychic)', 'Lifedrinker (Radiant)'],
      ['Spend a Hit Point Die'],
    ]);
    expect(answer).toMatchObject({ ok: true, dealt: 12 });
    expect(answer.summary).toContain('Lifedrinker: Hero spends a Hit Point Die (d8 rolled 6) and regains 8 Hit Points');
    const sheet = await sheetNow();
    expect(sheet.hp.current).toBe(18);
    expect(sheet.hitDice?.[0].remaining).toBe(8);
  });
});

describe('The Fiend Patron', () => {
  it('resists the damage type Fiendish Resilience names', async () => {
    fight();
    await asWarlock(10, ['Fiendish Resilience (Thunder)']);
    // 4 + 6 = 10 thunder; the save fails: half of 10.
    rolls = [4, 6, 2];
    const answer = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [HERO], action: await actionIndex(dm, OGRE, 'Stomp') });
    expect(answer.targets?.[0]).toMatchObject({ saved: false, dealt: 5 });
  });

  it('hurls a creature it hits through hell: a Charisma save or 8d10 Psychic damage and Incapacitated', async () => {
    fight(HERO);
    await asWarlock(14, ['Hurl Through Hell'], { spellcasting: { ...heroSheet().spellcasting, slots: { '5': { total: 3, expended: 0 } } } });
    const asked = answerAll([HURL, `${HURL} (Pact Magic slot)`]);
    // 5 + 3 slashing; 8d10 at 2 each; the Ogre's Charisma save: 5 - 2 fails DC 14.
    rolls = [15, 5, 5, 2, 2, 2, 2, 2, 2, 2, 2];
    const answer = await swing();
    expect(asked[0]?.options).toEqual([HURL]);
    expect(answer.summary).toContain('Hurl Through Hell: Ogre fails (Charisma 3 vs DC 14), is hurled through the Lower Planes and takes 16 psychic damage');
    expect(answer.summary).toContain("Ogre has the Incapacitated condition until the end of Hero's next turn");
    const ogre = (await tokensNow()).find((t) => t.id === OGRE);
    expect(ogre?.hp?.current).toBe(59 - 8 - 16);
    expect(ogre?.conditions).toContain('Incapacitated');
    expect((await sheetNow()).featureUses?.[HURL]).toBe(1);
    // The use is spent: on a later turn a Pact Magic slot restores it.
    setState(campaignId, { ...getState(campaignId), round: 2, turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0 } });
    rolls = [15, 5, 19];
    const again = await swing();
    expect(asked[1]?.options).toEqual([`${HURL} (Pact Magic slot)`]);
    expect(again.summary).toContain('Hurl Through Hell (Pact Magic slot): Ogre saves');
    expect((await sheetNow()).spellcasting.slots['5'].expended).toBe(1);
  });

  it('casts False Life with Fiendish Vigor for 12 Temporary Hit Points, as its action', async () => {
    fight(HERO);
    await asWarlock(2, []);
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Fiendish Vigor' })).error).toBe('Hero has no Fiendish Vigor');
    await asWarlock(2, ['Fiendish Vigor']);
    const cast = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Fiendish Vigor' });
    expect(cast).toMatchObject({ ok: true, summary: 'Hero casts False Life with Fiendish Vigor: 12 Temporary Hit Points' });
    expect((await sheetNow()).hp.temporary).toBe(12);
    expect(getState(campaignId).turn?.action).toBe('Magic');
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Fiendish Vigor' })).error).toBe('Hero has taken its action this turn');
  });
});
