/**
 * A Rogue's Sneak Attack, over the socket: the extra dice on a hit with a
 * Finesse or Ranged weapon, with Advantage or an ally beside the target and
 * no Disadvantage, once on each turn.
 *
 * The fixtures are those of combatAttack.integration.test.ts, with an ally
 * of the hero standing beside the ogre.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson } from '../../utils/prisma-json';
import { createWsTestServer, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { clearState, setState, type CombatantEntry } from '../initiativeState';
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
      data: { email: `sneak-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `sneak-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `Sneak ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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

const rogue = (extra: Record<string, unknown> = {}) =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: {
      data: toJson({
        ...heroSheet(),
        class: 'Rogue',
        level: 5,
        stats: { strength: { score: 10, modifier: 0 }, dexterity: { score: 16, modifier: 3 } },
        attacks: [
          { name: 'Rapier', attackBonus: 6, damageRoll: '1d8+3', damageType: 'piercing' },
          { name: 'Longsword', attackBonus: 3, damageRoll: '1d8', damageType: 'slashing' },
        ],
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
const fight = (round = 1) =>
  setState(campaignId, {
    active: true,
    round,
    currentTokenId: HERO,
    combatants: [entry(HERO, 'Hero', 18), entry(OGRE, 'Ogre', 9)],
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0 },
  });
const moveAlly = async (changes: Record<string, unknown>) =>
  prisma.map.update({
    where: { id: mapId },
    data: { tokens: toJson(freshTokens().map((t) => (t.id === ALLY ? { ...t, ...changes } : t))) },
  });
const attack = (action: number, extra: Record<string, unknown> = {}, socket = player) =>
  ask(socket, 'combat.attack', { attackerId: HERO, targetId: OGRE, action, ...extra });

describe('Sneak Attack', () => {
  it('adds 3d6 of the weapon’s type to a Finesse hit with an ally beside the target, once on the turn', async () => {
    await rogue();
    fight();
    rolls = [15, 4, 3, 3, 3];

    const first = await attack(0);

    expect(first).toMatchObject({ ok: true, hit: true, dealt: 4 + 3 + 9 });
    expect(first.summary).toContain('Sneak Attack (3d6)');

    // A second hit on the turn (the DM's, past the one attack), with the same ally there, is only the rapier.
    rolls = [15, 4];
    const second = await attack(0, {}, dm);
    expect(second.dealt).toBe(7);
    expect(second.summary).not.toContain('Sneak Attack');

    // On the next turn it comes again.
    fight(2);
    rolls = [15, 4, 1, 1, 1];
    expect((await attack(0)).dealt).toBe(10);
  });

  it('needs Advantage when no ally stands beside the target', async () => {
    await rogue();
    await moveAlly({ position: { x: 6, y: 1 } });
    rolls = [15, 4];
    expect((await attack(0)).dealt).toBe(7);
    rolls = [15, 2, 4, 2, 2, 2];
    const advantage = await attack(0, { mode: 'advantage' });
    expect(advantage.dealt).toBe(13);
    expect(advantage.summary).toContain('Sneak Attack (3d6)');
  });

  it('is not for a weapon without Finesse, nor with Disadvantage, nor beside an Incapacitated ally', async () => {
    await rogue();
    rolls = [15, 4];
    expect((await attack(1)).dealt).toBe(4);
    rolls = [15, 15, 4];
    expect((await attack(0, { mode: 'disadvantage' })).dealt).toBe(7);
    await moveAlly({ conditions: ['Unconscious'] });
    rolls = [15, 4];
    expect((await attack(0)).dealt).toBe(7);
  });

  it('is only a Rogue’s', async () => {
    await rogue({ class: 'Fighter' });
    rolls = [15, 4];
    expect((await attack(0)).summary).not.toContain('Sneak Attack');
  });

  it('doubles its dice on a Critical Hit', async () => {
    await rogue();
    rolls = [20, 4, 4, 1, 1, 1, 1, 1, 1];
    expect((await attack(0)).dealt).toBe(4 + 4 + 3 + 6);
  });
});
