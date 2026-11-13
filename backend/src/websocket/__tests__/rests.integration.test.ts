/**
 * Rests, over the socket: a Short Rest spends a Hit Point Die and heals, a
 * Long Rest gives everything back and is the DM's to give.
 *
 * The fixtures are those of combatAttack.integration.test.ts.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson } from '../../utils/prisma-json';
import { createWsTestServer, waitForEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
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
  dmId = (await prisma.user.create({ data: { email: `rest-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' } })).id;
  playerId = (await prisma.user.create({ data: { email: `rest-player-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Player' } })).id;
  campaignId = (await prisma.campaign.create({ data: { name: `Rest ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' } })).id;
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

const heroData = async () =>
  (await prisma.character.findUniqueOrThrow({ where: { id: heroCharacterId } })).data as {
    hp: { current: number; maximum: number; temporary: number };
    hitDice: Array<{ remaining: number }>;
    spellcasting: { slots: Record<string, { total: number; expended: number }> };
    exhaustionLevel: number;
  };
const tired = () =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: {
      data: toJson({
        ...heroSheet(),
        hp: { current: 9, maximum: 30, temporary: 3 },
        stats: { strength: { score: 16, modifier: 3 }, constitution: { score: 14, modifier: 2 } },
        hitDice: [{ class: 'Fighter', die: 'd10', maximum: 3, remaining: 1 }],
        spellcasting: { ...heroSheet().spellcasting, slots: { '3': { total: 2, expended: 2 }, '4': { total: 1, expended: 1 } } },
        exhaustionLevel: 1,
      }),
    },
  });

describe('combat.rest', () => {
  it('spends a Hit Point Die on a Short Rest: rolls it, heals and logs it', async () => {
    await tired();
    rolls = [7];
    const hpSent = waitForEvent<{ characterId: string; hp: { current: number } }>(dm, 'character.hp.updated');
    const logged = waitForEvent<{ purpose: string; result: number; expression: string }>(dm, 'dice.rolled');

    const answer = await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'short' });

    expect(answer).toEqual({ ok: true, summary: 'Hero spends a Hit Point Die (d10+2): regains 9 Hit Points, 0 dice left' });
    expect(await hpSent).toMatchObject({ characterId: heroCharacterId, hp: { current: 18 } });
    expect(await logged).toMatchObject({ expression: '1d10+2', result: 9, purpose: answer.summary });
    expect(await heroData()).toMatchObject({ hp: { current: 18, temporary: 3 }, hitDice: [{ remaining: 0 }] });
  });

  it('has nothing to spend once the dice are gone', async () => {
    await tired();
    await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'short' });
    const again = await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'short' });
    expect(again).toEqual({ ok: false, error: 'Hero: No Hit Point Dice left to spend' });
  });

  it('gives everything back on a Long Rest, from the DM', async () => {
    await tired();

    const answer = await ask(dm, 'combat.rest', { characterId: heroCharacterId, kind: 'long' });

    expect(answer.summary).toBe('Hero finishes a Long Rest: 21 Hit Points, 2 Hit Point Dice, 3 spell slots, Exhaustion 1 to 0');
    expect(await heroData()).toMatchObject({
      hp: { current: 30, maximum: 30, temporary: 0 },
      hitDice: [{ remaining: 3 }],
      spellcasting: { slots: { '3': { total: 2, expended: 0 }, '4': { total: 1, expended: 0 } } },
      exhaustionLevel: 0,
    });
  });

  it('refuses a player a Long Rest, and a character that is not theirs', async () => {
    await tired();
    expect((await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'long' })).error).toBe('A Long Rest is the DM’s to give');
    expect((await heroData()).hp.current).toBe(9);

    const other = await prisma.character.create({
      data: { userId: dmId, campaignId, name: 'Other', gameSystem: 'DND_5E', data: toJson(heroSheet()) },
    });
    expect((await ask(player, 'combat.rest', { characterId: other.id, kind: 'short' })).error).toBe('That is not a D&D 5e character you can rest');
  });
});
