/**
 * Opportunity Attacks, over the socket.
 *
 * A combatant that moves out of a hostile creature's reach on its own turn
 * offers that creature an Opportunity Attack: one melee attack, made with
 * its reaction, that finds the mover where it stood before it left. The
 * Disengage action offers none.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson } from '../../utils/prisma-json';
import { createWsTestServer, waitForEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { setState, getState, clearState, type CombatantEntry, type SentCombatState } from '../initiativeState';
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
const BYSTANDER = randomUUID();

interface Answer {
  ok: boolean;
  error?: string;
  hit?: boolean;
  dealt?: number;
  distanceFeet?: number;
}
const ask = (socket: ClientSocket, event: string, payload: unknown) =>
  new Promise<Answer>((resolve) => socket.emit(event, payload, resolve));
const nextState = (socket: ClientSocket) => waitForEvent<SentCombatState>(socket, 'initiative.state');
const moved = (socket: ClientSocket) => waitForEvent<{ tokenId: string; x: number }>(socket, 'token.moved');

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
  ],
};
// The hero stands next to the ogre; a neutral bystander stands on the hero's other side.
const tokens = (ogre: Record<string, unknown> = {}) => [
  token(HERO, 'Hero', 3, { controlledBy: playerId, characterId: heroCharacterId, type: 'player' }),
  token(OGRE, 'Ogre', 4, { hp: { current: 59, max: 59, temp: 0 }, statBlock: ogreBlock, type: 'npc', disposition: 'hostile', ...ogre }),
  token(BYSTANDER, 'Bystander', 3, { position: { x: 3, y: 2 }, hp: { current: 9, max: 9, temp: 0 }, statBlock: ogreBlock, type: 'npc', disposition: 'neutral' }),
];
const heroSheet = () => ({
  hp: { current: 30, maximum: 30, temporary: 0 },
  armorClass: 16,
  attacks: [{ name: 'Longsword', attackBonus: 5, damageRoll: '1d8+3', damageType: 'slashing' }],
});
const fight = (currentTokenId: string, over: Partial<Parameters<typeof setState>[1]> = {}) =>
  setState(campaignId, {
    active: true, round: 1, currentTokenId,
    combatants: [entry(HERO, 'Hero', 18), entry(OGRE, 'Ogre', 9), entry(BYSTANDER, 'Bystander', 5)],
    ...over,
  });
/** Move a token along its row and wait for the table to be told. */
async function move(socket: ClientSocket, tokenId: string, x: number): Promise<void> {
  const told = moved(dm);
  socket.emit('token.move.end', { tokenId, mapId, x, y: 1 });
  await told;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const heroHp = async () =>
  ((await prisma.character.findUniqueOrThrow({ where: { id: heroCharacterId } })).data as { hp: { current: number } }).hp.current;

let rolls: number[] = [];

beforeAll(async () => {
  dmId = (await prisma.user.create({ data: { email: `opp-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' } })).id;
  playerId = (await prisma.user.create({ data: { email: `opp-player-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Player' } })).id;
  campaignId = (await prisma.campaign.create({ data: { name: `Opportunity ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' } })).id;
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
      campaignId, name: 'Opportunity', imageUrl: '/api/assets/maps/x', baseLayerUrl: '/api/assets/maps/x', width: 10, height: 10,
      gridSize: 50, annotations: [], fogEnabled: false, tokens: toJson(tokens()),
    },
  })).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId, status: 'ACTIVE' } });
  server = await createWsTestServer();
});

beforeEach(async () => {
  clearState(campaignId);
  await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(tokens()) } });
  await prisma.character.update({ where: { id: heroCharacterId }, data: { data: toJson(heroSheet()) } });
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

describe('moving out of a hostile creature’s reach', () => {
  it('offers that creature an Opportunity Attack, and tells the table', async () => {
    fight(HERO);
    const sent = nextState(dm);
    await move(player, HERO, 1);
    expect((await sent).opportunities).toEqual([{ attackerId: OGRE, targetId: HERO }]);
    // Where the hero stood is the server's to keep.
    expect(getState(campaignId).opportunities).toEqual([{ attackerId: OGRE, targetId: HERO, from: { x: 3, y: 1 } }]);
  });

  it('offers nothing for a move that stays in reach, or to a creature that takes no side', async () => {
    fight(HERO);
    // Round the bystander's corner: still next to the ogre, and it leaves the neutral bystander's reach unremarked.
    const told = moved(dm);
    player.emit('token.move.end', { tokenId: HERO, mapId, x: 4, y: 0 });
    await told;
    await settle();
    expect(getState(campaignId).opportunities).toEqual([]);
  });

  it('offers nothing after the Disengage action', async () => {
    fight(HERO, { turn: { movementSpent: 0, dashes: 0, action: 'Disengage', bonusAction: false, attacks: 0 } });
    await move(player, HERO, 1);
    await settle();
    expect(getState(campaignId).opportunities).toEqual([]);
  });

  it('offers nothing off the mover’s own turn, or from a creature with no reaction left', async () => {
    fight(OGRE);
    await move(player, HERO, 1);
    await settle();
    expect(getState(campaignId).opportunities).toEqual([]);

    await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(tokens()) } });
    fight(HERO, { reactionsSpent: [OGRE] });
    await move(player, HERO, 1);
    await settle();
    expect(getState(campaignId).opportunities).toEqual([]);
  });

  it('offers nothing from a creature that cannot act', async () => {
    await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(tokens({ conditions: ['Stunned'] })) } });
    fight(HERO);
    await move(player, HERO, 1);
    await settle();
    expect(getState(campaignId).opportunities).toEqual([]);
  });

  it('offers a player’s character one when a hostile creature walks away', async () => {
    fight(OGRE);
    const sent = nextState(player);
    await move(dm, OGRE, 7);
    expect((await sent).opportunities).toEqual([{ attackerId: HERO, targetId: OGRE }]);
  });
});

describe('combat.attack with an Opportunity Attack', () => {
  const provoke = async () => {
    fight(HERO);
    const sent = nextState(dm);
    await move(player, HERO, 1);
    await sent;
  };

  it('finds the mover where it stood, spends the reaction and not the turn', async () => {
    await provoke();
    // The hero is now 15 feet away, beyond the greatclub's reach.
    rolls = [15, 4, 4];
    const sent = nextState(dm);

    const answer = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0, opportunity: true });

    expect(answer).toMatchObject({ ok: true, hit: true, dealt: 12, distanceFeet: 5 });
    expect(await heroHp()).toBe(18);
    expect(await sent).toMatchObject({ opportunities: [], reactionsSpent: [OGRE], currentTokenId: HERO });
    expect(getState(campaignId).turn).toMatchObject({ action: null, attacks: 0 });
  });

  it('is made once', async () => {
    await provoke();
    rolls = [2, 2];
    expect((await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0, opportunity: true })).ok).toBe(true);
    const again = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0, opportunity: true });
    expect(again).toEqual({ ok: false, error: 'Ogre has no Opportunity Attack to make against Hero' });
  });

  it('is one melee attack: not a javelin', async () => {
    await provoke();
    const answer = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 1, opportunity: true });
    expect(answer.error).toBe('An Opportunity Attack is one melee attack with a weapon or an Unarmed Strike');
    expect(getState(campaignId).opportunities).toHaveLength(1);
  });

  it('is refused when nothing was offered', async () => {
    fight(HERO);
    const answer = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0, opportunity: true });
    expect(answer.error).toBe('Ogre has no Opportunity Attack to make against Hero');
  });

  it('goes when the turn passes, and when the reaction is spent on something else', async () => {
    await provoke();
    let sent = nextState(dm);
    dm.emit('turn.update', { reaction: { tokenId: OGRE, spent: true } });
    expect((await sent).opportunities).toEqual([]);

    await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(tokens()) } });
    await provoke();
    sent = nextState(dm);
    player.emit('turn.end', { tokenId: HERO });
    expect(await sent).toMatchObject({ currentTokenId: OGRE, opportunities: [] });
  });
});
