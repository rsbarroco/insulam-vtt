/**
 * A Cleric's features and the Life Domain over the socket: Disciple of Life,
 * Blessed Healer and Supreme Healing on a healing spell (combat.heal),
 * Preserve Life divided among Bloodied creatures (combat.heal with shares),
 * Sear Undead's damage with Turn Undead (combat.save), Divine Strike asked
 * after a weapon hit (combat.attack) and Potent Spellcasting on a cantrip.
 *
 * The fixtures are those of divineSpark.integration.test.ts.
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
      data: { email: `clericlife-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `clericlife-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `ClericLife ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
const asCleric = (level: number, features: string[] = [], extra: Record<string, unknown> = {}) =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: {
      data: toJson({
        ...heroSheet(features),
        class: 'Cleric',
        level,
        stats: { strength: { score: 10, modifier: 0 }, wisdom: { score: 16, modifier: 3 } },
        spellcasting: {
          spellAttackBonus: 6,
          spellSaveDC: 14,
          cantrips: ['Sacred Flame'],
          spells: [{ name: 'Cure Wounds', level: 1, prepared: true, ritual: false, concentration: false }],
          slots: { '1': { total: 4, expended: 0 }, '2': { total: 2, expended: 0 } },
        },
        ...extra,
      }),
    },
  });
const listed = async () =>
  ((await ask(player, 'combat.actions', { tokenId: HERO })) as unknown as { actions: Array<{ index: number; name: string; save: { damage: string } | null }> }).actions;
const indexOf = async (name: string) => (await listed()).find((action) => action.name === name)?.index;
const sheetNow = async () =>
  (await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data as { hp: { current: number }; featureUses?: Record<string, number> };
const tokenNow = async (id: string) =>
  ((await prisma.map.findUnique({ where: { id: mapId } }))!.tokens as Array<{ id: string; conditions?: string[]; hp?: { current: number } }>).find((t) => t.id === id)!;
const hurt = (hp: Record<string, number>, extra: Record<string, Record<string, unknown>> = {}) =>
  prisma.map.update({
    where: { id: mapId },
    data: {
      tokens: toJson(
        freshTokens().map((t) => ({ ...t, ...(hp[t.id] !== undefined ? { hp: { current: hp[t.id], max: 40, temp: 0 } } : {}), ...(extra[t.id] ?? {}) }))
      ),
    },
  });

describe('The Life Domain on a healing spell', () => {
  it('adds 2 + the slot level with Disciple of Life, and heals the Cleric with Blessed Healer', async () => {
    fight();
    await asCleric(6, ['Disciple of Life (Cleric 3)', 'Blessed Healer (Cleric 6)'], { hp: { current: 10, maximum: 30, temporary: 0 } });
    await hurt({ [ALLY]: 2, [OGRE]: 2 });
    const index = await indexOf('Cure Wounds');
    // 2d8 + 4 = 3 + 5 + 4 = 12, and 2 + 2 for the level 2 slot.
    rolls = [3, 5];
    const healed = await ask(player, 'combat.heal', { casterId: HERO, targetId: OGRE, action: index, slotLevel: 2 });
    // A level 2 slot rolls 4d8: the two unnamed dice come up 4 (half of 8) each.
    expect(healed.summary).toBe('Cure Wounds (level 2): Ogre regains 24 Hit Points (Disciple of Life +4); Hero regains 4 Hit Points (Blessed Healer)');
    expect((await tokenNow(OGRE)).hp?.current).toBe(26);
    expect((await sheetNow()).hp.current).toBe(14);
  });

  it('does not heal the Cleric twice when it heals itself', async () => {
    fight();
    await asCleric(6, ['Disciple of Life', 'Blessed Healer'], { hp: { current: 5, maximum: 30, temporary: 0 } });
    const index = await indexOf('Cure Wounds');
    rolls = [3, 5];
    const healed = await ask(player, 'combat.heal', { casterId: HERO, targetId: HERO, action: index });
    expect(healed.summary).toBe('Cure Wounds (level 1): Hero regains 15 Hit Points (Disciple of Life +3)');
    expect((await sheetNow()).hp.current).toBe(20);
  });

  it('takes each die at its highest with Supreme Healing, for a spell and for Divine Spark', async () => {
    fight();
    await asCleric(17, ['Supreme Healing (Cleric 17)']);
    await hurt({ [ALLY]: 2, [OGRE]: 2 });
    rolls = [1, 1, 1, 1, 1];
    const spell = await ask(player, 'combat.heal', { casterId: HERO, targetId: OGRE, action: await indexOf('Cure Wounds') });
    expect(spell.summary).toBe('Cure Wounds (level 1): Ogre regains 20 Hit Points (Supreme Healing)');
    fight();
    // Cleric 17 rolls 3d8 + Wisdom for Divine Spark: 24 + 3.
    const spark = await ask(player, 'combat.heal', { casterId: HERO, targetId: ALLY, action: await indexOf('Divine Spark (healing)') });
    expect(spark.summary).toBe('Divine Spark (healing), a use of Channel Divinity: Ally regains 27 Hit Points (Supreme Healing)');
  });

  it('leaves a Cleric without the features as it was', async () => {
    fight();
    await asCleric(6);
    await hurt({ [ALLY]: 2, [OGRE]: 2 });
    rolls = [3, 5];
    const healed = await ask(player, 'combat.heal', { casterId: HERO, targetId: OGRE, action: await indexOf('Cure Wounds') });
    expect(healed.summary).toBe('Cure Wounds (level 1): Ogre regains 12 Hit Points');
  });
});

describe('Preserve Life', () => {
  it('divides five times the Cleric level among Bloodied creatures, each to half its maximum at most', async () => {
    fight();
    await asCleric(3, ['Preserve Life (Cleric 3)'], { hp: { current: 6, maximum: 30, temporary: 0 } });
    await hurt({ [ALLY]: 16, [OGRE]: 30 });
    const index = await indexOf('Preserve Life');
    expect(index).toBeDefined();
    // 15 Hit Points: the ally is 4 short of half its 40, the Cleric takes 8.
    const answer = await ask(player, 'combat.heal', { casterId: HERO, action: index, shares: [{ targetId: ALLY, amount: 7 }, { targetId: HERO, amount: 8 }] });
    expect(answer.summary).toBe('Preserve Life, a use of Channel Divinity: Ally regains 4 Hit Points, Hero regains 8 Hit Points');
    expect((await tokenNow(ALLY)).hp?.current).toBe(20);
    expect((await sheetNow()).hp.current).toBe(14);
    expect((await sheetNow()).featureUses?.['Channel Divinity']).toBe(1);
    expect(getState(campaignId).turn?.action).toBe('Magic');
  });

  it('refuses more than the pool, a creature that is not Bloodied, and one out of range', async () => {
    fight();
    await asCleric(3, ['Preserve Life'], { hp: { current: 6, maximum: 30, temporary: 0 } });
    await hurt({ [ALLY]: 16, [OGRE]: 30, [FAR]: 5 });
    const index = await indexOf('Preserve Life');
    const send = (shares: Array<{ targetId: string; amount: number }>) => ask(player, 'combat.heal', { casterId: HERO, action: index, shares });
    expect((await send([{ targetId: ALLY, amount: 10 }, { targetId: HERO, amount: 6 }])).error).toBe('Preserve Life restores 15 Hit Points at most, and 16 were asked for');
    expect((await send([{ targetId: OGRE, amount: 5 }])).error).toBe('Ogre is not Bloodied');
    expect((await send([{ targetId: FAR, amount: 5 }])).error).toBe('Far Ogre is beyond the 30 ft range of Preserve Life');
    expect((await send([{ targetId: ALLY, amount: 2 }, { targetId: ALLY, amount: 2 }])).error).toBe('Ally is chosen twice');
    expect((await sheetNow()).featureUses?.['Channel Divinity'] ?? 0).toBe(0);
  });

  it('is not listed for a Cleric without the feature', async () => {
    await asCleric(3);
    expect(await indexOf('Preserve Life')).toBeUndefined();
  });
});

describe('Sear Undead', () => {
  it('deals Wisdom-modifier d8s of Radiant damage to an Undead that fails, and leaves it turned', async () => {
    fight();
    await asCleric(5);
    await hurt({}, { [OGRE]: { statBlock: { ...ogreBlock, creatureType: 'Large Undead' } } });
    const index = await indexOf('Turn Undead');
    // 3d8 = 2 + 3 + 4 = 9; the ogre's save: 5 - 2 = 3 against DC 14.
    rolls = [2, 3, 4, 5];
    const turned = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: index });
    expect(turned.targets?.[0]).toMatchObject({ saved: false, dealt: 9 });
    expect(turned.summary).toContain('Ogre is turned');
    expect(turned.summary).not.toContain('no longer turned');
    const ogre = await tokenNow(OGRE);
    expect(ogre.hp?.current).toBe(50);
    expect(ogre.conditions).toEqual(expect.arrayContaining(['Frightened', 'Incapacitated']));
    expect(getState(campaignId).marks.filter((mark) => mark.kind === 'condition' && mark.targetId === OGRE && mark.action === 'Turn Undead')).toHaveLength(2);
  });

  it('spares an Undead that succeeds', async () => {
    fight();
    await asCleric(5);
    await hurt({}, { [OGRE]: { statBlock: { ...ogreBlock, creatureType: 'Large Undead' } } });
    rolls = [2, 3, 4, 19];
    const turned = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: await indexOf('Turn Undead') });
    expect(turned.targets?.[0]).toMatchObject({ saved: true, dealt: 0 });
    expect((await tokenNow(OGRE)).conditions ?? []).not.toContain('Frightened');
  });
});

describe('Blessed Strikes', () => {
  const answerWith = (choice: string | null) => {
    const offers: Array<{ options: string[] }> = [];
    player.on('combat.prompt', (offer: { promptId: string; options: string[] }) => {
      offers.push(offer);
      player.emit('combat.react', { promptId: offer.promptId, choice }, () => undefined);
    });
    return offers;
  };

  it('asks after a weapon hit whether to add Divine Strike, once on each of the Cleric’s turns', async () => {
    fight();
    await asCleric(7, ['Blessed Strikes: Divine Strike', 'Extra Attack']);
    const offers = answerWith('Divine Strike (Radiant)');
    const sword = await indexOf('Longsword');
    // The d20, the longsword's d8, then Divine Strike's d8.
    rolls = [15, 4, 6];
    const first = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: sword });
    expect(first.dealt).toBe(13);
    expect(first.summary).toContain('radiant');
    expect(offers).toHaveLength(1);
    expect(offers[0].options).toEqual(['Divine Strike (Radiant)', 'Divine Strike (Necrotic)']);
    rolls = [15, 4];
    const second = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: sword });
    expect(second.dealt).toBe(7);
    expect(offers).toHaveLength(1);
  });

  it('adds 2d8 from Cleric 14, and nothing when declined', async () => {
    fight();
    await asCleric(14, ['Divine Strike', 'Extra Attack']);
    const offers = answerWith(null);
    const sword = await indexOf('Longsword');
    rolls = [15, 4];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: sword })).dealt).toBe(7);
    expect(offers).toHaveLength(1);
    // Declined, it is still there for the next hit of the turn.
    player.off('combat.prompt');
    answerWith('Divine Strike (Necrotic)');
    rolls = [15, 4, 6, 2];
    const hit = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: sword });
    expect(hit.dealt).toBe(15);
    expect(hit.summary).toContain('necrotic');
  });

  it('does not ask a Cleric whose sheet names no option', async () => {
    fight();
    await asCleric(7, ['Blessed Strikes (Cleric 7)']);
    const offers = answerWith('Divine Strike (Radiant)');
    rolls = [15, 4];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await indexOf('Longsword') })).dealt).toBe(7);
    expect(offers).toHaveLength(0);
  });

  it('adds the Wisdom modifier to a Cleric cantrip with Potent Spellcasting', async () => {
    await asCleric(7, ['Blessed Strikes: Potent Spellcasting']);
    expect((await listed()).find((action) => action.name === 'Sacred Flame')?.save?.damage).toBe('2d8+3 radiant');
    await asCleric(7, ['Blessed Strikes (Cleric 7)']);
    expect((await listed()).find((action) => action.name === 'Sacred Flame')?.save?.damage).toBe('2d8 radiant');
  });
});
