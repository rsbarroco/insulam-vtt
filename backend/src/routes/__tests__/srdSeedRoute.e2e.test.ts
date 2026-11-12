/**
 * Only an administrator can import the SRD creatures.
 *
 * The import writes creatures every campaign shares, and replaces or removes
 * the SRD creatures stored before, and any campaign's DM could start it,
 * which means any user: anyone can create a campaign. It is an
 * administrator's action.
 *
 * The seed itself is a stand-in here: the real one replaces every SRD
 * creature in the database, and other suites keep theirs there. What it
 * stores is tested in services/__tests__/creatureSeedSource.test.ts.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
import { createTestApp } from '../../__tests__/helpers/test-app';
import * as creatureSeed from '../../services/creatureSeed';
import { prisma, createTestUser, createTestCampaign, cleanupUsers, cleanupCampaigns, TEST_PASSWORD } from '../../__tests__/helpers/db';

const app = createTestApp();
const users: string[] = [];
const campaigns: string[] = [];

async function signedIn(role: 'ADMIN' | 'USER'): Promise<{ id: string; agent: request.Agent; campaignId: string }> {
  const user = await createTestUser({ role, displayName: `Seeder ${role}` });
  users.push(user.id);
  const campaign = await createTestCampaign(user.id);
  campaigns.push(campaign.id);
  await prisma.campaignMembership.create({ data: { userId: user.id, campaignId: campaign.id, role: 'DM', characterIds: [] } });
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(200);
  return { id: user.id, agent, campaignId: campaign.id };
}

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await cleanupCampaigns(campaigns);
  await cleanupUsers(users);
  await prisma.$disconnect();
});

const seeded = { fetched: 330, created: 330, updated: 0, skipped: 0, removed: 0, alreadyExisted: 0, rejected: 0 };

describe('POST /api/campaigns/:campaignId/creatures/seed', () => {
  it('refuses a DM who is not an administrator, and stores nothing', async () => {
    const dm = await signedIn('USER');
    const seed = jest.spyOn(creatureSeed, 'seedSrdCreatures').mockResolvedValue(seeded);

    const res = await dm.agent.post(`/api/campaigns/${dm.campaignId}/creatures/seed`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      'Only an administrator can import the SRD creatures, because every campaign on this server shares them. Ask an administrator to import them.'
    );
    expect(seed).not.toHaveBeenCalled();
  });

  it('lets an administrator import them, and says what the import did', async () => {
    const admin = await signedIn('ADMIN');
    const seed = jest.spyOn(creatureSeed, 'seedSrdCreatures').mockResolvedValue(seeded);

    const res = await admin.agent.post(`/api/campaigns/${admin.campaignId}/creatures/seed`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 330, removed: 0 });
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it('answers 500 when the import fails', async () => {
    const admin = await signedIn('ADMIN');
    jest.spyOn(creatureSeed, 'seedSrdCreatures').mockRejectedValue(new Error('the database went away'));

    const res = await admin.agent.post(`/api/campaigns/${admin.campaignId}/creatures/seed`);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to seed SRD creatures');
  });
});

describe('GET /api/campaigns/:campaignId/creatures/seed/status', () => {
  it('says whether the caller may run the import', async () => {
    const dm = await signedIn('USER');
    const admin = await signedIn('ADMIN');
    expect((await dm.agent.get(`/api/campaigns/${dm.campaignId}/creatures/seed/status`)).body.canSeed).toBe(false);
    expect((await admin.agent.get(`/api/campaigns/${admin.campaignId}/creatures/seed/status`)).body.canSeed).toBe(true);
  });
});
