/**
 * The conditions a stat block's action gives its target, over the socket: a
 * hit that grapples a creature small enough, a failed save that frightens.
 *
 * The fixtures are those of combatAttack.integration.test.ts, with a chain
 * devil beside the hero.
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
const DEVIL = randomUUID();

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
const devilBlock = {
  ac: 15,
  abilities: { str: 18, dex: 15, con: 18, int: 11, wis: 12, cha: 14 },
  actions: [
    {
      name: 'Chain',
      description:
        'Melee Attack Roll: +7, reach 10 ft. Hit: 11 (2d6 + 4) Slashing damage. If the target is a Large or smaller creature, it has the Grappled condition (escape DC 14) from one of two chains, and it has the Restrained condition until the grapple ends.',
    },
    {
      name: 'Sting',
      description:
        "Melee Attack Roll: +7, reach 5 ft. Hit: 7 (1d6 + 4) Piercing damage, and the target has the Poisoned condition until the start of the devil's next turn.",
    },
    {
      name: 'Glare',
      description:
        "Wisdom Saving Throw: DC 13, one creature the devil can see within 60 feet. Failure: The target has the Frightened condition until the end of the devil's next turn. Success: The target is immune to this glare for 24 hours.",
    },
  ],
};
const freshTokens = () => [
  token(HERO, 'Hero', 1, { controlledBy: playerId, characterId: heroCharacterId, type: 'player' }),
  token(DEVIL, 'Chain Devil', 2, {
    position: { x: 2, y: 2 },
    hp: { current: 85, max: 85, temp: 0 },
    statBlock: devilBlock,
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
      data: { email: `rider-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `rider-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `Riders ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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

const heroConditions = async () =>
  (
    (await prisma.map.findUniqueOrThrow({ where: { id: mapId } })).tokens as Array<{
      id: string;
      conditions?: string[];
    }>
  ).find((t) => t.id === HERO)?.conditions;
const resize = (width: number) =>
  prisma.map.update({
    where: { id: mapId },
    data: {
      tokens: toJson(
        freshTokens().map((t) => (t.id === HERO ? { ...t, size: { width, height: width } } : t))
      ),
    },
  });

describe('conditions an action gives', () => {
  it('a hit grapples and restrains a creature small enough, and says so', async () => {
    rolls = [15, 3, 3];
    const hit = await ask(dm, 'combat.attack', { attackerId: DEVIL, targetId: HERO, action: 0 });
    expect(hit).toMatchObject({ ok: true, hit: true });
    expect(hit.summary).toContain('Hero has the Grappled condition');
    expect(hit.summary).toContain('Hero has the Restrained condition until the grapple ends');
    expect(await heroConditions()).toEqual(['Grappled', 'Restrained']);
  });

  it('does not grapple a creature too large', async () => {
    await resize(3);
    rolls = [15, 3, 3];
    const hit = await ask(dm, 'combat.attack', { attackerId: DEVIL, targetId: HERO, action: 0 });
    expect(hit.hit).toBe(true);
    expect(await heroConditions()).toEqual([]);
  });

  it('a failed save frightens', async () => {
    rolls = [2];
    const save = await ask(dm, 'combat.save', { sourceId: DEVIL, targetIds: [HERO], action: 2 });
    expect(save.ok).toBe(true);
    expect(save.summary).toContain(
      "Hero has the Frightened condition until the end of the devil's next turn"
    );
    expect(await heroConditions()).toEqual(['Frightened']);
  });

  it('takes a timed condition off when the turn it names starts', async () => {
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
    setState(campaignId, {
      active: true,
      round: 1,
      currentTokenId: DEVIL,
      combatants: [entry(DEVIL, 'Chain Devil', 20), entry(HERO, 'Hero', 10)],
    });
    rolls = [15, 3];
    const sting = await ask(dm, 'combat.attack', { attackerId: DEVIL, targetId: HERO, action: 1 });
    expect(sting.summary).toContain(
      "Hero has the Poisoned condition until the start of the devil's next turn"
    );
    expect(getState(campaignId).marks).toEqual([
      {
        kind: 'condition',
        attackerId: DEVIL,
        targetId: HERO,
        condition: 'Poisoned',
        ends: 'start',
        turnEndsLeft: 1,
      },
    ]);

    dm.emit('initiative.next');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await heroConditions()).toEqual(['Poisoned']);
    dm.emit('initiative.next');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(getState(campaignId).currentTokenId).toBe(DEVIL);
    expect(await heroConditions()).toEqual([]);
    expect(getState(campaignId).marks).toEqual([]);
  });
});
