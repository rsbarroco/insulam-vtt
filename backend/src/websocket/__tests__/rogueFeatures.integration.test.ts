/**
 * The Rogue features the server resolves beyond Sneak Attack and the first
 * Cunning Strike effects, over the socket: Steady Aim, Reliable Talent,
 * Improved Cunning Strike and Devious Strikes, Elusive, Stroke of Luck, and a
 * Thief's Fast Hands.
 *
 * The fixtures are those of sneakAttack.integration.test.ts: the ally beside
 * the ogre gives the Rogue its Sneak Attack.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson } from '../../utils/prisma-json';
import { createWsTestServer, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
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
  token(ALLY, 'Ally', 3, { type: 'player', hp: { current: 10, max: 10, temp: 0 } }),
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
    cantrips: ['Fire Bolt'],
    spells: [{ name: 'Fireball', level: 3, prepared: true, ritual: false, concentration: false }],
    slots: { '3': { total: 2, expended: 0 }, '4': { total: 1, expended: 0 } },
  },
});

let rolls: number[] = [];

beforeAll(async () => {
  dmId = (
    await prisma.user.create({
      data: { email: `roguefeat-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `roguefeat-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `RogueFeat ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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

const feature = (name: string) => ({ name, description: '' });
const rogue = (level: number, features: string[], extra: Record<string, unknown> = {}) =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: {
      data: toJson({
        ...heroSheet(),
        class: 'Rogue',
        level,
        stats: { strength: { score: 10, modifier: 0 }, dexterity: { score: 16, modifier: 3 } },
        attacks: [{ name: 'Rapier', attackBonus: 6, damageRoll: '1d8+3', damageType: 'piercing' }],
        featuresAndTraits: features.map(feature),
        ...extra,
      }),
    },
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
const fight = (turn: Record<string, unknown> = {}, currentTokenId = HERO) =>
  setState(campaignId, {
    active: true,
    round: 1,
    currentTokenId,
    combatants: [entry(HERO, 'Hero', 18), entry(OGRE, 'Ogre', 9)],
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0, ...turn },
  });
const attack = (extra: Record<string, unknown> = {}) =>
  ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: 0, ...extra });
const tokenOf = async (id: string) =>
  ((await prisma.map.findUnique({ where: { id: mapId } }))!.tokens as Array<{ id: string; conditions?: string[] }>).find((t) => t.id === id)!;
const usesOf = async () =>
  ((await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data as { featureUses?: Record<string, number> }).featureUses ?? {};
/** Answer the next prompt the player is sent, and keep what it asked. */
const answering = (choice: string | null) => {
  const asked: Array<{ text: string; options: string[] }> = [];
  player.once('combat.prompt', (offer: { promptId: string; text: string; options: string[] }) => {
    asked.push({ text: offer.text, options: offer.options });
    player.emit('combat.react', { promptId: offer.promptId, choice }, () => undefined);
  });
  return asked;
};

describe('Steady Aim', () => {
  it('gives Advantage on the next attack roll of the turn and spends the Bonus Action', async () => {
    await rogue(3, []);
    fight();
    const aimed = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Steady Aim' });
    expect(aimed).toMatchObject({ ok: true });
    expect(aimed.summary).toContain('Steady Aim: Advantage on its next attack roll this turn');
    expect(getState(campaignId).turn).toMatchObject({ bonusAction: true, steadyAim: 'ready' });
    // Two d20s: 3 and 15. The 15 hits.
    rolls = [3, 15, 4, 3, 3];
    const hit = await attack();
    expect(hit).toMatchObject({ ok: true, hit: true });
    expect(hit.reasons).toContain('Advantage: Steady Aim');
    expect(getState(campaignId).turn).toMatchObject({ steadyAim: 'used' });
    // The next roll has no more of it.
    getState(campaignId).turn!.attacks = 0;
    getState(campaignId).turn!.action = null;
    const second = await attack();
    expect(second.reasons).not.toContain('Advantage: Steady Aim');
  });

  it('is refused after moving, without the level, and with the Bonus Action spent', async () => {
    await rogue(3, []);
    fight({ movementSpent: 5 });
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Steady Aim' })).error).toBe(
      'Steady Aim is used only on a turn the Rogue has not moved'
    );
    fight({ bonusAction: true });
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Steady Aim' })).error).toBe('Hero has used its Bonus Action this turn');
    await rogue(2, []);
    fight();
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Steady Aim' })).error).toBe('Hero has no Steady Aim');
  });
});

