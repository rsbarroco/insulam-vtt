/**
 * The D&D rules a campaign builds characters by, over REST.
 *
 * A member reads what creation chooses from, with the campaign's switches,
 * and has a set of choices turned into a sheet. Nothing is stored: the sheet
 * is saved through POST /api/characters like any other, which it must pass.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, createTestCampaign, cleanupCampaigns, cleanupUsers, TEST_PASSWORD } from '../../__tests__/helpers/db';

jest.setTimeout(30000);

const app = createTestApp();
let dmId: string;
let playerId: string;
let outsiderId: string;
let campaignId: string;
let otherSystemId: string;
let player: ReturnType<typeof request.agent>;
let outsider: ReturnType<typeof request.agent>;

const choices = {
  name: 'Brann',
  species: 'Dwarf',
  background: 'Soldier',
  classes: ['Fighter', 'Wizard'],
  level: 4,
  abilityScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundIncreases: { int: 2, str: 1 },
  originFeat: 'Alert',
  skills: ['arcana', 'perception'],
  improvements: [{ level: 4, feat: 'Grappler', featPoints: { str: 1 }, abilityPoints: { int: 2 } }],
};

beforeAll(async () => {
  const stamp = randomUUID().slice(0, 8);
  const users = await Promise.all(
    ['dm', 'player', 'outsider'].map((who) => createTestUser({ email: `rules-${who}-${stamp}@test.cozyvtt.local`, displayName: who }))
  );
  [dmId, playerId, outsiderId] = users.map((user) => user.id);
  campaignId = (await createTestCampaign(dmId, { name: `Rules ${stamp}` })).id;
  otherSystemId = (await createTestCampaign(dmId, { name: `Rules PF ${stamp}` })).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { gameSystem: 'DND_5E' } });
  // A campaign with no system set takes no D&D 5e characters, so it builds none.
  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
      { userId: playerId, campaignId: otherSystemId, role: 'PLAYER', characterIds: [] },
    ],
  });
  player = request.agent(app);
  outsider = request.agent(app);
  expect((await player.post('/api/auth/login').send({ email: users[1].email, password: TEST_PASSWORD })).status).toBe(200);
  expect((await outsider.post('/api/auth/login').send({ email: users[2].email, password: TEST_PASSWORD })).status).toBe(200);
});

beforeEach(async () => {
  await prisma.campaign.update({ where: { id: campaignId }, data: { characterRules: null as never } });
});

afterAll(async () => {
  await prisma.character.deleteMany({ where: { userId: playerId } });
  await cleanupCampaigns([campaignId, otherSystemId]);
  await cleanupUsers([dmId, playerId, outsiderId]);
  await prisma.$disconnect();
});

describe('GET /api/campaigns/:campaignId/rules/dnd', () => {
  it('gives a member what creation chooses from, with the campaign’s switches', async () => {
    const res = await player.get(`/api/campaigns/${campaignId}/rules/dnd`);
    expect(res.status).toBe(200);
    expect(res.body.characterRules.gestalt).toBe(true);
    expect(res.body.species).toHaveLength(9);
    expect(res.body.backgrounds).toHaveLength(4);
    expect(res.body.feats).toHaveLength(17);
    expect(res.body.classes).toHaveLength(12);
    const fighter = res.body.classes.find((entry: { name: string }) => entry.name === 'Fighter');
    expect(fighter).toMatchObject({ hitDie: 10, savingThrows: ['str', 'con'], caster: null, subclass: 'Champion' });
    expect(fighter.skillChoices.count).toBe(2);
    expect(fighter.improvements.map((gain: { level: number }) => gain.level)).toEqual([4, 6, 8, 12, 14, 16, 19, 20]);
    expect(res.body.feats.find((feat: { name: string }) => feat.name === 'Grappler').abilityPoints).toEqual({ total: 1, among: ['str', 'dex'], cap: 22 });
  });

  it('follows the campaign’s switches', async () => {
    await prisma.campaign.update({ where: { id: campaignId }, data: { characterRules: { featAndAbilityScores: false, abilityScoreCap22: false } } });
    const res = await player.get(`/api/campaigns/${campaignId}/rules/dnd`);
    const wizard = res.body.classes.find((entry: { name: string }) => entry.name === 'Wizard');
    expect(wizard.improvements).toEqual([4, 8, 12, 16].map((level) => ({ level, kind: 'feat', abilityPoints: 0 })).concat([{ level: 19, kind: 'epicBoon', abilityPoints: 0 }]));
    expect(res.body.feats.find((feat: { name: string }) => feat.name === 'Grappler').abilityPoints.cap).toBe(20);
  });

  it('is for members, of a campaign that uses D&D', async () => {
    expect((await outsider.get(`/api/campaigns/${campaignId}/rules/dnd`)).status).toBe(403);
    expect((await player.get(`/api/campaigns/${otherSystemId}/rules/dnd`)).status).toBe(404);
  });
});

describe('GET /api/campaigns/:campaignId/rules/dnd/reference', () => {
  it('gives a member the rules of play, in the document’s words', async () => {
    const res = await player.get(`/api/campaigns/${campaignId}/rules/dnd/reference`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('System Reference Document 5.2.1');
    const titles = res.body.sections.map((section: { title: string }) => section.title);
    expect(titles).toEqual(expect.arrayContaining(['Opportunity Attacks', 'Dodge [Action]', 'Prone [Condition]', 'Falling [Hazard]']));
    const falling = res.body.sections.find((section: { id: string }) => section.id === 'rules-glossary-falling-hazard');
    expect(falling.blocks[0].text).toMatch(/^A creature that falls takes 1d6 Bludgeoning damage/);
  });

  it('is for members, of a campaign the VTT resolves D&D for', async () => {
    expect((await outsider.get(`/api/campaigns/${campaignId}/rules/dnd/reference`)).status).toBe(403);
    // A campaign with no system set has its combat resolved by these rules too.
    expect((await player.get(`/api/campaigns/${otherSystemId}/rules/dnd/reference`)).status).toBe(200);
    await prisma.campaign.update({ where: { id: otherSystemId }, data: { gameSystem: 'PATHFINDER_2E' } });
    expect((await player.get(`/api/campaigns/${otherSystemId}/rules/dnd/reference`)).status).toBe(404);
    await prisma.campaign.update({ where: { id: otherSystemId }, data: { gameSystem: null } });
  });
});

describe('POST /api/campaigns/:campaignId/rules/dnd/build', () => {
  it('builds a sheet the character route accepts', async () => {
    const res = await player.post(`/api/campaigns/${campaignId}/rules/dnd/build`).send(choices);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ hitPoints: 36, proficiencyBonus: 2, feats: ['Alert', 'Grappler'] });
    expect(res.body.sheet.class).toBe('Fighter / Wizard');

    const saved = await player.post('/api/characters').send({ name: 'Brann', gameSystem: 'DND_5E', campaignId, data: res.body.sheet });
    expect([saved.status, saved.body.message]).toEqual([201, saved.body.message]);
    expect(saved.body.character.data.featuresAndTraits.length).toBeGreaterThan(10);
    expect(await prisma.character.count({ where: { userId: playerId, campaignId } })).toBe(1);
  });

  it('stores nothing itself', async () => {
    const before = await prisma.character.count({ where: { userId: playerId } });
    await player.post(`/api/campaigns/${campaignId}/rules/dnd/build`).send({ ...choices, name: 'Nobody' });
    expect(await prisma.character.count({ where: { userId: playerId } })).toBe(before);
  });

  it('says everything wrong with the choices, by the campaign’s rules', async () => {
    await prisma.campaign.update({ where: { id: campaignId }, data: { characterRules: { gestalt: false } } });
    const res = await player.post(`/api/campaigns/${campaignId}/rules/dnd/build`).send(choices);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(['This campaign builds single-class characters']);

    const shape = await player.post(`/api/campaigns/${campaignId}/rules/dnd/build`).send({ ...choices, classes: ['Bloodhunter'] });
    expect(shape.status).toBe(400);
    expect(shape.body.message).toMatch(/^classes/);
  });

  it('is for members, of a campaign that uses D&D', async () => {
    expect((await outsider.post(`/api/campaigns/${campaignId}/rules/dnd/build`).send(choices)).status).toBe(403);
    expect((await player.post(`/api/campaigns/${otherSystemId}/rules/dnd/build`).send(choices)).status).toBe(404);
  });
});
