/**
 * A Fighter's always-on features over the socket: a Champion's Improved
 * Critical, Remarkable Athlete and Survivor, the Dueling fighting style, and
 * Studied Attacks.
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
  stats: { strength: { score: 16, modifier: 3 }, constitution: { score: 14, modifier: 2 }, wisdom: { score: 12, modifier: 1 } },
  skills: {
    athletics: { proficient: true, expertise: false, bonus: 5 },
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
      data: { email: `fighterslice-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `fighterslice-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `Fighter slice ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
const fight = (turn: Record<string, unknown> = {}) =>
  setState(campaignId, {
    active: true,
    round: 1,
    currentTokenId: HERO,
    combatants: [
      entry(HERO, 'Hero', 18),
      entry(ALLY, 'Ally', 12),
      entry(OGRE, 'Ogre', 9),
      entry(FAR, 'Far Ogre', 5),
    ],
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0, ...turn },
  });
const withSheet = (features: string[], extra: Record<string, unknown> = {}) =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: { data: toJson({ ...heroSheet(features), class: 'Fighter', level: 18, ...extra }) },
  });
const longsword = async () => {
  const listed = (await ask(player, 'combat.actions', { tokenId: HERO })) as unknown as {
    actions: Array<{ index: number; name: string }>;
  };
  return listed.actions.find((action) => action.name === 'Longsword')!.index;
};
const swing = async () => ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await longsword() });
const heroHp = async () =>
  ((await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data as { hp: { current: number } }).hp.current;

describe('Improved and Superior Critical', () => {
  it('makes a 19 a Critical Hit for a Champion, and an 18 with Superior Critical', async () => {
    fight();
    await withSheet(['Improved Critical (Fighter 3)']);
    // 19 + 5 hits AC 11; 2d8 (4, 6) + 3 = 13.
    rolls = [19, 4, 6];
    const crit = await swing();
    expect(crit).toMatchObject({ hit: true, critical: true, dealt: 13 });

    fight();
    rolls = [18, 4];
    expect(await swing()).toMatchObject({ hit: true, critical: false, dealt: 7 });

    fight();
    await withSheet(['Improved Critical', 'Superior Critical (Fighter 15)']);
    rolls = [18, 4, 6];
    expect(await swing()).toMatchObject({ hit: true, critical: true, dealt: 13 });
  });

  it('leaves a 19 an ordinary hit without the feature', async () => {
    fight();
    await withSheet([]);
    rolls = [19, 4];
    expect(await swing()).toMatchObject({ hit: true, critical: false, dealt: 7 });
  });
});

describe('Dueling', () => {
  it('adds 2 to the damage with one weapon equipped, and nothing with a second', async () => {
    fight();
    await withSheet(['Fighting Style: Dueling'], { inventory: [{ name: 'Longsword', equipped: true }, { name: 'Shield', equipped: true }] });
    rolls = [15, 4];
    expect(await swing()).toMatchObject({ hit: true, dealt: 9 });

    fight();
    await withSheet(['Fighting Style: Dueling'], { inventory: [{ name: 'Longsword', equipped: true }, { name: 'Dagger', equipped: true }] });
    rolls = [15, 4];
    expect(await swing()).toMatchObject({ hit: true, dealt: 7 });
  });
});

describe('Studied Attacks', () => {
  it('gives Advantage on the next attack roll against a creature the Fighter missed, once', async () => {
    fight();
    await withSheet(['Studied Attacks (Fighter 13)', 'Extra Attack']);
    rolls = [2];
    const miss = await swing();
    expect(miss.hit).toBe(false);
    expect(getState(campaignId).marks).toEqual([{ kind: 'studied', attackerId: HERO, targetId: OGRE, turnEndsLeft: 2 }]);

    // Advantage: 3 and 15; the 15 hits. The mark is used.
    rolls = [3, 15, 4];
    const hit = await swing();
    expect(hit).toMatchObject({ hit: true, dealt: 7 });
    expect(hit.reasons).toContain('Advantage: Studied Attacks');
    expect(getState(campaignId).marks).toEqual([]);
  });

  it('keeps the mark to the end of the Fighter’s next turn, and gives none without the feature', async () => {
    fight();
    await withSheet(['Studied Attacks']);
    rolls = [2];
    await swing();
    for (let turns = 0; turns < 4; turns++) {
      dm.emit('initiative.next');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // Round 2, the Hero's turn again: the mark is still there; it goes as that turn ends.
    expect(getState(campaignId).currentTokenId).toBe(HERO);
    expect(getState(campaignId).marks).toHaveLength(1);
    dm.emit('initiative.next');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(getState(campaignId).marks).toEqual([]);

    fight();
    await withSheet([]);
    rolls = [2];
    await swing();
    expect(getState(campaignId).marks).toEqual([]);
  });
});

describe('Remarkable Athlete', () => {
  it('rolls a Strength (Athletics) check with Advantage, and other checks without', async () => {
    await withSheet(['Remarkable Athlete (Fighter 3)']);
    rolls = [4, 15];
    const athletics = await ask(player, 'combat.check', { tokenId: HERO, skill: 'athletics', dc: 15 });
    expect(athletics).toMatchObject({ ok: true, total: 20, success: true });
    expect(athletics.reasons).toContain('Advantage: Remarkable Athlete');

    rolls = [4, 15];
    const stealth = await ask(player, 'combat.check', { tokenId: HERO, skill: 'stealth', dc: 15 });
    expect(stealth).toMatchObject({ ok: true, total: 10, success: false });
  });
});

describe('Survivor', () => {
  it('rolls a death save with Advantage and counts an 18 as a 20', async () => {
    await withSheet(['Survivor (Fighter 18)'], { hp: { current: 0, maximum: 30, temporary: 0 } });
    rolls = [5, 18];
    const save = (await ask(player, 'combat.deathSave', { tokenId: HERO })) as Answer & { natural?: number; result?: string };
    expect(save).toMatchObject({ ok: true, natural: 18, result: 'revived' });
    expect(save.summary).toContain('Advantage: Survivor, 5 and 18');
    expect(await heroHp()).toBe(1);
  });

  it('rolls one die and needs a 20 without the feature', async () => {
    await withSheet([], { hp: { current: 0, maximum: 30, temporary: 0 } });
    rolls = [18, 20];
    const save = (await ask(player, 'combat.deathSave', { tokenId: HERO })) as Answer & { natural?: number; result?: string };
    expect(save).toMatchObject({ ok: true, natural: 18, result: 'continues' });
    expect(await heroHp()).toBe(0);
  });

  it('regains 5 + Constitution modifier at the start of its turn while Bloodied, and nothing above half or at 0', async () => {
    const startHeroTurn = async () => {
      fight();
      setState(campaignId, { ...getState(campaignId), currentTokenId: FAR });
      dm.emit('initiative.next');
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(getState(campaignId).currentTokenId).toBe(HERO);
    };
    await withSheet(['Survivor'], { hp: { current: 15, maximum: 30, temporary: 0 } });
    await startHeroTurn();
    expect(await heroHp()).toBe(22);

    await startHeroTurn();
    expect(await heroHp()).toBe(22);

    await withSheet(['Survivor'], { hp: { current: 0, maximum: 30, temporary: 0 } });
    await startHeroTurn();
    expect(await heroHp()).toBe(0);
  });
});
