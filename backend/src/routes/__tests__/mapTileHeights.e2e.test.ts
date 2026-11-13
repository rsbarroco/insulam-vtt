/**
 * Tile heights for the tactical view.
 *
 * A map stores one whole number per square, set by the DM as a whole and read
 * by every member who can see the map. These pin who may read and write them,
 * what is refused, that a flat board is stored as nothing, that everyone at
 * the table is told of a change, and that heights follow the squares when the
 * map is resized.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';

import { createTestApp } from '../../__tests__/helpers/test-app';
import {
  prisma,
  createTestUser,
  createTestCampaign,
  cleanupUsers,
  cleanupCampaigns,
  TEST_PASSWORD,
} from '../../__tests__/helpers/db';
import { createWsTestServer, waitForEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { MAX_TILE_HEIGHT } from '../../utils/tileHeights';

jest.setTimeout(30000);

const app = createTestApp();
let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let dmRest: ReturnType<typeof request.agent>;
let playerRest: ReturnType<typeof request.agent>;

const COLS = 4;
const ROWS = 3;
const flat = () => new Array<number>(COLS * ROWS).fill(0);
/** Heights 1..12, so every square is told apart: index = y * COLS + x. */
const numbered = () => flat().map((_, index) => index + 1);

async function newMap(shown = true) {
  const map = await prisma.map.create({
    data: {
      campaignId, name: 'Heights', imageUrl: '/api/assets/maps/x', baseLayerUrl: '/api/assets/maps/x',
      width: COLS, height: ROWS, gridSize: 50, tokens: [], annotations: [],
    },
  });
  if (shown) await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: map.id } });
  return map.id;
}
const stored = async (mapId: string) =>
  (await prisma.map.findUniqueOrThrow({ where: { id: mapId }, select: { tileHeights: true } })).tileHeights;
const url = (mapId: string) => `/api/campaigns/${campaignId}/maps/${mapId}/heights`;

beforeAll(async () => {
  const stamp = randomUUID().slice(0, 8);
  const dmUser = await createTestUser({ email: `heights-dm-${stamp}@test.cozyvtt.local`, displayName: 'DM' });
  const playerUser = await createTestUser({ email: `heights-player-${stamp}@test.cozyvtt.local`, displayName: 'Player' });
  dmId = dmUser.id;
  playerId = playerUser.id;
  campaignId = (await createTestCampaign(dmId, { name: `Heights ${stamp}` })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });
  dmRest = request.agent(app);
  playerRest = request.agent(app);
  expect((await dmRest.post('/api/auth/login').send({ email: dmUser.email, password: TEST_PASSWORD })).status).toBe(200);
  expect((await playerRest.post('/api/auth/login').send({ email: playerUser.email, password: TEST_PASSWORD })).status).toBe(200);
  server = await createWsTestServer();
});

afterAll(async () => {
  await server.close();
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await cleanupCampaigns([campaignId]);
  await cleanupUsers([dmId, playerId]);
  await prisma.$disconnect();
});

describe('reading', () => {
  it('answers null for a map that has never had heights', async () => {
    const mapId = await newMap();

    const res = await playerRest.get(url(mapId));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tileHeights: null });
  });

  it('gives a player the heights of the map on screen, on its own and with the map', async () => {
    const mapId = await newMap();
    await dmRest.put(url(mapId)).send({ heights: numbered() }).expect(200);
    const expected = { cols: COLS, rows: ROWS, heights: numbered() };

    expect((await playerRest.get(url(mapId))).body).toEqual({ tileHeights: expected });
    const whole = await playerRest.get(`/api/campaigns/${campaignId}/maps/${mapId}`);
    expect(whole.body.map.tileHeights).toEqual(expected);
  });

  it('hides a prepared map from a player', async () => {
    await newMap();
    const prepared = await newMap(false);
    await dmRest.put(url(prepared)).send({ heights: numbered() }).expect(200);

    expect((await playerRest.get(url(prepared))).status).toBe(404);
  });
});

