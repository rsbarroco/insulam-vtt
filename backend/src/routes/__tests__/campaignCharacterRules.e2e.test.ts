/**
 * How a campaign builds its characters, saved with Campaign Settings.
 *
 * `PUT /api/campaigns/:campaignId` takes `characterRules`: gestalt and the
 * house rules, each a switch. Only the switches sent change, the result is
 * stored whole, and every member's page is told.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, createTestCampaign, cleanupCampaigns, cleanupUsers, TEST_PASSWORD } from '../../__tests__/helpers/db';
import { createWsTestServer, waitForEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { DEFAULT_CHARACTER_RULES, type CharacterRules } from '../../utils/characterRules';
import type { Socket as ClientSocket } from 'socket.io-client';

jest.setTimeout(30000);

const app = createTestApp();
let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let dmRest: ReturnType<typeof request.agent>;
let playerRest: ReturnType<typeof request.agent>;
let player: ClientSocket;

beforeAll(async () => {
  const stamp = randomUUID().slice(0, 8);
  const dmUser = await createTestUser({ email: `char-rules-dm-${stamp}@test.cozyvtt.local`, displayName: 'DM' });
  const playerUser = await createTestUser({ email: `char-rules-player-${stamp}@test.cozyvtt.local`, displayName: 'Player' });
  dmId = dmUser.id;
  playerId = playerUser.id;
  campaignId = (await createTestCampaign(dmId, { name: `Character rules ${stamp}` })).id;
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

beforeEach(async () => {
  await prisma.campaign.update({ where: { id: campaignId }, data: { characterRules: null as never } });
  player = await server.connectAndAuth(await server.loginAs(playerId), campaignId);
});
afterEach(() => player.disconnect());

afterAll(async () => {
  await server.close();
  await cleanupCampaigns([campaignId]);
  await cleanupUsers([dmId, playerId]);
  await prisma.$disconnect();
});

const stored = async () => (await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).characterRules;

it('starts with nothing stored, which means the defaults', async () => {
  expect(await stored()).toBeNull();
  const res = await dmRest.get(`/api/campaigns/${campaignId}`);
  expect(res.body.campaign.characterRules).toBeNull();
});

it('changes only the switches sent, stores them all and tells the table', async () => {
  const told = waitForEvent<{ campaignId: string; characterRules: CharacterRules }>(player, 'campaign.settings.updated');

  const res = await dmRest.put(`/api/campaigns/${campaignId}`).send({ characterRules: { gestalt: false } });

  expect(res.status).toBe(200);
  const expected = { ...DEFAULT_CHARACTER_RULES, gestalt: false };
  expect(res.body.campaign.characterRules).toEqual(expected);
  expect(await stored()).toEqual(expected);
  expect(await told).toMatchObject({ campaignId, characterRules: expected });

  await dmRest.put(`/api/campaigns/${campaignId}`).send({ characterRules: { abilityScoreCap22: false } });
  expect(await stored()).toEqual({ ...expected, abilityScoreCap22: false });
});

it('refuses a switch it does not know and a value that is not a switch', async () => {
  for (const characterRules of [{ flying: true }, { gestalt: 'yes' }, 'gestalt', [true]]) {
    const res = await dmRest.put(`/api/campaigns/${campaignId}`).send({ characterRules });
    expect(res.status).toBe(400);
  }
  expect(await stored()).toBeNull();
});

it('is the DM’s to change', async () => {
  const res = await playerRest.put(`/api/campaigns/${campaignId}`).send({ characterRules: { gestalt: false } });
  expect(res.status).toBe(403);
  expect(await stored()).toBeNull();
});
