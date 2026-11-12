/**
 * The turn in combat, over the socket.
 *
 * The acting combatant's movement, action and bonus action, each combatant's
 * reaction, and ending the turn. The DM may do all of it; a player only for a
 * token they control, which is what lets a player end their own turn.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { createWsTestServer, waitForEvent, expectNoEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { setState, getState, clearState, freshTurn, type CombatantEntry, type CombatState } from '../initiativeState';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);
let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let mapId: string;
let dm: ClientSocket;
let player: ClientSocket;

const HERO = randomUUID();
const OGRE = randomUUID();

const entry = (tokenId: string, name: string, initiative: number): CombatantEntry => ({
  tokenId, mapId, name, imageUrl: '', initiative, hp: null, type: 'npc', disposition: null,
});
const start = (currentTokenId: string = HERO) =>
  setState(campaignId, { active: true, round: 1, currentTokenId, combatants: [entry(HERO, 'Hero', 18), entry(OGRE, 'Ogre', 9)] });
const nextState = (socket: ClientSocket) => waitForEvent<CombatState>(socket, 'initiative.state');
const nextError = (socket: ClientSocket) => waitForEvent<{ message: string }>(socket, 'error');

beforeAll(async () => {
  dmId = (await prisma.user.create({ data: { email: `turn-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' } })).id;
  playerId = (await prisma.user.create({ data: { email: `turn-player-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Player' } })).id;
  campaignId = (await prisma.campaign.create({ data: { name: `Turn ${runId}`, ownerId: dmId, vibeSettings: {} } })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });
  const token = (id: string, name: string, x: number, controlledBy: string | null) => ({
    id, name, imageUrl: '', position: { x, y: 1 }, size: { width: 1, height: 1 }, layer: 'token', visible: true,
    controlledBy, rotation: 0, conditions: [], metadata: {},
  });
  mapId = (await prisma.map.create({
    data: {
      campaignId, name: 'Turn', imageUrl: '/api/assets/maps/x', baseLayerUrl: '/api/assets/maps/x', width: 10, height: 10,
      gridSize: 50, annotations: [], fogEnabled: false, tokens: [token(HERO, 'Hero', 1, playerId), token(OGRE, 'Ogre', 5, null)],
    },
  })).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId, status: 'ACTIVE' } });
  server = await createWsTestServer();
});

beforeEach(async () => {
  clearState(campaignId);
  dm = await server.connectAndAuth(await server.loginAs(dmId), campaignId);
  player = await server.connectAndAuth(await server.loginAs(playerId), campaignId);
});
afterEach(() => {
  dm.disconnect();
  player.disconnect();
});

afterAll(async () => {
  await server.close();
  clearState(campaignId);
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await prisma.map.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: { in: [dmId, playerId] } } });
  await prisma.$disconnect();
});

describe('starting and passing the turn', () => {
  it('gives the first combatant a fresh turn when the DM starts combat', async () => {
    setState(campaignId, { active: false, round: 0, currentTokenId: null, combatants: [entry(HERO, 'Hero', 18), entry(OGRE, 'Ogre', 9)] });
    const sent = nextState(player);

    dm.emit('initiative.start');

    const state = await sent;
    expect(state.currentTokenId).toBe(HERO);
    expect(state.turn).toEqual(freshTurn());
    expect(state.reactionsSpent).toEqual([]);
  });

  it("clears what was spent when the DM advances the turn", async () => {
    start();
    getState(campaignId).turn = { movementSpent: 30, dashes: 0, action: 'Attack', bonusAction: true, attacks: 0 };
    const sent = nextState(dm);

    dm.emit('initiative.next');

    const state = await sent;
    expect(state.currentTokenId).toBe(OGRE);
    expect(state.turn).toEqual(freshTurn());
  });
});

describe('turn.update', () => {
  it('records what the player whose turn it is has spent, and tells the table', async () => {
    start();
    const dmHears = nextState(dm);

    player.emit('turn.update', { movementSpent: 12.5, action: 'Dash', dashes: 1 });

    expect((await dmHears).turn).toEqual({ movementSpent: 12.5, dashes: 1, action: 'Dash', bonusAction: false, attacks: 0 });
  });

  it('changes only the fields it names', async () => {
    start();
    getState(campaignId).turn = { movementSpent: 20, dashes: 0, action: 'Attack', bonusAction: false, attacks: 0 };
    const sent = nextState(dm);

    dm.emit('turn.update', { bonusAction: true });

    expect((await sent).turn).toEqual({ movementSpent: 20, dashes: 0, action: 'Attack', bonusAction: true, attacks: 0 });
  });

  it('gives an action back with null', async () => {
    start();
    getState(campaignId).turn = { movementSpent: 0, dashes: 0, action: 'Dodge', bonusAction: false, attacks: 0 };
    const sent = nextState(dm);

    dm.emit('turn.update', { action: null });

    expect((await sent).turn?.action).toBeNull();
  });

  it("refuses a player on another token's turn", async () => {
    start(OGRE);
    const refused = nextError(player);

    player.emit('turn.update', { movementSpent: 5 });

    expect((await refused).message).toBe('You can only change the turn of your own token');
    expect(getState(campaignId).turn).toEqual(freshTurn());
  });

  it("lets a player spend their own reaction on another's turn, and take it back", async () => {
    start(OGRE);
    let sent = nextState(dm);
    player.emit('turn.update', { reaction: { tokenId: HERO, spent: true } });
    expect((await sent).reactionsSpent).toEqual([HERO]);

    sent = nextState(dm);
    player.emit('turn.update', { reaction: { tokenId: HERO, spent: false } });
    expect((await sent).reactionsSpent).toEqual([]);
  });

  it("refuses a player the reaction of a token they do not control", async () => {
    start();
    const refused = nextError(player);

    player.emit('turn.update', { reaction: { tokenId: OGRE, spent: true } });

    expect((await refused).message).toBe('You can only change the reaction of your own token');
    expect(getState(campaignId).reactionsSpent).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['nothing', {}],
    ['a negative movement', { movementSpent: -5 }],
    ['a movement that is not in half feet', { movementSpent: 7.3 }],
    ['an action name that is too long', { action: 'x'.repeat(41) }],
    ['a field it does not know', { movementSpent: 5, hp: 0 }],
    ['a reaction for something that is not a token id', { reaction: { tokenId: 'ogre', spent: true } }],
    ['text', 'dash'],
  ])('refuses %s and changes nothing', async (_label, payload) => {
    start();
    const refused = nextError(dm);

    dm.emit('turn.update', payload);

    await refused;
    expect(getState(campaignId).turn).toEqual(freshTurn());
  });

  it('refuses when no combat is under way', async () => {
    const refused = nextError(dm);

    dm.emit('turn.update', { movementSpent: 5 });

    expect((await refused).message).toBe('Combat is not active');
  });
});

describe('turn.end', () => {
  it('lets the player whose turn it is pass to the next combatant', async () => {
    start();
    const sent = nextState(dm);

    player.emit('turn.end', { tokenId: HERO });

    const state = await sent;
    expect(state.currentTokenId).toBe(OGRE);
    expect(state.turn).toEqual(freshTurn());
  });

  it('gives the combatant whose turn begins its reaction back', async () => {
    start();
    getState(campaignId).reactionsSpent = [HERO, OGRE];
    const sent = nextState(dm);

    dm.emit('turn.end', { tokenId: HERO });

    expect((await sent).reactionsSpent).toEqual([HERO]);
  });

  it("refuses a player on another token's turn", async () => {
    start(OGRE);
    const refused = nextError(player);

    player.emit('turn.end', { tokenId: OGRE });

    expect((await refused).message).toBe('You can only end the turn of your own token');
    expect(getState(campaignId).currentTokenId).toBe(OGRE);
  });

  it('passes one turn when two ends arrive together', async () => {
    start();
    const first = nextState(dm);

    dm.emit('turn.end', { tokenId: HERO });
    dm.emit('turn.end', { tokenId: HERO });

    await first;
    await expectNoEvent(dm, 'error');
    // Hero's turn ended once; the second end named a turn already over.
    expect(getState(campaignId).currentTokenId).toBe(OGRE);
    expect(getState(campaignId).round).toBe(1);
  });

  it('refuses an end that names no combatant', async () => {
    start();
    const refused = nextError(dm);

    dm.emit('turn.end');

    await refused;
    expect(getState(campaignId).currentTokenId).toBe(HERO);
  });
});
