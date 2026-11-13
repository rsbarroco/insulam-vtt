/**
 * Class features with uses, over the socket: Second Wind heals and spends
 * the Bonus Action, Action Surge gives back the action once a turn, and
 * rests give the uses back.
 *
 * The fixtures are those of combatAttack.integration.test.ts.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson } from '../../utils/prisma-json';
import { createWsTestServer, waitForEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
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
  actions?: Array<{ index: number; name: string; cost: string; attack: { kind: string; bonus: number; damage: string } | null }>;
}
const ask = (socket: ClientSocket, event: string, payload: unknown) =>
  new Promise<Answer>((resolve) => socket.emit(event, payload, resolve));


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
  proficiencyBonus: 2,
  stats: { strength: { score: 16, modifier: 3 }, wisdom: { score: 12, modifier: 1 } },
  skills: { stealth: { proficient: true, expertise: false, bonus: 6 }, perception: { proficient: true, expertise: false, bonus: 4 } },
  spellcasting: { spellAttackBonus: 6, spellSaveDC: 14, cantrips: ['Fire Bolt'], spells: [{ name: 'Fireball', level: 3, prepared: true, ritual: false, concentration: false }], slots: { '3': { total: 2, expended: 0 }, '4': { total: 1, expended: 0 } } },
});

let rolls: number[] = [];

beforeAll(async () => {
  dmId = (await prisma.user.create({ data: { email: `feature-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' } })).id;
  playerId = (await prisma.user.create({ data: { email: `feature-player-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Player' } })).id;
  campaignId = (await prisma.campaign.create({ data: { name: `Feature ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' } })).id;
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

const sheetOfHero = async () =>
  (await prisma.character.findUniqueOrThrow({ where: { id: heroCharacterId } })).data as {
    hp: { current: number };
    featureUses?: Record<string, number>;
  };
const fighter = (featureUses: Record<string, number> = {}) =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: { data: toJson({ ...heroSheet(), class: 'Fighter', level: 4, hp: { current: 10, maximum: 30, temporary: 0 }, featureUses }) },
  });
const entry = (tokenId: string, name: string, initiative: number): CombatantEntry => ({
  tokenId, mapId, name, imageUrl: '', initiative, hp: null, type: 'npc', disposition: null,
});
const fight = (turn: Record<string, unknown> = {}) =>
  setState(campaignId, {
    active: true, round: 1, currentTokenId: HERO,
    combatants: [entry(HERO, 'Hero', 18), entry(OGRE, 'Ogre', 9)],
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0, ...turn },
  });

describe('combat.feature', () => {
  it('heals 1d10 + level with Second Wind, spends a use and the Bonus Action, and logs it', async () => {
    await fighter();
    fight();
    rolls = [6];
    const logged = waitForEvent<{ expression: string; result: number }>(dm, 'dice.rolled');

    const answer = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Second Wind' });

    expect(answer).toEqual({ ok: true, left: 2, summary: 'Hero uses Second Wind: regains 10 Hit Points (2 uses left)' });
    expect(await logged).toMatchObject({ expression: '1d10+4', result: 10 });
    expect(await sheetOfHero()).toMatchObject({ hp: { current: 20 }, featureUses: { 'Second Wind': 1 } });
    expect(getState(campaignId).turn?.bonusAction).toBe(true);
  });

  it('refuses Second Wind with the Bonus Action spent, or no uses left', async () => {
    await fighter();
    fight({ bonusAction: true });
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Second Wind' })).error).toBe('Hero has used its Bonus Action this turn');
    await fighter({ 'Second Wind': 3 });
    clearState(campaignId);
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Second Wind' })).error).toBe('Hero: No uses of Second Wind left until a rest');
  });

  it('gives the action back with Action Surge, once a turn', async () => {
    await fighter();
    fight({ action: 'Attack', attacks: 1 });

    const answer = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Action Surge' });

    expect(answer.summary).toBe('Hero uses Action Surge: one more action this turn, not the Magic action (0 uses left)');
    expect(getState(campaignId).turn).toMatchObject({ action: null, attacks: 0 });
    await fighter();
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Action Surge' })).error).toBe('Hero has used Action Surge this turn');
  });

  it('refuses Action Surge off the character’s turn', async () => {
    await fighter();
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Action Surge' })).error).toBe('Action Surge is used on the character’s own turn');
  });
});

describe('rests give the uses back', () => {
  it('a Short Rest gives one Second Wind and every Action Surge', async () => {
    await fighter({ 'Second Wind': 3, 'Action Surge': 1 });
    const answer = await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'shortFinish' });
    expect(answer.summary).toBe('Hero finishes a Short Rest: 1 Second Wind, 1 Action Surge');
    expect((await sheetOfHero()).featureUses).toEqual({ 'Second Wind': 2 });
  });

  it('a Long Rest gives them all', async () => {
    await fighter({ 'Second Wind': 3, 'Action Surge': 1 });
    await ask(dm, 'combat.rest', { characterId: heroCharacterId, kind: 'long' });
    expect((await sheetOfHero()).featureUses).toEqual({});
  });

  it('the actions answer lists them, with what is left', async () => {
    await fighter({ 'Second Wind': 1 });
    const answer = (await ask(player, 'combat.actions', { tokenId: HERO })) as unknown as { resources: unknown };
    expect(answer.resources).toEqual([
      { name: 'Second Wind', max: 3, used: 1 },
      { name: 'Action Surge', max: 1, used: 0 },
    ]);
  });
});

describe('Rage', () => {
  const barbarian = () =>
    prisma.character.update({
      where: { id: heroCharacterId },
      data: {
        data: toJson({
          ...heroSheet(),
          class: 'Barbarian',
          level: 3,
          stats: { strength: { score: 16, modifier: 3 }, dexterity: { score: 12, modifier: 1 } },
          hp: { current: 30, maximum: 30, temporary: 0 },
        }),
      },
    });
  const rage = () => ask(player, 'combat.feature', { tokenId: HERO, feature: 'Rage' });

  it('spends a use and the Bonus Action, and marks the barbarian raging', async () => {
    await barbarian();
    fight();
    const answer = await rage();
    expect(answer.summary).toMatch(/^Hero enters a Rage: .* \+2 damage on Strength attacks, .* \(2 uses left\)$/);
    expect(getState(campaignId).marks).toEqual([{ kind: 'rage', attackerId: HERO, targetId: HERO, turnEndsLeft: 2 }]);
    expect(getState(campaignId).turn?.bonusAction).toBe(true);
    expect((await sheetOfHero()).featureUses).toEqual({ Rage: 1 });
    expect((await rage()).error).toBe('Hero is already raging');
  });

  it('adds its Rage Damage to a Strength attack, and halves Slashing damage taken', async () => {
    await barbarian();
    fight();
    await rage();
    // Longsword: a hit, 1d8+3 with a 4, and +2 from the Rage.
    rolls = [15, 4];
    expect(await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: 0 })).toMatchObject({ hit: true, dealt: 9 });

    // The ogre's greatclub: 2d8+4 with 3 and 3 is 10 Bludgeoning, halved.
    rolls = [15, 3, 3];
    expect(await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0 })).toMatchObject({ hit: true, dealt: 5 });
  });

  it('casts no spells while raging, and ends when asked', async () => {
    await barbarian();
    fight();
    await rage();
    expect((await ask(dm, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: 1 })).error).toBe('Hero cannot cast spells while raging');
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'End Rage' })).summary).toBe("Hero's Rage ends");
    expect(getState(campaignId).marks).toEqual([]);
  });

  it('is kept only during combat', async () => {
    await barbarian();
    expect((await rage()).error).toBe('A Rage is kept during combat');
  });
});
