/**
 * Heroic Inspiration, the Grappler feat and two Epic Boons over the socket:
 * the DM gives Heroic Inspiration and the server asks after a failed D20
 * Test; a Grappler's Punch and Grab and Advantage; Peerless Aim after a miss;
 * Overcome Defenses and Overwhelming Strike.
 *
 * The fixtures are those of bardicInspiration.integration.test.ts.
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
      data: { email: `heroicinsp-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `heroicinsp-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `HeroicInsp ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
/** Answer the next question the player is asked with `choice`; what was asked comes back. */
const answerWith = (choice: string | null) => {
  const asked: Array<{ promptId: string; text: string; options: string[] }> = [];
  player.once('combat.prompt', (offer: { promptId: string; text: string; options: string[] }) => {
    asked.push(offer);
    player.emit('combat.react', { promptId: offer.promptId, choice }, () => undefined);
  });
  return asked;
};
const sheetNow = async () => (await prisma.character.findUniqueOrThrow({ where: { id: heroCharacterId } })).data as Record<string, unknown>;
const tokenNow = async (id: string) =>
  ((await prisma.map.findUniqueOrThrow({ where: { id: mapId } })).tokens as Array<{ id: string; conditions?: string[]; metadata?: Record<string, unknown>; hp?: { current: number } }>).find(
    (t) => t.id === id
  )!;
const withSheet = (features: string[], extra: Record<string, unknown> = {}) =>
  prisma.character.update({ where: { id: heroCharacterId }, data: { data: toJson({ ...heroSheet(features), ...extra }) } });
const longsword = () => actionIndex(player, HERO, 'Longsword');

