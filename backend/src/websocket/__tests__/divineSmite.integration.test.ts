/**
 * Divine Smite over the socket: asked with the attack, it adds its Radiant
 * dice on a hit and only then spends the spell slot and the Bonus Action.
 *
 * The fixtures are those of areaPoint.integration.test.ts: the hero has two
 * level 3 slots and one level 4.
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
      data: { email: `smite-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `smite-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `Smite ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
const fight = (turn: Record<string, unknown> = {}) =>
  setState(campaignId, {
    active: true,
    round: 1,
    currentTokenId: HERO,
    combatants: [
      entry(HERO, 'Hero', 18),
      entry(ALLY, 'Ally', 12),
      entry(OGRE, 'Ogre', 9),
      entry(FAR, 'Far Ogre', 5),
    ],
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0, ...turn },
  });
interface Listed {
  actions: Array<{ index: number; name: string }>;
  divineSmite: number[];
}
const listed = async () => (await ask(player, 'combat.actions', { tokenId: HERO })) as unknown as Listed;
const indexOf = async (name: string) => (await listed()).actions.find((action) => action.name === name)!.index;
const asPaladin = () =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: { data: toJson(heroSheet(['Paladin’s Smite (Paladin 2)'])) },
  });
const slotsSpent = async (level: string) => {
  const sheet = (await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data as {
    spellcasting: { slots: Record<string, { expended: number }> };
  };
  return sheet.spellcasting.slots[level].expended;
};

describe('Divine Smite', () => {
  it('is offered with the slots the Paladin has', async () => {
    await asPaladin();
    expect((await listed()).divineSmite).toEqual([3, 4]);
  });

  it('adds 4d8 Radiant with a level 3 slot on a hit, spending the slot and the Bonus Action', async () => {
    fight();
    await asPaladin();
    // 15 + 5 hits AC 11; 1d8 + 3 = 7, and 4d8 of 1s = 4.
    rolls = [15, 4, 1, 1, 1, 1];
    const hit = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await indexOf('Longsword'), smite: 3 });
    expect(hit.ok).toBe(true);
    expect(hit.dealt).toBe(11);
    expect(await slotsSpent('3')).toBe(1);
    expect(getState(campaignId).turn?.bonusAction).toBe(true);
  });

  it('spends nothing on a miss', async () => {
    fight();
    await asPaladin();
    rolls = [1];
    const miss = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await indexOf('Longsword'), smite: 3 });
    expect(miss.hit).toBe(false);
    expect(await slotsSpent('3')).toBe(0);
    expect(getState(campaignId).turn?.bonusAction).toBe(false);
  });

  it('adds 1d8 against an Undead', async () => {
    fight();
    await asPaladin();
    const tokens = freshTokens().map((t) => (t.id === OGRE ? { ...t, statBlock: { ...ogreBlock, creatureType: 'Large Undead' } } : t));
    await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(tokens) } });
    rolls = [15, 4, 1, 1, 1, 1, 1];
    const hit = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await indexOf('Longsword'), smite: 3 });
    expect(hit.dealt).toBe(12);
  });

  it('refuses what the rules do not allow', async () => {
    fight();
    await asPaladin();
    const sword = await indexOf('Longsword');
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: sword, smite: 1 })).error).toBe(
      'No level 1 spell slot left for Divine Smite'
    );
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await indexOf('Fire Bolt'), smite: 3 })).error).toBe(
      'Divine Smite follows a hit with a Melee weapon or an Unarmed Strike'
    );
    fight({ bonusAction: true });
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: sword, smite: 3 })).error).toBe(
      'Hero has used its Bonus Action this turn'
    );
    await prisma.character.update({ where: { id: heroCharacterId }, data: { data: toJson(heroSheet()) } });
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: sword, smite: 3 })).error).toBe(
      'Hero has no Divine Smite prepared'
    );
  });
});