describe('Reliable Talent', () => {
  it('counts a d20 of 9 or lower as 10 on a check with a proficient skill only', async () => {
    await rogue(7, ['Reliable Talent (Rogue 7)']);
    rolls = [3];
    const stealth = await ask(player, 'combat.check', { tokenId: HERO, skill: 'stealth', dc: 15 });
    expect(stealth).toMatchObject({ ok: true, total: 16, success: true });
    expect(stealth.reasons).toContain('Reliable Talent: the 3 on the d20 counts as 10');
    rolls = [3];
    const untrained = await ask(player, 'combat.check', { tokenId: HERO, skill: 'acrobatics' });
    expect(untrained.total).toBeLessThan(10);
  });
});

describe('Improved Cunning Strike and Devious Strikes', () => {
  const devious = ['Cunning Strike', 'Improved Cunning Strike', 'Devious Strikes'];

  it('uses two effects on one Sneak Attack, paying the dice of each', async () => {
    await rogue(14, devious);
    fight();
    // 15 hits; 4 + 3 piercing; 7d6 less Obscure (3) and Trip (1) is 3d6: 3 + 3 + 3; then two Dexterity saves of 5 - 1 against DC 13.
    rolls = [15, 4, 3, 3, 3, 5, 5];
    const hit = await attack({ cunning: ['obscure', 'trip'] });
    expect(hit).toMatchObject({ ok: true, hit: true, dealt: 4 + 3 + 9 });
    expect(hit.summary).toContain('Sneak Attack (3d6, Cunning Strike: Obscure and Trip)');
    expect(hit.summary).toContain('Cunning Strike (Obscure): Ogre fails (Dexterity 4 vs DC 13)');
    expect(hit.summary).toContain('Cunning Strike (Trip): Ogre fails (Dexterity 4 vs DC 13) and is Prone');
    expect((await tokenOf(OGRE)).conditions).toEqual(expect.arrayContaining(['Blinded', 'Prone']));
    expect(getState(campaignId).marks).toContainEqual(expect.objectContaining({ kind: 'condition', targetId: OGRE, condition: 'Blinded', ends: 'end' }));
  });

  it('knocks the target out until it takes damage', async () => {
    await rogue(14, devious);
    fight();
    // 7d6 less Knock Out (6) is 1d6; the ogre's Constitution save: 2 + 3 = 5 against DC 13.
    rolls = [15, 4, 3, 2];
    const hit = await attack({ cunning: 'knockOut' });
    expect(hit.summary).toContain('Sneak Attack (1d6, Cunning Strike: Knock Out)');
    expect(hit.summary).toContain('Cunning Strike (Knock Out): Ogre fails (Constitution 5 vs DC 13)');
    expect((await tokenOf(OGRE)).conditions).toContain('Unconscious');
    getState(campaignId).turn!.attacks = 0;
    getState(campaignId).turn!.action = null;
    rolls = [15, 15];
    const again = await attack();
    expect(again.summary).toContain('Ogre is no longer Unconscious (Knock Out)');
    expect((await tokenOf(OGRE)).conditions).not.toContain('Unconscious');
  });

  it('dazes with a note for the table', async () => {
    await rogue(14, devious);
    fight();
    rolls = [15, 4, 3, 3, 3, 3, 3, 2];
    const hit = await attack({ cunning: 'daze' });
    expect(hit.summary).toContain('Sneak Attack (5d6, Cunning Strike: Daze)');
    expect(hit.summary).toContain('Ogre is dazed: on its next turn it can only move, or take an action, or take a Bonus Action');
  });

  it('refuses two effects without Improved Cunning Strike, an effect its features do not give, and more dice than it has', async () => {
    await rogue(5, ['Cunning Strike']);
    fight();
    expect((await attack({ cunning: ['trip', 'withdraw'] })).error).toBe('Two Cunning Strike effects need Improved Cunning Strike');
    expect((await attack({ cunning: 'daze' })).error).toBe('Daze needs Devious Strikes');
    expect((await attack({ cunning: 'stealth' })).error).toBe('Stealth Attack needs Supreme Sneak');
    await rogue(5, devious);
    expect((await attack({ cunning: 'knockOut' })).error).toBe('Those Cunning Strike effects cost 6d6 of a 3d6 Sneak Attack');
  });

  it('keeps a Thief hidden with a Stealth Attack only while it is Invisible', async () => {
    await rogue(9, ['Cunning Strike', 'Supreme Sneak']);
    fight();
    expect((await attack({ cunning: 'stealth' })).error).toBe('Stealth Attack is used while hidden: the Hide action’s Invisible condition');
    await prisma.map.update({
      where: { id: mapId },
      data: { tokens: toJson(freshTokens().map((t) => (t.id === HERO ? { ...t, conditions: ['Invisible'] } : t))) },
    });
    rolls = [15, 15];
    const hit = await attack({ cunning: 'stealth' });
    expect(hit.summary).toContain('Sneak Attack (4d6, Cunning Strike: Stealth Attack)');
    expect(hit.summary).toContain('Cunning Strike (Stealth Attack): the attack does not end Hero\'s Invisible condition');
  });
});

