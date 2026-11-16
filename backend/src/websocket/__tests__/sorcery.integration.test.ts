/**
 * A Sorcerer's own features over the socket: Font of Magic creates a spell
 * slot from Sorcery Points and converts one back, Innate Sorcery raises the
 * save DC and gives Advantage on spell attacks for a minute of the fight,
 * Transmuted Spell changes a damage type, Elemental Affinity adds the
 * Charisma modifier and resists, and Sorcerous Restoration gives points back
 * as a Short Rest ends.
 *
 * The fixtures are those of metamagic.integration.test.ts.
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
  dc?: number;
  left?: number;
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
      name: 'Fire Breath',
      description: 'Dexterity Saving Throw: DC 13, each creature within 10 feet. Failure: 9 (2d8) Fire damage. Success: Half damage.',
    },
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
      data: { email: `sorcery-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `sorcery-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `Sorcery ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
const indexOf = async (socket: ClientSocket, tokenId: string, name: string) => {
  const listed = (await ask(socket, 'combat.actions', { tokenId })) as unknown as {
    actions: Array<{ index: number; name: string }>;
  };
  return listed.actions.find((action) => action.name === name)!.index;
};

const asSorcerer = (featureUses: Record<string, number> = {}, features: string[] = [], level = 5, expended = 0) =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: {
      data: toJson({
        ...heroSheet(),
        class: 'Sorcerer',
        level,
        stats: { strength: { score: 10, modifier: 0 }, charisma: { score: 16, modifier: 3 } },
        featuresAndTraits: features.map((name) => ({ name })),
        featureUses,
        spellcasting: { ...heroSheet().spellcasting, slots: { '3': { total: 2, expended }, '4': { total: 1, expended: 0 } } },
      }),
    },
  });
interface Sheet {
  featureUses?: Record<string, number>;
  createdSlots?: Record<string, number>;
  spellcasting: { slots: Record<string, { total: number; expended: number }> };
}
const sheetNow = async () => (await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data as unknown as Sheet;
const fireball = async (targetIds: string[], metamagic?: Record<string, unknown>) =>
  ask(player, 'combat.save', { sourceId: HERO, targetIds, action: await indexOf(player, HERO, 'Fireball'), slotLevel: 3, ...(metamagic ? { metamagic } : {}) });
const eightOnes = [1, 1, 1, 1, 1, 1, 1, 1];

describe('Font of Magic', () => {
  it('creates a spell slot from Sorcery Points as a Bonus Action', async () => {
    fight();
    await asSorcerer({}, [], 5, 1);
    const made = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Font of Magic', create: 3 });
    expect(made).toMatchObject({ ok: true, left: 0 });
    expect(made.summary).toContain('a level 3 spell slot created for 5 Sorcery Points');
    const sheet = await sheetNow();
    expect(sheet.spellcasting.slots['3']).toEqual({ total: 2, expended: 0 });
    expect(sheet.featureUses?.['Sorcery Points']).toBe(5);
    expect(getState(campaignId).turn?.bonusAction).toBe(true);
    const again = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Font of Magic', create: 1 });
    expect(again).toMatchObject({ ok: false, error: 'Hero has used its Bonus Action this turn' });
  });

  it('adds a slot when none is expended, which a Long Rest takes away', async () => {
    await asSorcerer();
    const made = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Font of Magic', create: 3 });
    expect(made.ok).toBe(true);
    expect((await sheetNow()).spellcasting.slots['3']).toEqual({ total: 3, expended: 0 });
    expect((await sheetNow()).createdSlots).toEqual({ '3': 1 });
    expect((await ask(dm, 'combat.rest', { characterId: heroCharacterId, kind: 'long' })).ok).toBe(true);
    const rested = await sheetNow();
    expect(rested.spellcasting.slots['3']).toEqual({ total: 2, expended: 0 });
    expect(rested.createdSlots).toBeUndefined();
    expect(rested.featureUses?.['Sorcery Points'] ?? 0).toBe(0);
  });

  it('converts a spell slot into Sorcery Points with no action', async () => {
    fight({ bonusAction: true });
    await asSorcerer({ 'Sorcery Points': 4 });
    const back = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Font of Magic', convert: 3 });
    expect(back).toMatchObject({ ok: true, left: 4 });
    const sheet = await sheetNow();
    expect(sheet.spellcasting.slots['3']).toEqual({ total: 2, expended: 1 });
    expect(sheet.featureUses?.['Sorcery Points']).toBe(1);
  });

  it('refuses a slot the Sorcerer level cannot create, and a request that says neither or both', async () => {
    await asSorcerer({}, [], 4);
    expect(await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Font of Magic', create: 3 })).toMatchObject({
      ok: false,
      error: 'Hero: A level 3 spell slot is created from Sorcerer level 5',
    });
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Font of Magic' })).ok).toBe(false);
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Font of Magic', create: 1, convert: 3 })).ok).toBe(false);
  });
});

describe('Innate Sorcery', () => {
  it('raises the save DC by 1 and gives Advantage on spell attack rolls', async () => {
    fight();
    await asSorcerer();
    const used = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Innate Sorcery' });
    expect(used).toMatchObject({ ok: true, left: 1 });
    expect(getState(campaignId).marks.find((mark) => mark.kind === 'innate')).toMatchObject({ attackerId: HERO, turnEndsLeft: 10 });
    expect(getState(campaignId).turn?.bonusAction).toBe(true);
    expect((await sheetNow()).featureUses?.['Innate Sorcery']).toBe(1);

    rolls = [...eightOnes, 10];
    const burned = await fireball([OGRE]);
    expect(burned).toMatchObject({ ok: true, dc: 15 });

    fight({ bonusAction: true });
    setState(campaignId, { ...getState(campaignId), marks: [{ kind: 'innate', attackerId: HERO, targetId: HERO, turnEndsLeft: 9 }] });
    rolls = [15, 15, 3, 3];
    const bolt = await ask(player, 'combat.attack', { attackerId: HERO, targetId: FAR, action: await indexOf(player, HERO, 'Fire Bolt') });
    expect(bolt.ok).toBe(true);
    expect(bolt.reasons).toContain('Advantage: Innate Sorcery');
    // A weapon attack gets nothing from it.
    fight();
    setState(campaignId, { ...getState(campaignId), marks: [{ kind: 'innate', attackerId: HERO, targetId: HERO, turnEndsLeft: 9 }] });
    const sword = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await indexOf(player, HERO, 'Longsword') });
    expect(sword.reasons ?? []).not.toContain('Advantage: Innate Sorcery');
  });

  it('is refused while active, outside a fight, and with no use left below level 7', async () => {
    await asSorcerer();
    expect(await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Innate Sorcery' })).toMatchObject({ ok: false, error: 'Innate Sorcery is kept during combat' });
    fight();
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Innate Sorcery' })).ok).toBe(true);
    fight();
    setState(campaignId, { ...getState(campaignId), marks: [{ kind: 'innate', attackerId: HERO, targetId: HERO, turnEndsLeft: 9 }] });
    expect(await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Innate Sorcery' })).toMatchObject({ ok: false, error: "Hero's Innate Sorcery is already active" });
    fight();
    await asSorcerer({ 'Innate Sorcery': 2 });
    expect(await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Innate Sorcery' })).toMatchObject({
      ok: false,
      error: 'Hero: No uses of Innate Sorcery left until a Long Rest',
    });
  });

  it('costs 2 Sorcery Points with no use left, from level 7 (Sorcery Incarnate)', async () => {
    fight();
    await asSorcerer({ 'Innate Sorcery': 2 }, [], 7);
    const used = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Innate Sorcery' });
    expect(used.ok).toBe(true);
    expect(used.summary).toContain('Sorcery Incarnate, 2 Sorcery Points');
    expect((await sheetNow()).featureUses).toMatchObject({ 'Innate Sorcery': 2, 'Sorcery Points': 2 });
  });
});

describe('Transmuted Spell and Elemental Affinity', () => {
  it('adds the Charisma modifier to a spell of the affinity type, and to one transmuted into it', async () => {
    fight();
    await asSorcerer({}, ['Elemental Affinity: Fire (Sorcerer 6)', 'Transmuted Spell']);
    // 8d6 of 1s + 3; the ogre rolls 2 and fails.
    rolls = [...eightOnes, 2];
    expect((await fireball([OGRE])).targets?.[0]).toMatchObject({ saved: false, dealt: 11 });

    fight();
    await asSorcerer({}, ['Elemental Affinity: Cold (Sorcerer 6)', 'Transmuted Spell']);
    rolls = [...eightOnes, 2];
    expect((await fireball([OGRE])).targets?.[0]).toMatchObject({ saved: false, dealt: 8 });
    fight();
    rolls = [...eightOnes, 2];
    const cold = await fireball([OGRE], { option: 'transmuted', damageType: 'cold' });
    expect(cold.targets?.[0]).toMatchObject({ saved: false, dealt: 11 });
    expect((await sheetNow()).featureUses?.['Sorcery Points']).toBe(1);
  });

  it('refuses Transmuted Spell without a type, for the same type, and unknown to the sheet', async () => {
    fight();
    await asSorcerer({}, ['Transmuted Spell']);
    expect(await fireball([OGRE], { option: 'transmuted' })).toMatchObject({ ok: false, error: 'Transmuted Spell names the damage type the spell deals instead' });
    expect((await fireball([OGRE], { option: 'transmuted', damageType: 'fire' })).ok).toBe(false);
    await asSorcerer();
    expect(await fireball([OGRE], { option: 'transmuted', damageType: 'cold' })).toMatchObject({ ok: false, error: 'Hero does not know Transmuted Spell' });
    expect((await sheetNow()).featureUses?.['Sorcery Points'] ?? 0).toBe(0);
  });

  it('resists damage of the affinity type', async () => {
    await asSorcerer({}, ['Elemental Affinity: Fire (Sorcerer 6)']);
    // 2d8 of 4s; the hero rolls 1 and fails: 8 Fire damage, halved.
    rolls = [4, 4, 1];
    const breath = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [HERO], action: await indexOf(dm, OGRE, 'Fire Breath') });
    expect(breath.targets?.[0]).toMatchObject({ saved: false, dealt: 4 });
  });
});

describe('Sorcerous Restoration', () => {
  it('gives back half the Sorcerer level in Sorcery Points as a Short Rest ends, once', async () => {
    await asSorcerer({ 'Sorcery Points': 4 });
    const rested = await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'shortFinish', restore: true });
    expect(rested.ok).toBe(true);
    expect(rested.summary).toContain('Sorcerous Restoration: 2 Sorcery Points regained');
    expect((await sheetNow()).featureUses).toMatchObject({ 'Sorcery Points': 2, 'Sorcerous Restoration': 1 });
    expect(await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'shortFinish', restore: true })).toMatchObject({
      ok: false,
      error: 'Hero: Sorcerous Restoration is used until a Long Rest',
    });
    expect((await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'short', restore: true })).ok).toBe(false);
  });
});
