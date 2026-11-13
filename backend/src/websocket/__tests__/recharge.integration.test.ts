/**
 * A stat block's "(Recharge 5–6)" action, over the socket: spent when used,
 * refused until a d6 at the start of the creature's turn gives it back.
 *
 * The fixtures are those of combatAttack.integration.test.ts, with a
 * creature that breathes fire beside the hero.
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
      name: 'Fire Breath (Recharge 5–6)',
      description:
        'Dexterity Saving Throw: DC 13, each creature in a 15-foot Cone. Failure: 21 (6d6) Fire damage. Success: Half damage.',
    },
    { name: 'Multiattack', description: 'The devil makes two Claw attacks.' },
    {
      name: 'Claw',
      description: 'Melee Attack Roll: +7, reach 5 ft. Hit: 8 (1d8 + 4) Slashing damage.',
    },
  ],
  legendaryActions: [{ name: 'Lash', description: 'The devil makes one Claw attack.' }],
  notes:
    'Legendary Actions: Legendary Action Uses: 2. Immediately after another creature’s turn, the devil can expend a use.',
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
      data: {
        email: `recharge-dm-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'DM',
      },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `recharge-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `Recharge ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
const breathe = () => ask(dm, 'combat.save', { sourceId: DEVIL, targetIds: [HERO], action: 0 });
const next = async () => {
  dm.emit('initiative.next');
  await new Promise((resolve) => setTimeout(resolve, 300));
};

describe('Recharge', () => {
  it('is spent when used, refused until it recharges, and a d6 at the start of the turn gives it back', async () => {
    setState(campaignId, {
      active: true,
      round: 1,
      currentTokenId: DEVIL,
      combatants: [entry(DEVIL, 'Chain Devil', 20), entry(HERO, 'Hero', 10)],
    });
    expect((await breathe()).ok).toBe(true);
    expect((await breathe()).error).toBe(
      "Chain Devil's Fire Breath (Recharge 5–6) has not recharged"
    );
    const listed = (await ask(dm, 'combat.actions', { tokenId: DEVIL })) as unknown as {
      actions: Array<{ recharge?: { min: number; ready: boolean } }>;
    };
    expect(listed.actions[0].recharge).toEqual({ min: 5, ready: false });

    rolls = [];
    await next(); // the hero's turn
    await next(); // the devil's: a 3 does not recharge it
    expect(getState(campaignId).marks).toHaveLength(1);
    await next();
    rolls = [6];
    await next(); // a 6 does
    expect(getState(campaignId).marks).toEqual([]);
    expect((await breathe()).ok).toBe(true);
  });

  it('lists a Multiattack with the attacks it makes', async () => {
    const listed = (await ask(dm, 'combat.actions', { tokenId: DEVIL })) as unknown as {
      actions: Array<{ name: string; multiattack?: Array<{ count: number; choices: number[] }> }>;
    };
    expect(listed.actions[1]).toMatchObject({
      name: 'Multiattack',
      multiattack: [{ count: 2, choices: [2] }],
    });
  });

  it('takes Legendary Actions after another creature’s turn, as many as its uses, back at its own turn', async () => {
    setState(campaignId, {
      active: true,
      round: 1,
      currentTokenId: HERO,
      combatants: [entry(HERO, 'Hero', 20), entry(DEVIL, 'Chain Devil', 10)],
    });
    const lash = () =>
      ask(dm, 'combat.attack', { attackerId: DEVIL, targetId: HERO, action: 2, legendary: 3 });
    rolls = [15, 4];
    expect((await lash()).summary).toContain('Legendary Action: Lash');
    rolls = [15, 4];
    expect((await lash()).ok).toBe(true);
    expect((await lash()).error).toBe('Chain Devil has no Legendary Action uses left this round');
    const listed = (await ask(dm, 'combat.actions', { tokenId: DEVIL })) as unknown as {
      actions: Array<{
        name: string;
        legendary?: { max: number; used: number };
        multiattack?: unknown;
      }>;
    };
    expect(listed.actions[3]).toMatchObject({
      name: 'Lash',
      legendary: { max: 2, used: 2 },
      multiattack: [{ count: 1, choices: [2] }],
    });

    await next(); // the devil's turn starts: its uses come back, and it takes none on its own turn
    expect(getState(campaignId).marks).toEqual([]);
    expect((await lash()).error).toBe(
      "Chain Devil takes Legendary Actions after another creature's turn, not on its own"
    );
  });
});
