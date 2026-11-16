/**
 * An Evoker over the socket: Potent Cantrip's half damage on a miss and on a
 * successful save, Sculpt Spells protecting the creatures picked, Empowered
 * Evocation's Intelligence modifier, Overchannel's maximum damage and what
 * its later uses cost, and Magic Missile's darts divided among targets.
 *
 * The fixtures are those of metamagic.integration.test.ts.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson } from '../../utils/prisma-json';
import { createWsTestServer, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { clearState, setState, type CombatantEntry } from '../initiativeState';
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
const heroSheet = () => ({
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
    cantrips: ['Fire Bolt', 'Poison Spray', 'Acid Splash'],
    spells: [
      { name: 'Fireball', level: 3, prepared: true, ritual: false, concentration: false },
      { name: 'Magic Missile', level: 1, prepared: true, ritual: false, concentration: false },
      { name: 'Hold Person', level: 2, prepared: true, ritual: false, concentration: true },
    ],
    slots: { '1': { total: 4, expended: 0 }, '2': { total: 2, expended: 0 }, '3': { total: 3, expended: 0 }, '6': { total: 1, expended: 0 } },
  },
});

let rolls: number[] = [];

beforeAll(async () => {
  dmId = (
    await prisma.user.create({
      data: { email: `evoker-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `evoker-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `Evoker ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
const indexOf = async (name: string) => {
  const listed = (await ask(player, 'combat.actions', { tokenId: HERO })) as unknown as {
    actions: Array<{ index: number; name: string }>;
  };
  return listed.actions.find((action) => action.name === name)!.index;
};
const asEvoker = (features: string[], featureUses: Record<string, number> = {}) =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: {
      data: toJson({
        ...heroSheet(),
        class: 'Wizard',
        level: 14,
        stats: { strength: { score: 10, modifier: 0 }, intelligence: { score: 18, modifier: 4 } },
        featuresAndTraits: features.map((name) => ({ name })),
        featureUses,
      }),
    },
  });
const sheetNow = async () =>
  (await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data as {
    hp: { current: number };
    featureUses?: Record<string, number>;
    spellcasting: { slots: Record<string, { expended: number }> };
  };
const tokenHp = async (id: string) =>
  ((await prisma.map.findUnique({ where: { id: mapId } }))!.tokens as unknown as Array<{ id: string; hp?: { current: number } }>).find(
    (entry) => entry.id === id
  )?.hp?.current;
const eightOnes = [1, 1, 1, 1, 1, 1, 1, 1];

describe('Potent Cantrip', () => {
  it('deals half damage on a missed attack roll', async () => {
    fight();
    await asEvoker(['Potent Cantrip']);
    // 2 + 6 misses AC 11; the level 14 Fire Bolt's 3d10 come up 7, 4 and 4: half of 15.
    rolls = [2, 7, 4, 4];
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await indexOf('Fire Bolt') });
    expect(answer).toMatchObject({ ok: true, hit: false, dealt: 7 });
    expect(answer.summary).toContain('miss, half damage: 7 fire damage');
    expect(answer.summary).toContain('Potent Cantrip');
    expect(await tokenHp(OGRE)).toBe(52);
  });

  it('deals nothing on a miss without the feature', async () => {
    fight();
    await asEvoker([]);
    rolls = [2];
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await indexOf('Fire Bolt') });
    expect(answer).toMatchObject({ ok: true, hit: false, dealt: 0 });
  });

  it('deals half damage to a creature that saves against the cantrip', async () => {
    fight();
    await asEvoker(['Potent Cantrip']);
    // Acid Splash at level 14 is 3d6: 6, 5 and 4; the ogre's 19 - 1 saves against DC 14.
    rolls = [6, 5, 4, 19];
    const answer = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: await indexOf('Acid Splash') });
    expect(answer.targets?.[0]).toMatchObject({ saved: true, dealt: 7 });
    expect(answer.summary).toContain('Potent Cantrip');
  });
});

describe('Sculpt Spells', () => {
  const fireball = async (extra: Record<string, unknown>) =>
    ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE, ALLY], action: await indexOf('Fireball'), slotLevel: 3, ...extra });

  it('makes the creatures picked succeed and take no damage', async () => {
    fight();
    await asEvoker(['Sculpt Spells']);
    rolls = [...eightOnes, 2];
    const answer = await fireball({ sculpt: { targetIds: [ALLY] } });
    expect(answer.targets).toEqual([
      expect.objectContaining({ tokenId: OGRE, saved: false, dealt: 8 }),
      expect.objectContaining({ tokenId: ALLY, saved: true, total: null, dealt: 0 }),
    ]);
    expect(answer.summary).toContain('(Sculpt Spells)');
  });

  it('refuses a sheet without it, the caster itself, and a spell of another school', async () => {
    fight();
    await asEvoker([]);
    expect((await fireball({ sculpt: { targetIds: [ALLY] } })).error).toBe('Hero has no Sculpt Spells');
    await asEvoker(['Sculpt Spells']);
    expect((await fireball({ sculpt: { targetIds: [FAR] } })).error).toBe("Sculpt Spells picks creatures among the spell's targets");
    const held = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: await indexOf('Hold Person'), sculpt: { targetIds: [OGRE] } });
    expect(held.error).toBe('Sculpt Spells changes a spell of the Evocation school');
    expect((await sheetNow()).spellcasting.slots['3'].expended).toBe(0);
  });

  it('tells the menu which spells it can change', async () => {
    await asEvoker(['Sculpt Spells', 'Overchannel']);
    const listed = (await ask(player, 'combat.actions', { tokenId: HERO })) as unknown as {
      actions: Array<{ name: string; sculpt?: boolean; overchannel?: boolean; darts?: { count: number; damage: string } }>;
    };
    const named = (name: string) => listed.actions.find((action) => action.name === name)!;
    expect(named('Fireball')).toMatchObject({ sculpt: true, overchannel: true });
    expect(named('Hold Person').sculpt).toBeUndefined();
    expect(named('Fire Bolt').overchannel).toBeUndefined();
    expect(named('Magic Missile')).toMatchObject({ overchannel: true, darts: { count: 3, damage: '1d4+1 force' } });
  });
});

describe('Empowered Evocation', () => {
  it('adds the Intelligence modifier to the damage roll of a Wizard Evocation spell', async () => {
    fight();
    await asEvoker(['Empowered Evocation']);
    rolls = [...eightOnes, 2];
    const answer = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: await indexOf('Fireball'), slotLevel: 3 });
    expect(answer.targets?.[0]).toMatchObject({ saved: false, dealt: 12 });
    expect(answer.summary).toContain('Empowered Evocation +4');
  });

  it('adds it to a cantrip’s hit, and nothing to a spell of another school', async () => {
    fight();
    await asEvoker(['Empowered Evocation']);
    // 15 + 6 hits; 3d10 of 2s, + 4.
    rolls = [15, 2, 2, 2];
    const bolt = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await indexOf('Fire Bolt') });
    expect(bolt).toMatchObject({ ok: true, hit: true, dealt: 10 });
    expect(bolt.summary).toContain('Empowered Evocation +4');
    fight();
    // Poison Spray is Necromancy: 3d12 of 2s.
    rolls = [15, 2, 2, 2];
    const spray = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await indexOf('Poison Spray') });
    expect(spray).toMatchObject({ ok: true, hit: true, dealt: 6 });
    expect(spray.summary).not.toContain('Empowered Evocation');
  });
});

describe('Overchannel', () => {
  const fireball = async (slotLevel = 3) =>
    ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: await indexOf('Fireball'), slotLevel, overchannel: true });

  it('deals maximum damage, free the first time', async () => {
    fight();
    await asEvoker(['Overchannel']);
    // No damage die is rolled: the first roll is the ogre's save.
    rolls = [2];
    const answer = await fireball();
    expect(answer.targets?.[0]).toMatchObject({ saved: false, dealt: 48 });
    expect(answer.summary).toContain('Overchannel: maximum damage');
    const sheet = await sheetNow();
    expect(sheet.featureUses?.Overchannel).toBe(1);
    expect(sheet.hp.current).toBe(30);
  });

  it('deals the Wizard 2d12 Necrotic a slot level the second time, 3d12 the third', async () => {
    fight();
    await asEvoker(['Overchannel'], { Overchannel: 1 });
    // The save, then 6d12 of 1s.
    rolls = [2, 1, 1, 1, 1, 1, 1];
    const second = await fireball();
    expect(second.summary).toContain('Hero takes 6 Necrotic damage (6d12)');
    expect((await sheetNow()).hp.current).toBe(24);
    expect((await sheetNow()).featureUses?.Overchannel).toBe(2);
    fight();
    rolls = [2, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const third = await fireball();
    expect(third.summary).toContain('Hero takes 9 Necrotic damage (9d12)');
    expect((await sheetNow()).hp.current).toBe(15);
  });

  it('refuses a cantrip, a slot above level 5 and a sheet without it', async () => {
    fight();
    await asEvoker(['Overchannel']);
    expect((await fireball(6)).error).toBe('Overchannel changes a spell cast with a spell slot of level 1 to 5');
    const bolt = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await indexOf('Fire Bolt'), overchannel: true });
    expect(bolt.error).toBe('Overchannel changes a spell cast with a spell slot of level 1 to 5');
    await asEvoker([]);
    expect((await fireball()).error).toBe('Hero has no Overchannel');
    expect((await sheetNow()).spellcasting.slots['3'].expended).toBe(0);
  });
});

describe('Magic Missile', () => {
  const missile = async (extra: Record<string, unknown>) =>
    ask(player, 'combat.save', { sourceId: HERO, action: await indexOf('Magic Missile'), ...extra });

  it('strikes with no roll, the darts divided among the targets', async () => {
    fight();
    await asEvoker([]);
    rolls = [4, 2, 3];
    const answer = await missile({ targetIds: [OGRE, ALLY], darts: [2, 1] });
    expect(answer.targets).toEqual([
      expect.objectContaining({ tokenId: OGRE, dealt: 8 }),
      expect.objectContaining({ tokenId: ALLY, dealt: 4 }),
    ]);
    expect(answer.summary).toContain('Ogre is struck by 2 darts (5 + 3): 8 force damage');
    expect(await tokenHp(OGRE)).toBe(51);
    expect(await tokenHp(ALLY)).toBe(6);
    expect((await sheetNow()).spellcasting.slots['1'].expended).toBe(1);
  });

  it('sends every dart at a single target, one more a slot level, with Empowered Evocation on one', async () => {
    fight();
    await asEvoker(['Empowered Evocation']);
    rolls = [1, 1, 1, 1];
    const answer = await missile({ targetIds: [OGRE], slotLevel: 2 });
    // Four darts of 2, and + 4 on one.
    expect(answer.targets?.[0]).toMatchObject({ dealt: 12 });
    expect(answer.summary).toContain('Empowered Evocation +4');
    expect((await sheetNow()).spellcasting.slots['2'].expended).toBe(1);
  });

  it('deals 5 a dart with Overchannel', async () => {
    fight();
    await asEvoker(['Overchannel']);
    const answer = await missile({ targetIds: [OGRE], overchannel: true });
    expect(answer.targets?.[0]).toMatchObject({ dealt: 15 });
  });

  it('refuses darts that do not add up, and darts for another spell', async () => {
    fight();
    await asEvoker([]);
    expect((await missile({ targetIds: [OGRE, ALLY], darts: [1, 1] })).error).toBe('Magic Missile makes 3 darts; 2 were divided');
    expect((await missile({ targetIds: [OGRE, ALLY] })).error).toBe('Say how many of the 3 darts strike each creature');
    const ball = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: await indexOf('Fireball'), darts: [3] });
    expect(ball.error).toBe('Fireball has no darts to divide');
    expect((await sheetNow()).spellcasting.slots['1'].expended).toBe(0);
  });
});