describe('writing', () => {
  it('stores what the DM sends, with the size of the map', async () => {
    const mapId = await newMap();

    const res = await dmRest.put(url(mapId)).send({ heights: numbered() });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tileHeights: { cols: COLS, rows: ROWS, heights: numbered() } });
    expect(await stored(mapId)).toEqual({ cols: COLS, rows: ROWS, heights: numbered() });
  });

  it('stores a flat board as nothing', async () => {
    const mapId = await newMap();
    await dmRest.put(url(mapId)).send({ heights: numbered() }).expect(200);

    const res = await dmRest.put(url(mapId)).send({ heights: flat() });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tileHeights: null });
    expect(await stored(mapId)).toBeNull();
  });

  it('refuses a player', async () => {
    const mapId = await newMap();

    const res = await playerRest.put(url(mapId)).send({ heights: numbered() });

    expect(res.status).toBe(403);
    expect(await stored(mapId)).toBeNull();
  });

  it.each<[string, unknown]>([
    ['no heights', undefined],
    ['something that is not a list', 'tall'],
    ['too few numbers', [1, 2, 3]],
    ['one number too many', [...flat(), 0]],
    ['a height below 0', flat().fill(-1, 0, 1)],
    [`a height above ${MAX_TILE_HEIGHT}`, flat().fill(MAX_TILE_HEIGHT + 1, 0, 1)],
    ['a height that is not whole', flat().fill(1.5, 0, 1)],
    ['a height that is not a number', [...flat().slice(1), 'high']],
  ])('refuses %s, and stores nothing', async (_label, heights) => {
    const mapId = await newMap();

    const res = await dmRest.put(url(mapId)).send({ heights });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation Error');
    expect(await stored(mapId)).toBeNull();
  });

  it('accepts the tallest height', async () => {
    const mapId = await newMap();

    const res = await dmRest.put(url(mapId)).send({ heights: flat().fill(MAX_TILE_HEIGHT) });

    expect(res.status).toBe(200);
  });

  it('answers 404 for a map of another campaign', async () => {
    const res = await dmRest.put(url(randomUUID())).send({ heights: numbered() });

    expect(res.status).toBe(404);
  });
});

describe('telling the table', () => {
  let dm: ClientSocket;
  let player: ClientSocket;

  beforeEach(async () => {
    dm = await server.connectAndAuth(await server.loginAs(dmId), campaignId);
    player = await server.connectAndAuth(await server.loginAs(playerId), campaignId);
  });
  afterEach(() => {
    dm.disconnect();
    player.disconnect();
  });

  it('sends the new heights to the DM and the players', async () => {
    const mapId = await newMap();
    const dmHears = waitForEvent<{ mapId: string; tileHeights: unknown }>(dm, 'heights:replaced');
    const playerHears = waitForEvent<{ mapId: string; tileHeights: unknown }>(player, 'heights:replaced');

    await dmRest.put(url(mapId)).send({ heights: numbered() }).expect(200);

    const expected = { mapId, tileHeights: { cols: COLS, rows: ROWS, heights: numbered() } };
    expect(await dmHears).toEqual(expected);
    expect(await playerHears).toEqual(expected);
  });

  it('sends null when the board is made flat', async () => {
    const mapId = await newMap();
    await dmRest.put(url(mapId)).send({ heights: numbered() }).expect(200);
    const playerHears = waitForEvent<{ mapId: string; tileHeights: unknown }>(player, 'heights:replaced');

    await dmRest.put(url(mapId)).send({ heights: flat() }).expect(200);

    expect(await playerHears).toEqual({ mapId, tileHeights: null });
  });
});

