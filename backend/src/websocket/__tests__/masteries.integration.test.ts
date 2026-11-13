/**
 * Weapon masteries, over the socket: a character with Weapon Mastery whose
 * sheet marks a weapon's mastery as used topples, pushes or grazes with it.
 *
 * The fixtures are those of combatAttack.integration.test.ts.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson, readTokens } from '../../utils/prisma-json';
import { createWsTestServer, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { clearState } from '../initiativeState';
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
  actions?: Array<{ index: number; name: string; cost: string; attack: { kind: string; bonus: number; damage: string } | null }>;
}
const ask = (socket: ClientSocket, event: string, payload: unknown) =>
  new Promise<Answer>((resolve) => socket.emit(event, payload, resolve));


const token = (id: string, name: string, x: number, extra: Record<string, unknown> = {}) => ({
  id, name, imageUrl: '', position: { x, y: 1 }, size: { width: 1, height: 1 }, layer: 'token', visible: true,
  controlledBy: null, rotation: 0, conditions: [], metadata: {}, ...extra,
});
const ogreBlock = {
  ac: 11,
  abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
  actions: [
    { name: 'Greatclub', description: 'Melee Attack Roll: +6, reach 5 ft. Hit: 13 (2d8 + 4) Bludgeoning damage.' },
    { name: 'Javelin', description: 'Ranged Attack Roll: +6, range 30/120 ft. Hit: 11 (2d6 + 4) Piercing damage.' },
    { name: 'Roar', description: 'The ogre roars.' },
    { name: 'Stomp', description: 'Dexterity Saving Throw: DC 13, each creature within 10 feet. Failure: 9 (2d8) Thunder damage. Success: Half damage.' },
  ],
};
const freshTokens = () => [
  token(HERO, 'Hero', 1, { controlledBy: playerId, characterId: heroCharacterId }),
  token(OGRE, 'Ogre', 2, { hp: { current: 59, max: 59, temp: 0 }, statBlock: ogreBlock }),
  token(FAR, 'Far Ogre', 8, { hp: { current: 59, max: 59, temp: 0 }, statBlock: ogreBlock }),
  token(LURKER, 'Lurker', 1, { position: { x: 1, y: 2 }, visible: false, hp: { current: 10, max: 10, temp: 0 }, statBlock: ogreBlock }),
];
const heroSheet = () => ({
  hp: { current: 30, maximum: 30, temporary: 0 },
  armorClass: 16,
  savingThrows: { strength: { bonus: 2 }, dexterity: { bonus: 4 }, constitution: { bonus: 2 }, intelligence: { bonus: 0 }, wisdom: { bonus: 1 }, charisma: { bonus: 0 } },
  attacks: [{ name: 'Longsword', attackBonus: 5, damageRoll: '1d8+3', damageType: 'slashing' }],
  proficiencyBonus: 2,
  stats: { strength: { score: 16, modifier: 3 }, wisdom: { score: 12, modifier: 1 } },
  skills: { stealth: { proficient: true, expertise: false, bonus: 6 }, perception: { proficient: true, expertise: false, bonus: 4 } },
  spellcasting: { spellAttackBonus: 6, spellSaveDC: 14, cantrips: ['Fire Bolt'], spells: [{ name: 'Fireball', level: 3, prepared: true, ritual: false, concentration: false }], slots: { '3': { total: 2, expended: 0 }, '4': { total: 1, expended: 0 } } },
});

let rolls: number[] = [];

beforeAll(async () => {
  dmId = (await prisma.user.create({ data: { email: `mastery-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' } })).id;
  playerId = (await prisma.user.create({ data: { email: `mastery-player-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Player' } })).id;
  campaignId = (await prisma.campaign.create({ data: { name: `Mastery ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' } })).id;
  heroCharacterId = (await prisma.character.create({
    data: { userId: playerId, campaignId, name: 'Hero', gameSystem: 'DND_5E', data: toJson(heroSheet()) },
  })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [heroCharacterId] },
    ],
  });
  mapId = (await prisma.map.create({
    data: {
      campaignId, name: 'Attack', imageUrl: '/api/assets/maps/x', baseLayerUrl: '/api/assets/maps/x', width: 10, height: 10,
      gridSize: 50, annotations: [], fogEnabled: false, tokens: toJson(freshTokens()),
    },
  })).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId, status: 'ACTIVE' } });
  server = await createWsTestServer();
});

beforeEach(async () => {
  clearState(campaignId);
  await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(freshTokens()) } });
  await prisma.character.update({ where: { id: heroCharacterId }, data: { data: toJson(heroSheet()) } });
  // The dice come up as the test says: the d20 first, then each damage die.
  rolls = [];
  jest.spyOn(d20, 'rollDie').mockImplementation((sides: number) => rolls.shift() ?? Math.ceil(sides / 2));
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

const tokenOf = async (id: string) => readTokens((await prisma.map.findUniqueOrThrow({ where: { id: mapId } })).tokens).find((t) => t.id === id);
const armed = (useMastery: boolean, feature = true) =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: {
      data: toJson({
        ...heroSheet(),
        proficiencyBonus: 2,
        stats: { strength: { score: 16, modifier: 3 }, dexterity: { score: 12, modifier: 1 } },
        featuresAndTraits: feature ? [{ name: 'Weapon Mastery (Fighter 1)', description: '' }] : [],
        attacks: [
          { name: 'Maul', attackBonus: 5, damageRoll: '2d6+3', damageType: 'bludgeoning', useMastery },
          { name: 'Greatsword', attackBonus: 5, damageRoll: '2d6+3', damageType: 'slashing', useMastery },
          { name: 'Pike', attackBonus: 5, damageRoll: '1d10+3', damageType: 'piercing', useMastery },
        ],
      }),
    },
  });
const MAUL = 0, GREATSWORD = 1, PIKE = 2;

describe('weapon masteries', () => {
  it('topples a target that fails its Constitution save: DC 8 + 3 + 2', async () => {
    await armed(true);
    // A hit, 2d6, then the ogre's Constitution save: 4 + 3 = 7, under 13.
    rolls = [15, 3, 3, 4];

    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: MAUL });

    expect(answer).toMatchObject({ ok: true, hit: true });
    expect(answer.summary).toMatch(/; Topple: Ogre fails \(Constitution 7 vs DC 13\) and is Prone$/);
    expect((await tokenOf(OGRE))?.conditions).toEqual(['Prone']);
  });

  it('leaves a target that makes the save on its feet', async () => {
    await armed(true);
    rolls = [15, 3, 3, 12];
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: MAUL });
    expect(answer.summary).toMatch(/; Topple: Ogre saves \(Constitution 15 vs DC 13\)$/);
    expect((await tokenOf(OGRE))?.conditions).toEqual([]);
  });

  it('grazes on a miss for the Strength modifier', async () => {
    await armed(true);
    rolls = [2];
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: GREATSWORD });
    expect(answer).toMatchObject({ hit: false });
    expect(answer.summary).toMatch(/; Graze: Ogre takes 3 slashing damage$/);
    expect((await tokenOf(OGRE))?.hp?.current).toBe(56);
  });

  it('pushes a hit target 10 feet straight away', async () => {
    await armed(true);
    rolls = [15, 5];
    const answer = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: PIKE });
    expect(answer.summary).toMatch(/; Push: Ogre is pushed 10 ft$/);
    // The hero stands at (1, 1); the ogre was at (2, 1).
    expect((await tokenOf(OGRE))?.position).toEqual({ x: 4, y: 1 });
  });

  it('does nothing for a weapon not marked, or for a character without Weapon Mastery', async () => {
    await armed(false);
    rolls = [2];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: GREATSWORD })).summary).not.toMatch(/Graze/);

    await armed(true, false);
    rolls = [2];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: GREATSWORD })).summary).not.toMatch(/Graze/);
    expect((await tokenOf(OGRE))?.hp?.current).toBe(59);
  });
});