describe('Heroic Inspiration', () => {
  it('is the DM’s to give, one at a time, and the player’s or the DM’s to expend', async () => {
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Heroic Inspiration' })).error).toBe('Heroic Inspiration is the DM’s to give');
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Spend Heroic Inspiration' })).error).toBe('Hero has no Heroic Inspiration');
    expect(((await ask(player, 'combat.actions', { tokenId: HERO })) as unknown as { heroicInspiration: boolean }).heroicInspiration).toBe(false);

    const given = await ask(dm, 'combat.feature', { tokenId: HERO, feature: 'Heroic Inspiration' });
    expect(given).toMatchObject({ ok: true, summary: 'Hero gains Heroic Inspiration' });
    expect((await sheetNow()).inspiration).toBe(true);
    expect(((await ask(player, 'combat.actions', { tokenId: HERO })) as unknown as { heroicInspiration: boolean }).heroicInspiration).toBe(true);
    expect((await ask(dm, 'combat.feature', { tokenId: HERO, feature: 'Heroic Inspiration' })).error).toBe('Hero already has Heroic Inspiration');

    const spent = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Spend Heroic Inspiration' });
    expect(spent).toMatchObject({ ok: true, summary: 'Hero expends its Heroic Inspiration' });
    expect((await sheetNow()).inspiration).toBe(false);
    // A stat block has no sheet to keep it on.
    expect(((await ask(dm, 'combat.actions', { tokenId: OGRE })) as unknown as { heroicInspiration: null }).heroicInspiration).toBeNull();
  });

  it('is asked after a missed attack roll: the d20 is rolled again and the inspiration expended', async () => {
    fight(HERO);
    await withSheet([], { inspiration: true });
    const asked = answerWith('Heroic Inspiration');
    // 4 + 5 = 9 misses AC 11; rolled again, 12 + 5 = 17 hits; 5 + 3 slashing.
    rolls = [4, 12, 5];
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await longsword() });
    expect(asked[0]?.options).toEqual(['Heroic Inspiration']);
    expect(answer).toMatchObject({ ok: true, hit: true, dealt: 8 });
    expect(answer.summary).toContain('Heroic Inspiration: the d20 is rolled again (4 becomes 12)');
    expect((await sheetNow()).inspiration).toBe(false);
  });

  it('must use the new roll, rerolls the lower of two dice, and is kept when declined or on a hit', async () => {
    fight(HERO);
    await withSheet([], { inspiration: true });
    answerWith('Heroic Inspiration');
    // Advantage: 4 and 2 miss; the 2 is rolled again into a 3: 4 + 5 = 9 still misses.
    rolls = [4, 2, 3];
    const missed = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await longsword(), mode: 'advantage' });
    expect(missed).toMatchObject({ ok: true, hit: false });
    expect(missed.summary).toContain('Heroic Inspiration: the d20 is rolled again (2 becomes 3)');
    expect((await sheetNow()).inspiration).toBe(false);

    fight(HERO);
    await withSheet([], { inspiration: true });
    answerWith(null);
    rolls = [4];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await longsword() })).hit).toBe(false);
    expect((await sheetNow()).inspiration).toBe(true);

    fight(HERO);
    const asked = answerWith('Heroic Inspiration');
    rolls = [15, 5];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await longsword() })).hit).toBe(true);
    expect(asked).toEqual([]);
    expect((await sheetNow()).inspiration).toBe(true);
    player.removeAllListeners('combat.prompt');
  });

  it('is asked after a failed save it rolled', async () => {
    fight();
    await withSheet([], { inspiration: true });
    const asked = answerWith('Heroic Inspiration');
    // 4 + 6 = 10 thunder; 2 + 4 = 6 fails DC 13; rolled again, 15 + 4 = 19 saves, for half.
    rolls = [4, 6, 2, 15];
    const answer = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [HERO], action: await actionIndex(dm, OGRE, 'Stomp') });
    expect(asked[0]?.options).toEqual(['Heroic Inspiration']);
    expect(answer.targets?.[0]).toMatchObject({ saved: true, total: 19, dealt: 5 });
    expect(answer.summary).toContain('Hero fails (6), Heroic Inspiration: saves (19)');
    expect((await sheetNow()).inspiration).toBe(false);
  });

  it('is asked after a failed check', async () => {
    fight();
    await withSheet([], { inspiration: true });
    answerWith('Heroic Inspiration');
    // 5 + 3 = 8 fails DC 15; rolled again, 14 + 3 = 17.
    rolls = [5, 14];
    const answer = await ask(player, 'combat.check', { tokenId: HERO, ability: 'str', dc: 15 });
    expect(answer).toMatchObject({ ok: true, success: true, total: 17 });
    expect(answer.summary).toContain('Heroic Inspiration: the d20 is rolled again, 5 becomes 14');
    expect((await sheetNow()).inspiration).toBe(false);
  });

  it('comes back to a Human with a Long Rest (Resourceful), and to nobody else', async () => {
    await withSheet([], { race: 'Human' });
    const rested = await ask(dm, 'combat.rest', { characterId: heroCharacterId, kind: 'long' });
    expect(rested.summary).toContain('Heroic Inspiration (Resourceful)');
    expect((await sheetNow()).inspiration).toBe(true);

    await withSheet([], { race: 'Elf' });
    expect((await ask(dm, 'combat.rest', { characterId: heroCharacterId, kind: 'long' })).summary).not.toContain('Heroic Inspiration');
    expect((await sheetNow()).inspiration).toBeUndefined();
  });

  it('is gained by a Champion with Heroic Warrior at the start of each of its turns', async () => {
    const startHeroTurn = async () => {
      fight();
      setState(campaignId, { ...getState(campaignId), currentTokenId: FAR });
      dm.emit('initiative.next');
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(getState(campaignId).currentTokenId).toBe(HERO);
    };
    await withSheet(['Heroic Warrior (Fighter 10)']);
    await startHeroTurn();
    expect((await sheetNow()).inspiration).toBe(true);

    await withSheet([]);
    await startHeroTurn();
    expect((await sheetNow()).inspiration).toBeUndefined();
  });
});