describe('resizing the map', () => {
  it('keeps the heights of the squares that remain and starts new ones flat', async () => {
    const mapId = await newMap();
    await dmRest.put(url(mapId)).send({ heights: numbered() }).expect(200);

    // One column narrower, one row taller. The bottom-left square stays put.
    await dmRest.put(`/api/campaigns/${campaignId}/maps/${mapId}`).send({ width: 3, height: 4 }).expect(200);

    expect(await stored(mapId)).toEqual({
      cols: 3,
      rows: 4,
      heights: [
        1, 2, 3,
        5, 6, 7,
        9, 10, 11,
        0, 0, 0,
      ],
    });
  });

  it('tells the table the resized heights', async () => {
    const mapId = await newMap();
    await dmRest.put(url(mapId)).send({ heights: numbered() }).expect(200);
    const player = await server.connectAndAuth(await server.loginAs(playerId), campaignId);
    const hears = waitForEvent<{ mapId: string; tileHeights: { cols: number; rows: number } }>(player, 'heights:replaced');

    await dmRest.put(`/api/campaigns/${campaignId}/maps/${mapId}`).send({ width: 2 }).expect(200);

    const told = await hears;
    player.disconnect();
    expect(told.mapId).toBe(mapId);
    expect(told.tileHeights).toMatchObject({ cols: 2, rows: ROWS });
  });

  it('leaves a flat board flat', async () => {
    const mapId = await newMap();

    await dmRest.put(`/api/campaigns/${campaignId}/maps/${mapId}`).send({ width: 6 }).expect(200);

    expect(await stored(mapId)).toBeNull();
  });

  it('leaves heights alone when only the grid size changes', async () => {
    const mapId = await newMap();
    await dmRest.put(url(mapId)).send({ heights: numbered() }).expect(200);

    await dmRest.put(`/api/campaigns/${campaignId}/maps/${mapId}`).send({ gridSize: 70 }).expect(200);

    expect(await stored(mapId)).toEqual({ cols: COLS, rows: ROWS, heights: numbered() });
  });
});

describe('Difficult Terrain, which rides with the heights', () => {
  const marks = (...squares: number[]) => flat().map((_, index) => (squares.includes(index) ? 1 : 0));

  it('stores the squares the DM marks, on a flat board too', async () => {
    const mapId = await newMap();

    const res = await dmRest.put(url(mapId)).send({ heights: flat(), difficult: marks(1, 5) });

    expect(res.status).toBe(200);
    expect(res.body.tileHeights).toEqual({ cols: COLS, rows: ROWS, heights: flat(), difficult: marks(1, 5) });
    expect(await stored(mapId)).toEqual({ cols: COLS, rows: ROWS, heights: flat(), difficult: marks(1, 5) });
  });

  it('keeps what is marked when heights are sent without it', async () => {
    const mapId = await newMap();
    await dmRest.put(url(mapId)).send({ heights: flat(), difficult: marks(2) }).expect(200);

    await dmRest.put(url(mapId)).send({ heights: numbered() }).expect(200);

    expect(await stored(mapId)).toEqual({ cols: COLS, rows: ROWS, heights: numbered(), difficult: marks(2) });
  });

  it('forgets it when every square is cleared, and the board with it when flat', async () => {
    const mapId = await newMap();
    await dmRest.put(url(mapId)).send({ heights: flat(), difficult: marks(2) }).expect(200);

    const res = await dmRest.put(url(mapId)).send({ heights: flat(), difficult: marks() });

    expect(res.body).toEqual({ tileHeights: null });
    expect(await stored(mapId)).toBeNull();
  });

  it('refuses marks that are not one 0 or 1 for each square', async () => {
    const mapId = await newMap();
    expect((await dmRest.put(url(mapId)).send({ heights: flat(), difficult: [1, 0] })).status).toBe(400);
    expect((await dmRest.put(url(mapId)).send({ heights: flat(), difficult: flat().map(() => 2) })).status).toBe(400);
    expect(await stored(mapId)).toBeNull();
  });

  it('follows the squares when the map is resized', async () => {
    const mapId = await newMap();
    // Square 1 is (1, 0) and square 7 is (3, 1), which a narrower map cuts off.
    await dmRest.put(url(mapId)).send({ heights: flat(), difficult: marks(1, 7) }).expect(200);

    await dmRest.put(`/api/campaigns/${campaignId}/maps/${mapId}`).send({ width: 3, height: 3 }).expect(200);

    expect(((await stored(mapId)) as { difficult?: number[] } | null)?.difficult).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0]);
  });
});
