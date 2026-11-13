/**
 * The Unarmed Strike, over the socket: every creature has one, and it
 * strikes for damage, grapples, knocks Prone or pushes. In a file of its own
 * so that the sockets it opens stay under the ceiling on joining a campaign.
 *
 * The fixtures are those of combatAttack.integration.test.ts.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson, readTokens } from '../../utils/prisma-json';
import { createWsTestServer, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
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
  total?: number;
  success?: boolean | null;
  hidden?: boolean;
  reasons?: string[];
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
  proficiencyBonus: 2,
  stats: { strength: { score: 16, modifier: 3 }, wisdom: { score: 12, modifier: 1 } },
  skills: { stealth: { proficient: true, expertise: false, bonus: 6 }, perception: { proficient: true, expertise: false, bonus: 4 } },
  spellcasting: { spellAttackBonus: 6, spellSaveDC: 14, cantrips: ['Fire Bolt'], spells: [{ name: 'Fireball', level: 3, prepared: true, ritual: false, concentration: false }], slots: { '3': { total: 2, expended: 0 }, '4': { total: 1, expended: 0 } } },
});

let rolls: number[] = [];

beforeAll(async () => {
  dmId = (await prisma.user.create({ data: { email: `unarmed-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' } })).id;
  playerId = (await prisma.user.create({ data: { email: `unarmed-player-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Player' } })).id;
  campaignId = (await prisma.campaign.create({ data: { name: `Unarmed ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' } })).id;
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

describe('the Unarmed Strike', () => {
  const tokenOf = async (id: string) => readTokens((await prisma.map.findUniqueOrThrow({ where: { id: mapId } })).tokens).find((t) => t.id === id);
  // The hero's own three actions come first: 3 strikes, 4 grapples, 5 knocks Prone, 6 pushes.
  const STRIKE = 3, GRAPPLE = 4, PRONE = 5, PUSH = 6;

  it('hits for 1 plus Strength of Bludgeoning damage, with no die', async () => {
    rolls = [10];
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: STRIKE });
    expect(answer).toMatchObject({ ok: true, hit: true, dealt: 4, summary: 'Unarmed Strike vs Ogre (AC 11): hit, 4 bludgeoning damage' });
    expect((await tokenOf(OGRE))?.hp?.current).toBe(55);
  });

  it('grapples a target that fails its save: Grappled, and an attack of the Attack action', async () => {
    setState(campaignId, { active: true, round: 1, currentTokenId: HERO, combatants: [entry(HERO, 'Hero', 18), entry(OGRE, 'Ogre', 9)] });
    // The ogre saves with Strength (+4, its better) against DC 13: a 5 is 9.
    rolls = [5];

    const answer = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: GRAPPLE });

    expect(answer.ok).toBe(true);
    expect(answer.targets).toEqual([{ tokenId: OGRE, saved: false, total: 9, dealt: 0 }]);
    expect(answer.summary).toMatch(/: Ogre is Grappled \(escape DC 13\)$/);
    expect((await tokenOf(OGRE))?.conditions).toEqual(['Grappled']);
    expect(getState(campaignId).turn).toMatchObject({ action: 'Attack', attacks: 1 });
  });

  it('leaves a target that saves as it was', async () => {
    rolls = [15];
    const answer = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: GRAPPLE });
    expect(answer.targets?.[0]).toMatchObject({ saved: true, total: 19 });
    expect((await tokenOf(OGRE))?.conditions).toEqual([]);
  });

  it('knocks a target Prone', async () => {
    rolls = [2];
    const answer = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: PRONE });
    expect(answer.summary).toMatch(/: Ogre is knocked Prone$/);
    expect((await tokenOf(OGRE))?.conditions).toEqual(['Prone']);
  });

  it('pushes a target 5 feet straight away', async () => {
    rolls = [2];
    const answer = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: PUSH });
    expect(answer.summary).toMatch(/: Ogre is pushed 5 ft$/);
    // The hero is at (1, 1) and the ogre was at (2, 1).
    expect((await tokenOf(OGRE))?.position).toEqual({ x: 3, y: 1 });
  });

  it('refuses a creature out of reach, two targets, and one too large', async () => {
    expect((await ask(player, 'combat.save', { sourceId: HERO, targetIds: [FAR], action: GRAPPLE })).ok).toBe(false);
    expect((await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE, FAR], action: GRAPPLE })).error).toBe('Grapple is against one creature');
    await prisma.map.update({
      where: { id: mapId },
      data: { tokens: toJson(freshTokens().map((t) => (t.id === OGRE ? { ...t, size: { width: 3, height: 3 } } : t))) },
    });
    expect((await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: PRONE })).error).toBe('Ogre is too large for Hero to shove');
  });
});
