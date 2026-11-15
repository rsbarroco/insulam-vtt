/**
 * Bardic Inspiration over the socket: a Bard gives another creature the die,
 * kept on its token for an hour; when that creature fails an attack roll, a
 * save or a check, its player is asked, and the die rolled is added.
 *
 * The fixtures are those of areaPoint.integration.test.ts.
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
  token(ALLY, 'Ally', 3, {
    type: 'player',
    hp: { current: 10, max: 10, temp: 0 },
    statBlock: ogreBlock,
  }),
  token(OGRE, 'Ogre', 2, { hp: { current: 59, max: 59, temp: 0 }, statBlock: ogreBlock }),
  token(FAR, 'Far Ogre', 8, { hp: { current: 59, max: 59, temp: 0 }, statBlock: ogreBlock }),
  token(LURKER, 'Lurker', 1, {
    position: { x: 1, y: 2 },
    visible: false,
    hp: { current: 10, max: 10, temp: 0 },
    statBlock: ogreBlock,
  }),
];
const heroSheet = (features: string[] = []) => ({
  featuresAndTraits: features.map((name) => ({ name, description: '' })),
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
      data: { email: `inspire-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `inspire-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `Inspire ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
const fight = (currentTokenId: string = OGRE) =>
  setState(campaignId, {
    active: true,
    round: 1,
    currentTokenId,
    combatants: [
      entry(HERO, 'Hero', 18),
      entry(ALLY, 'Ally', 12),
      entry(OGRE, 'Ogre', 9),
      entry(FAR, 'Far Ogre', 5),
    ],
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0 },
  });
const actionIndex = async (socket: ClientSocket, tokenId: string, name: string) => {
  const listed = (await ask(socket, 'combat.actions', { tokenId })) as unknown as {
    actions: Array<{ index: number; name: string }>;
  };
  return listed.actions.find((action) => action.name === name)!.index;
};
/** Answer the next question the player is asked with `choice`; what was asked comes back. */
const answerWith = (choice: string | null) => {
  const asked: Array<{ promptId: string; text: string; options: string[] }> = [];
  player.once('combat.prompt', (offer: { promptId: string; text: string; options: string[] }) => {
    asked.push(offer);
    player.emit('combat.react', { promptId: offer.promptId, choice }, () => undefined);
  });
  return asked;
};
const tokensNow = async () => (await prisma.map.findUnique({ where: { id: mapId } }))!.tokens as Array<{ id: string; metadata?: Record<string, unknown> }>;
const heldBy = async (tokenId: string) => (await tokensNow()).find((t) => t.id === tokenId)!.metadata?.bardicInspiration;
/** The hero holds a d8 Bardic Inspiration die, until `until`. */
const inspireHero = (until = Date.now() + 60_000) =>
  prisma.map.update({
    where: { id: mapId },
    data: {
      tokens: toJson(
        freshTokens().map((t) => (t.id === HERO ? { ...t, metadata: { bardicInspiration: { sides: 8, from: 'Bard', until } } } : t))
      ),
    },
  });
const asBard = () =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: {
      data: toJson({ ...heroSheet(), class: 'Bard', level: 5, stats: { ...heroSheet().stats, charisma: { score: 16, modifier: 3 } } }),
    },
  });
const inspire = (targetId?: string) =>
  ask(player, 'combat.feature', { tokenId: HERO, feature: 'Bardic Inspiration', ...(targetId ? { targetId } : {}) });

describe('Bardic Inspiration', () => {
  it('gives another creature within 60 feet the die, one at a time, for the Bonus Action', async () => {
    fight(HERO);
    await asBard();
    expect((await inspire()).error).toBe('Bardic Inspiration needs a creature to inspire');
    expect((await inspire(HERO)).error).toBe('Bardic Inspiration goes to another creature');
    const given = await inspire(ALLY);
    expect(given).toMatchObject({ ok: true, left: 2 });
    expect(given.summary).toBe('Hero gives Ally a d8 Bardic Inspiration die, to add to a D20 Test it fails within the hour (2 uses left)');
    expect(await heldBy(ALLY)).toMatchObject({ sides: 8, from: 'Hero' });
    expect(getState(campaignId).turn?.bonusAction).toBe(true);
    fight(HERO);
    expect((await inspire(ALLY)).error).toBe('Ally already holds a Bardic Inspiration die');
  });

  it('is asked after a missed attack roll, and the die can turn it into a hit', async () => {
    fight(HERO);
    await inspireHero();
    const asked = answerWith('Bardic Inspiration');
    // 4 + 5 = 9 misses AC 11; the d8 adds 4: 13 hits; 5 + 3 slashing.
    rolls = [4, 4, 5];
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await actionIndex(player, HERO, 'Longsword') });
    expect(asked[0]?.options).toEqual(['Bardic Inspiration']);
    expect(answer).toMatchObject({ ok: true, hit: true, dealt: 8 });
    expect(await heldBy(HERO)).toBeUndefined();
  });

  it('is asked after a failed save, and adds the die to its total', async () => {
    fight();
    await inspireHero();
    answerWith('Bardic Inspiration');
    // 4 + 6 = 10 thunder; 2 + 4 = 6 fails, the d8 adds 7: 13 saves, for half.
    rolls = [4, 6, 2, 7];
    const answer = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [HERO], action: await actionIndex(dm, OGRE, 'Stomp') });
    expect(answer.targets?.[0]).toMatchObject({ saved: true, total: 13, dealt: 5 });
    expect(answer.summary).toContain('Hero fails (6), Bardic Inspiration +7: saves (13)');
  });

  it('is asked after a failed check', async () => {
    fight();
    await inspireHero();
    answerWith('Bardic Inspiration');
    // 5 + 3 = 8 fails DC 15; the d8 adds 8: 16.
    rolls = [5, 8];
    const answer = await ask(player, 'combat.check', { tokenId: HERO, ability: 'str', dc: 15 });
    expect(answer).toMatchObject({ ok: true, success: true, total: 16 });
    expect(answer.summary).toContain('Bardic Inspiration +8: 16, success');
  });

  it('keeps the die when declined, and is not asked once the hour is over', async () => {
    fight();
    await inspireHero();
    answerWith(null);
    rolls = [5];
    expect((await ask(player, 'combat.check', { tokenId: HERO, ability: 'str', dc: 15 })).success).toBe(false);
    expect(await heldBy(HERO)).toMatchObject({ sides: 8 });

    await inspireHero(Date.now() - 1);
    const asked = answerWith('Bardic Inspiration');
    rolls = [5];
    expect((await ask(player, 'combat.check', { tokenId: HERO, ability: 'str', dc: 15 })).success).toBe(false);
    expect(asked).toEqual([]);
    player.removeAllListeners('combat.prompt');
  });
});
