/**
 * Resolving an attack, over the socket.
 *
 * The server lists what a token can do, makes the attack roll by the rules,
 * takes the damage from the target's hit points, wherever they are kept, and
 * puts the roll in the dice log. A player attacks only with their own token.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson, readTokens } from '../../utils/prisma-json';
import { createWsTestServer, waitForEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { setState, getState, clearState, type CombatantEntry } from '../initiativeState';
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

interface Answer {
  ok: boolean;
  error?: string;
  summary?: string;
  targets?: Array<{ tokenId: string; saved: boolean; total: number | null; dealt: number }>;
  hit?: boolean;
  critical?: boolean;
  dealt?: number;
  distanceFeet?: number;
  actions?: Array<{ index: number; name: string; cost: string; attack: { kind: string; bonus: number; damage: string } | null }>;
}
const ask = (socket: ClientSocket, event: string, payload: unknown) =>
  new Promise<Answer>((resolve) => socket.emit(event, payload, resolve));

const entry = (tokenId: string, name: string, initiative: number): CombatantEntry => ({
  tokenId, mapId, name, imageUrl: '', initiative, hp: null, type: 'npc', disposition: null,
});

const token = (id: string, name: string, x: number, extra: Record<string, unknown> = {}) => ({
  id, name, imageUrl: '', position: { x, y: 1 }, size: { width: 1, height: 1 }, layer: 'token', visible: true,
  controlledBy: null, rotation: 0, conditions: [], metadata: {}, ...extra,
});
const ogreBlock = {
  ac: 11,
  abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
  actions: [
    { name: 'Greatclub', description: 'Melee Attack Roll: +6, reach 5 ft. Hit: 13 (2d8 + 4) Bludgeoning damage.' },
    { name: 'Javelin', description: 'Ranged Attack Roll: +6, range 30/120 ft. Hit: 11 (2d6 + 4) Piercing damage.' },
    { name: 'Roar', description: 'The ogre roars.' },
    { name: 'Stomp', description: 'Dexterity Saving Throw: DC 13, each creature within 10 feet. Failure: 9 (2d8) Thunder damage. Success: Half damage.' },
  ],
};
const freshTokens = () => [
  token(HERO, 'Hero', 1, { controlledBy: playerId, characterId: heroCharacterId }),
  token(OGRE, 'Ogre', 2, { hp: { current: 59, max: 59, temp: 0 }, statBlock: ogreBlock }),
  token(FAR, 'Far Ogre', 8, { hp: { current: 59, max: 59, temp: 0 }, statBlock: ogreBlock }),
  token(LURKER, 'Lurker', 1, { position: { x: 1, y: 2 }, visible: false, hp: { current: 10, max: 10, temp: 0 }, statBlock: ogreBlock }),
];
const heroSheet = () => ({
  hp: { current: 30, maximum: 30, temporary: 0 },
  armorClass: 16,
  savingThrows: { strength: { bonus: 2 }, dexterity: { bonus: 4 }, constitution: { bonus: 2 }, intelligence: { bonus: 0 }, wisdom: { bonus: 1 }, charisma: { bonus: 0 } },
  attacks: [{ name: 'Longsword', attackBonus: 5, damageRoll: '1d8+3', damageType: 'slashing' }],
  spellcasting: { spellAttackBonus: 6, spellSaveDC: 14, cantrips: ['Fire Bolt'], spells: [{ name: 'Fireball', level: 3, prepared: true, ritual: false, concentration: false }], slots: { '3': { total: 2, expended: 0 }, '4': { total: 1, expended: 0 } } },
});

let rolls: number[] = [];

beforeAll(async () => {
  dmId = (await prisma.user.create({ data: { email: `atk-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' } })).id;
  playerId = (await prisma.user.create({ data: { email: `atk-player-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Player' } })).id;
  campaignId = (await prisma.campaign.create({ data: { name: `Attack ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' } })).id;
  heroCharacterId = (await prisma.character.create({
    data: { userId: playerId, campaignId, name: 'Hero', gameSystem: 'DND_5E', data: toJson(heroSheet()) },
  })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [heroCharacterId] },
    ],
  });
  mapId = (await prisma.map.create({
    data: {
      campaignId, name: 'Attack', imageUrl: '/api/assets/maps/x', baseLayerUrl: '/api/assets/maps/x', width: 10, height: 10,
      gridSize: 50, annotations: [], fogEnabled: false, tokens: toJson(freshTokens()),
    },
  })).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId, status: 'ACTIVE' } });
  server = await createWsTestServer();
});

beforeEach(async () => {
  clearState(campaignId);
  await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(freshTokens()) } });
  await prisma.character.update({ where: { id: heroCharacterId }, data: { data: toJson(heroSheet()) } });
  // The dice come up as the test says: the d20 first, then each damage die.
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

const heroSlots = async () =>
  ((await prisma.character.findUniqueOrThrow({ where: { id: heroCharacterId } })).data as { spellcasting: { slots: Record<string, unknown> } }).spellcasting.slots;
const ogreHp = async () => readTokens((await prisma.map.findUniqueOrThrow({ where: { id: mapId } })).tokens).find((t) => t.id === OGRE)?.hp;
const heroHp = async () =>
  ((await prisma.character.findUniqueOrThrow({ where: { id: heroCharacterId } })).data as { hp: { current: number } }).hp.current;

describe('combat.actions', () => {
  it("lists a character's attacks for the player who controls its token", async () => {
    const answer = await ask(player, 'combat.actions', { tokenId: HERO });
    expect(answer.ok).toBe(true);
    expect(answer.actions).toEqual([
      expect.objectContaining({ index: 0, name: 'Longsword', attack: expect.objectContaining({ kind: 'melee', bonus: 5, damage: '1d8+3 slashing' }) }),
      expect.objectContaining({ index: 1, name: 'Fire Bolt', attack: expect.objectContaining({ kind: 'ranged', bonus: 6, damage: '1d10 fire' }) }),
      expect.objectContaining({ index: 2, name: 'Fireball', attack: null, spell: { level: 3, slotLevels: [3, 4] }, save: expect.objectContaining({ ability: 'dex', dc: 14, damage: '8d6 fire', halfOnSuccess: true }) }),
    ]);
  });

  it("lists a stat block's actions for the DM, with the ones it cannot roll", async () => {
    const answer = await ask(dm, 'combat.actions', { tokenId: OGRE });
    expect(answer.actions?.map((action) => [action.name, action.attack?.kind ?? null])).toEqual([
      ['Greatclub', 'melee'],
      ['Javelin', 'ranged'],
      ['Roar', null],
      ['Stomp', null],
    ]);
  });

  it("refuses a player another's token", async () => {
    expect(await ask(player, 'combat.actions', { tokenId: OGRE })).toEqual({ ok: false, error: 'You can only act for your own token' });
  });
});

describe('combat.attack', () => {
  it("takes a hit from an NPC token's hit points and tells the table", async () => {
    rolls = [12, 6];
    const mapSent = waitForEvent<{ mapId: string }>(dm, 'map.changed');
    const logged = waitForEvent<{ purpose: string; result: number; characterName: string; secret: boolean }>(dm, 'dice.rolled');

    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: 0 });

    expect(answer).toMatchObject({ ok: true, hit: true, critical: false, dealt: 9, distanceFeet: 5 });
    expect(answer.summary).toBe('Longsword vs Ogre (AC 11): hit, 9 slashing damage');
    expect(await ogreHp()).toEqual({ current: 50, max: 59, temp: 0 });
    expect((await mapSent).mapId).toBe(mapId);
    expect(await logged).toMatchObject({ purpose: answer.summary, result: 17, characterName: 'Hero', secret: false });
  });

  it("takes a hit from a character's sheet", async () => {
    rolls = [15, 4, 4];
    const hpSent = waitForEvent<{ characterId: string; hp: { current: number } }>(player, 'character.hp.updated');

    const answer = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0 });

    expect(answer).toMatchObject({ ok: true, hit: true, dealt: 12 });
    expect(await hpSent).toMatchObject({ characterId: heroCharacterId, hp: { current: 18 } });
    expect(await heroHp()).toBe(18);
  });

  it('changes nothing on a miss, and still logs the roll', async () => {
    rolls = [2];
    const logged = waitForEvent<{ result: number }>(dm, 'dice.rolled');

    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: 0 });

    expect(answer).toMatchObject({ ok: true, hit: false, dealt: 0 });
    expect((await logged).result).toBe(7);
    expect((await ogreHp())?.current).toBe(59);
  });

  it('makes a spell attack from the sheet, at range', async () => {
    rolls = [10, 7];

    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: FAR, action: 1 });

    expect(answer).toMatchObject({ ok: true, hit: true, dealt: 7, distanceFeet: 35 });
    // The nearer ogre stands in the way: half cover.
    expect(answer.summary).toBe('Fire Bolt vs Far Ogre (AC 13): hit, 7 fire damage');
  });

  it('refuses a target out of reach, and rolls nothing', async () => {
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: FAR, action: 0 });
    expect(answer.ok).toBe(false);
    expect(answer.error).toMatch(/reach/i);
    expect(d20.rollDie).not.toHaveBeenCalled();
  });

  it("refuses a player another's token as the attacker", async () => {
    expect(await ask(player, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0 })).toEqual({
      ok: false,
      error: 'You can only attack with your own token',
    });
    expect(await heroHp()).toBe(30);
  });

  it('tells a player a hidden token is not there', async () => {
    expect(await ask(player, 'combat.attack', { attackerId: HERO, targetId: LURKER, action: 0 })).toEqual({
      ok: false,
      error: 'That target is not on the map',
    });
  });

  it('refuses an action that makes no attack roll', async () => {
    const answer = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 2 });
    expect(answer.ok).toBe(false);
    expect(await heroHp()).toBe(30);
  });

  it("spends the acting combatant's action", async () => {
    setState(campaignId, { active: true, round: 1, currentTokenId: HERO, combatants: [entry(HERO, 'Hero', 18), entry(OGRE, 'Ogre', 9)] });
    rolls = [2];

    await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: 0 });

    expect(getState(campaignId).turn?.action).toBe('Attack');
  });

  it('refuses a payload it does not know', async () => {
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: HERO, action: 0 })).ok).toBe(false);
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: 0, bonus: 99 })).ok).toBe(false);
  });
});

describe('combat.save', () => {
  it('rolls the damage once and a save for each target, on tokens and on sheets', async () => {
    // Fireball from the hero's sheet at the two ogres: 8d6 all threes = 24;
    // the near ogre rolls 3 (-1 = 2, fails), the far one 18 (-1 = 17, saves).
    rolls = [3, 3, 3, 3, 3, 3, 3, 3, 3, 18];
    const logged = waitForEvent<{ purpose: string; result: number; expression: string }>(dm, 'dice.rolled');

    const answer = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE, FAR], action: 2 });

    expect(answer.ok).toBe(true);
    expect(answer.targets).toEqual([
      { tokenId: OGRE, saved: false, total: 2, dealt: 24 },
      { tokenId: FAR, saved: true, total: 17, dealt: 12 },
    ]);
    const tokens = readTokens((await prisma.map.findUniqueOrThrow({ where: { id: mapId } })).tokens);
    expect(tokens.find((t) => t.id === OGRE)?.hp?.current).toBe(35);
    expect(tokens.find((t) => t.id === FAR)?.hp?.current).toBe(47);
    expect(await logged).toMatchObject({ result: 24, expression: '8d6', purpose: answer.summary });
    expect(await heroSlots()).toMatchObject({ '3': { total: 2, expended: 1 }, '4': { total: 1, expended: 0 } });
  });

  it('casts with a higher slot for more dice, spends that slot and tells the table', async () => {
    rolls = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const sheetSent = waitForEvent<{ characterId: string }>(dm, 'character.updated');

    const answer = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: 2, slotLevel: 4 });

    // Nine dice at level 4; the ogre's save of 1 - 1 fails.
    expect(answer.targets).toEqual([{ tokenId: OGRE, saved: false, total: 0, dealt: 9 }]);
    expect((await sheetSent).characterId).toBe(heroCharacterId);
    expect(await heroSlots()).toMatchObject({ '3': { expended: 0 }, '4': { expended: 1 } });
  });

  it('refuses a cast with no slot left, and one that fails spends nothing', async () => {
    expect((await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: 2, slotLevel: 5 })).error).toBe('No level 5 spell slot left to cast Fireball');
    expect((await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: 2, slotLevel: 2 })).error).toBe('Fireball needs a spell slot of level 3 or higher');
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: 1, slotLevel: 3 })).error).toBe('Fire Bolt is a cantrip, and takes no spell slot');
    expect(await heroSlots()).toMatchObject({ '3': { expended: 0 }, '4': { expended: 0 } });
    expect((await ogreHp())?.current).toBe(59);
  });

  it("takes a stat block's save effect from a character's sheet", async () => {
    // Stomp: 2d8 = 5 + 6; the hero rolls 4 (+4 = 8, fails DC 13).
    rolls = [5, 6, 4];
    const hpSent = waitForEvent<{ hp: { current: number } }>(player, 'character.hp.updated');

    const answer = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [HERO], action: 3 });

    expect(answer.targets).toEqual([{ tokenId: HERO, saved: false, total: 8, dealt: 11 }]);
    expect((await hpSent).hp.current).toBe(19);
  });

  it('refuses a player another creature, a hidden target and an action with no save', async () => {
    expect((await ask(player, 'combat.save', { sourceId: OGRE, targetIds: [HERO], action: 3 })).error).toBe('You can only act for your own token');
    expect((await ask(player, 'combat.save', { sourceId: HERO, targetIds: [LURKER], action: 2 })).error).toBe('That target is not on the map');
    expect((await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: 0 })).ok).toBe(false);
    expect((await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE, OGRE], action: 2 })).ok).toBe(false);
    expect((await ogreHp())?.current).toBe(59);
  });
});

describe('death saving throws', () => {
  const downed = (deathSaves = { successes: 0, failures: 0 }) =>
    prisma.character.update({ where: { id: heroCharacterId }, data: { data: toJson({ ...heroSheet(), hp: { current: 0, maximum: 30, temporary: 0 }, deathSaves }) } });
  const saves = async () =>
    ((await prisma.character.findUniqueOrThrow({ where: { id: heroCharacterId } })).data as { deathSaves: unknown }).deathSaves;
  type Rolled = Answer & { natural?: number; result?: string; saves?: { successes: number; failures: number } };

  it('marks a success or a failure on the sheet, and logs the roll', async () => {
    await downed();
    rolls = [12];
    const logged = waitForEvent<{ purpose: string; result: number }>(dm, 'dice.rolled');
    const sheetSent = waitForEvent<{ characterId: string }>(dm, 'character.updated');

    const answer: Rolled = await ask(player, 'combat.deathSave', { tokenId: HERO });

    expect(answer).toMatchObject({ ok: true, natural: 12, result: 'continues', saves: { successes: 1, failures: 0 } });
    expect(await saves()).toEqual({ successes: 1, failures: 0 });
    expect(await logged).toMatchObject({ result: 12, purpose: 'Hero death save: success (1 successes, 0 failures)' });
    expect((await sheetSent).characterId).toBe(heroCharacterId);
  });

  it('counts a 1 as two failures, and the third failure as death', async () => {
    await downed({ successes: 0, failures: 1 });
    rolls = [1];
    const answer: Rolled = await ask(player, 'combat.deathSave', { tokenId: HERO });
    expect(answer).toMatchObject({ result: 'dead', saves: { successes: 0, failures: 3 } });
    expect((await ask(player, 'combat.deathSave', { tokenId: HERO })).error).toBe('Hero has no more death saves to make');
  });

  it('revives with 1 Hit Point on a 20', async () => {
    await downed({ successes: 1, failures: 2 });
    rolls = [20];
    const hpSent = waitForEvent<{ hp: { current: number } }>(dm, 'character.hp.updated');
    const answer: Rolled = await ask(player, 'combat.deathSave', { tokenId: HERO });
    expect(answer).toMatchObject({ result: 'revived', saves: { successes: 0, failures: 0 } });
    expect((await hpSent).hp.current).toBe(1);
    expect(await heroHp()).toBe(1);
  });

  it('refuses a character on its feet, a token with no sheet and another player’s token', async () => {
    expect((await ask(player, 'combat.deathSave', { tokenId: HERO })).error).toBe('Hero is not at 0 Hit Points');
    expect((await ask(dm, 'combat.deathSave', { tokenId: OGRE })).error).toBe('Ogre has no D&D character sheet to keep death saves on');
    expect((await ask(player, 'combat.deathSave', { tokenId: OGRE })).error).toBe('You can only act for your own token');
  });

  it('counts a hit on a character at 0 Hit Points as a failure, two on a critical hit', async () => {
    await downed();
    rolls = [15, 4, 4];
    await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0 });
    expect(await saves()).toEqual({ successes: 0, failures: 1 });

    rolls = [20, 4, 4, 4, 4];
    await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0 });
    expect(await saves()).toEqual({ successes: 0, failures: 3 });
  });

  it('starts the saves afresh when a hit drops a character to 0', async () => {
    await prisma.character.update({ where: { id: heroCharacterId }, data: { data: toJson({ ...heroSheet(), hp: { current: 5, maximum: 30, temporary: 0 }, deathSaves: { successes: 2, failures: 2 } }) } });
    rolls = [15, 4, 4];
    await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0 });
    expect(await heroHp()).toBe(0);
    expect(await saves()).toEqual({ successes: 0, failures: 0 });
  });
});