describe('the Grappler feat', () => {
  // The hero's own three actions come first: 3 strikes, 4 grapples.
  const STRIKE = 3, GRAPPLE = 4;

  it('has Advantage on attack rolls against a creature it grappled, and only then', async () => {
    fight(HERO);
    await withSheet(['Grappler (General feat)']);
    // The ogre saves with Strength (+4) against DC 13: a 5 is 9.
    rolls = [5];
    expect((await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: GRAPPLE })).ok).toBe(true);
    expect(await tokenNow(OGRE)).toMatchObject({ conditions: ['Grappled'], metadata: { grappledBy: HERO } });

    fight(HERO);
    rolls = [3, 15, 5];
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await longsword() });
    expect(answer.reasons).toContain('Advantage: Grappler (the target is Grappled by the attacker)');
    expect(answer.hit).toBe(true);

    // Without the feat the grapple gives none.
    fight(HERO);
    await withSheet([]);
    rolls = [15, 5];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await longsword() })).reasons).toEqual([]);
  });

  it('asks Punch and Grab once per turn after an Unarmed Strike of the Attack action hits', async () => {
    fight(HERO);
    await withSheet(['Grappler (General feat)', 'Extra Attack (Fighter 5)']);
    const asked = answerWith('Punch and Grab');
    // 10 + 5 hits; the ogre's Strength save: 5 + 4 = 9 fails DC 13.
    rolls = [10, 5];
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: STRIKE });
    expect(asked[0]?.options).toEqual(['Punch and Grab']);
    expect(answer).toMatchObject({ ok: true, hit: true, dealt: 4 });
    expect(answer.summary).toContain('Punch and Grab: Ogre fails (Strength 9 vs DC 13) and is Grappled (escape DC 13)');
    expect(await tokenNow(OGRE)).toMatchObject({ conditions: ['Grappled'], metadata: { grappledBy: HERO } });

    // The second strike of the turn, on another creature: used this turn, nothing is asked.
    await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(freshTokens()) } });
    const again = answerWith('Punch and Grab');
    rolls = [10];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: STRIKE })).hit).toBe(true);
    expect(again).toEqual([]);
    expect((await tokenNow(OGRE)).conditions).toEqual([]);
    player.removeAllListeners('combat.prompt');
  });

  it('asks nothing without the feat, and leaves a target that saves ungrappled', async () => {
    fight(HERO);
    const asked = answerWith('Punch and Grab');
    rolls = [10];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: STRIKE })).hit).toBe(true);
    expect(asked).toEqual([]);
    player.removeAllListeners('combat.prompt');

    fight(HERO);
    await withSheet(['Grappler']);
    answerWith('Punch and Grab');
    rolls = [10, 15];
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: STRIKE });
    expect(answer.summary).toContain('Punch and Grab: Ogre saves (Strength 19 vs DC 13)');
    expect((await tokenNow(OGRE)).conditions).toEqual([]);
  });
});

describe('Epic Boons', () => {
  it('Boon of Combat Prowess turns a miss into a hit, once until the start of its next turn', async () => {
    fight(HERO);
    await withSheet(['Boon of Combat Prowess (Epic Boon feat)', 'Extra Attack (Fighter 5)']);
    const asked = answerWith('Boon of Combat Prowess');
    // 4 + 5 = 9 misses AC 11; Peerless Aim: a hit, 5 + 3 slashing.
    rolls = [4, 5];
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await longsword() });
    expect(asked[0]?.options).toEqual(['Boon of Combat Prowess']);
    expect(answer).toMatchObject({ ok: true, hit: true, critical: false, dealt: 8 });
    expect(answer.summary).toContain('Boon of Combat Prowess: the miss becomes a hit');

    // The next miss of the same turn is not asked.
    const again = answerWith('Boon of Combat Prowess');
    rolls = [4];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await longsword() })).hit).toBe(false);
    expect(again).toEqual([]);
    player.removeAllListeners('combat.prompt');

    // Back as its next turn starts.
    setState(campaignId, { ...getState(campaignId), currentTokenId: FAR });
    dm.emit('initiative.next');
    await new Promise((resolve) => setTimeout(resolve, 400));
    answerWith('Boon of Combat Prowess');
    rolls = [4, 5];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await longsword() })).hit).toBe(true);
  });

  it('Boon of Irresistible Offense ignores Resistance to Slashing, and a 20 adds the ability score', async () => {
    const resistant = () =>
      prisma.map.update({
        where: { id: mapId },
        data: { tokens: toJson(freshTokens().map((t) => (t.id === OGRE ? { ...t, statBlock: { ...ogreBlock, damageResistances: 'Slashing' } } : t))) },
      });
    fight(HERO);
    await resistant();
    // Without the boon: 5 + 3 = 8 slashing, halved.
    rolls = [15, 5];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await longsword() })).dealt).toBe(4);

    fight(HERO);
    await resistant();
    await withSheet(['Boon of Irresistible Offense (Epic Boon feat)']);
    rolls = [15, 5];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await longsword() })).dealt).toBe(8);

    // A 20: a Critical Hit (5 + 6 + 3), and the Strength score of 16 on top.
    fight(HERO);
    await resistant();
    rolls = [20, 5, 6];
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await longsword() });
    expect(answer).toMatchObject({ ok: true, critical: true, dealt: 30 });
    expect(answer.summary).toContain('Overwhelming Strike (+16)');
  });
});