describe('Elusive', () => {
  it('lets no attack roll against the Rogue have Advantage', async () => {
    await rogue(18, ['Elusive (Rogue 18)']);
    fight({}, OGRE);
    // One d20 only: the Advantage the table granted is gone.
    rolls = [2, 20];
    const swing = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0, mode: 'advantage' });
    expect(swing).toMatchObject({ ok: true, hit: false });
    expect(swing.reasons).toContain('No Advantage: Elusive (Hero)');
  });
});

describe('Stroke of Luck', () => {
  it('turns a missed attack roll into a 20, once until a rest', async () => {
    await rogue(20, []);
    fight();
    const asked = answering('Stroke of Luck');
    rolls = [2];
    const hit = await attack();
    expect(asked[0].options).toEqual(['Stroke of Luck']);
    expect(hit).toMatchObject({ ok: true, hit: true, critical: true });
    expect(hit.summary).toContain('Stroke of Luck: the d20 becomes a 20');
    expect(await usesOf()).toMatchObject({ 'Stroke of Luck': 1 });
    // Spent: the next miss is not asked about.
    getState(campaignId).turn!.attacks = 0;
    getState(campaignId).turn!.action = null;
    const later = answering('Stroke of Luck');
    rolls = [2];
    expect(await attack()).toMatchObject({ ok: true, hit: false });
    expect(later).toHaveLength(0);
    player.removeAllListeners('combat.prompt');
  });

  it('is not spent when declined', async () => {
    await rogue(20, []);
    fight();
    answering(null);
    rolls = [2];
    expect(await attack()).toMatchObject({ ok: true, hit: false });
    expect(await usesOf()).not.toHaveProperty('Stroke of Luck');
  });

  it('turns a failed check into a 20', async () => {
    await rogue(20, []);
    answering('Stroke of Luck');
    rolls = [2];
    const check = await ask(player, 'combat.check', { tokenId: HERO, skill: 'stealth', dc: 20 });
    expect(check).toMatchObject({ ok: true, total: 26, success: true });
    expect(check.summary).toContain('Stroke of Luck, the d20 becomes a 20: 26, success');
    expect(await usesOf()).toMatchObject({ 'Stroke of Luck': 1 });
  });

  it('turns a failed save into a 20', async () => {
    await rogue(20, []);
    fight({}, OGRE);
    answering('Stroke of Luck');
    // The Stomp's 2d8, then the Rogue's Dexterity save: 2 + 4 = 6 against DC 13; with the 20, 24.
    rolls = [4, 4, 2];
    const stomp = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [HERO], action: 3 });
    expect(stomp).toMatchObject({ ok: true });
    expect(stomp.targets![0]).toMatchObject({ saved: true, total: 24, dealt: 4 });
    expect(stomp.summary).toContain('Hero fails (6), Stroke of Luck, the d20 becomes a 20: saves (24)');
    expect(await usesOf()).toMatchObject({ 'Stroke of Luck': 1 });
  });
});

describe('Fast Hands', () => {
  it('makes a Sleight of Hand check as a Bonus Action for a Thief', async () => {
    await rogue(3, ['Fast Hands (Thief 3)']);
    fight();
    rolls = [12];
    const check = await ask(player, 'combat.check', { tokenId: HERO, skill: 'sleightOfHand', bonusAction: true });
    expect(check).toMatchObject({ ok: true, total: 15 });
    expect(getState(campaignId).turn).toMatchObject({ bonusAction: true });
    expect((await ask(player, 'combat.check', { tokenId: HERO, skill: 'sleightOfHand', bonusAction: true })).error).toBe('Hero has used its Bonus Action this turn');
    await rogue(3, []);
    fight();
    expect((await ask(player, 'combat.check', { tokenId: HERO, skill: 'sleightOfHand', bonusAction: true })).error).toBe('Hero has no Fast Hands');
  });
});
