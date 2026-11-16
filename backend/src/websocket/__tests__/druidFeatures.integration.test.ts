/**
 * A Druid's features over the socket: Land's Aid (the saves of the creatures
 * chosen and the Hit Points one creature regains, for a use of Wild Shape),
 * Primal Strike asked on a hit, Potent Spellcasting on a Druid cantrip, Wild
 * Resurgence, Wild Companion, Natural Recovery as a Short Rest ends and
 * Nature's Ward.
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
  left?: number;
  healed?: { tokenId: string; amount: number };
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
      name: 'Torch',
      description: 'Melee Attack Roll: +6, reach 5 ft. Hit: 8 (2d4 + 3) Fire damage.',
    },
    {
      name: 'Sting',
      description: 'Melee Attack Roll: +6, reach 5 ft. Hit: 5 (1d4 + 3) Piercing damage, and the target has the Poisoned condition until the start of the ogre’s next turn.',
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
    cantrips: ['Fire Bolt', 'Starry Wisp'],
    spells: [{ name: 'Fireball', level: 3, prepared: true, ritual: false, concentration: false }],
    slots: { '1': { total: 4, expended: 2 }, '3': { total: 2, expended: 0 }, '4': { total: 1, expended: 0 } },
  },
});

let rolls: number[] = [];

beforeAll(async () => {
  dmId = (
    await prisma.user.create({
      data: { email: `druidfeat-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `druidfeat-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `Druid features ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
type Sheet = {
  hp: { current: number };
  featureUses?: Record<string, number>;
  spellcasting: { slots: Record<string, { expended: number }> };
};
const asDruid = (level: number, features: string[] = [], extra: Record<string, unknown> = {}) =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: { data: toJson({ ...heroSheet(features), class: 'Druid', level, ...extra }) },
  });
const sheet = async () => (await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data as unknown as Sheet;
const hero = async () =>
  ((await prisma.map.findUnique({ where: { id: mapId } }))!.tokens as Array<{ id: string; conditions?: string[] }>).find((t) => t.id === HERO)!;
type Listed = { index: number; name: string; attack: { damage: string } | null; areaHeal?: string; heal?: { dice: string; rangeFeet: number } };
const actions = async (socket: ClientSocket = player, tokenId = HERO) =>
  ((await ask(socket, 'combat.actions', { tokenId })) as unknown as { actions: Listed[]; resources: Array<{ name: string; max: number; used: number }> });
const indexOf = async (name: string, socket: ClientSocket = player, tokenId = HERO) => (await actions(socket, tokenId)).actions.find((action) => action.name === name)!.index;
const feature = (name: string, extra: Record<string, unknown> = {}) => ask(player, 'combat.feature', { tokenId: HERO, feature: name, ...extra });
/** Answer the next prompt the player is sent with this choice, and keep what was offered. */
const answerWith = (choice: string | null) => {
  const offered: { options?: string[]; text?: string } = {};
  player.once('combat.prompt', (offer: { promptId: string; options: string[]; text: string }) => {
    offered.options = offer.options;
    offered.text = offer.text;
    player.emit('combat.react', { promptId: offer.promptId, choice }, () => undefined);
  });
  return offered;
};

describe("Land's Aid", () => {
  it('rolls the saves of the creatures chosen and restores Hit Points to the one named, for a use of Wild Shape', async () => {
    fight();
    await asDruid(3, ['Land’s Aid (Druid 3)'], { hp: { current: 20, maximum: 30, temporary: 0 } });
    const listed = (await actions()).actions.find((action) => action.name === "Land's Aid")!;
    expect(listed.areaHeal).toBe('2d6');
    // The damage (3 + 4), the Ogre's save (5 + 3 against DC 14), then the healing (2 + 5).
    rolls = [3, 4, 5, 2, 5];
    const done = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: listed.index, healId: HERO });
    expect(done.error).toBeUndefined();
    expect(done.targets).toEqual([{ tokenId: OGRE, saved: false, total: 8, dealt: 7 }]);
    expect(done.healed).toEqual({ tokenId: HERO, amount: 7 });
    expect(done.summary).toContain('Hero regains 7 Hit Points (2d6)');
    const after = await sheet();
    expect(after.hp.current).toBe(27);
    expect(after.featureUses).toEqual({ 'Wild Shape': 1 });
    expect(getState(campaignId).turn?.action).toBe('Magic');
  });

  it('refuses a creature outside the area, and a creature to heal for another effect', async () => {
    fight();
    await asDruid(3, ["Land's Aid"]);
    const aid = await indexOf("Land's Aid");
    expect((await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: aid, healId: FAR })).error).toBe(
      "Far Ogre is not in the area of Land's Aid"
    );
    expect((await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: aid, point: { x: 2, y: 1 }, healId: FAR })).error).toBe(
      "Far Ogre is not in the area of Land's Aid"
    );
    const fireball = await indexOf('Fireball');
    expect((await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: fireball, healId: HERO })).error).toBe(
      'Fireball restores no Hit Points to a creature in its area'
    );
    expect((await sheet()).featureUses).toBeUndefined();
  });

  it('can only restore Hit Points, to the Druid itself too, and is gone with the last use', async () => {
    fight();
    await asDruid(10, ["Land's Aid"], { hp: { current: 10, maximum: 30, temporary: 0 }, featureUses: { 'Wild Shape': 2 } });
    const listed = (await actions()).actions.find((action) => action.name === "Land's Aid (healing only)")!;
    expect(listed.heal).toEqual({ dice: '3d6+0', rangeFeet: 70 });
    rolls = [1, 2, 3];
    const done = await ask(player, 'combat.heal', { casterId: HERO, targetId: HERO, action: listed.index });
    expect(done.summary).toBe("Land's Aid (healing only), a use of Wild Shape: Hero regains 6 Hit Points");
    expect((await sheet()).hp.current).toBe(16);
    expect((await sheet()).featureUses).toEqual({ 'Wild Shape': 3 });
    expect((await actions()).actions.map((action) => action.name)).not.toContain("Land's Aid");
  });
});

describe('Elemental Fury', () => {
  it('asks for Primal Strike on a weapon hit, once on each of the Druid’s turns', async () => {
    fight();
    await asDruid(7, ['Elemental Fury: Primal Strike']);
    const sword = await indexOf('Longsword');
    const offered = answerWith('Primal Strike (Fire)');
    // The d20, the Longsword's d8, then Primal Strike's d8.
    rolls = [15, 4, 6];
    const hit = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: sword });
    expect(offered.options).toEqual(['Primal Strike (Cold)', 'Primal Strike (Fire)', 'Primal Strike (Lightning)', 'Primal Strike (Thunder)']);
    expect(hit.dealt).toBe(13);
    expect(hit.summary).toBe('Longsword vs Ogre (AC 11): hit, 13 slashing and fire damage; Primal Strike (Fire)');
    // The same turn: no second offer.
    fight();
    let asked = false;
    player.once('combat.prompt', (offer: { promptId: string }) => {
      asked = true;
      player.emit('combat.react', { promptId: offer.promptId, choice: null }, () => undefined);
    });
    rolls = [15, 4, 6];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: sword })).dealt).toBe(7);
    expect(asked).toBe(false);
    player.removeAllListeners('combat.prompt');
  });

  it('adds nothing when the offer is passed, and offers a Beast form’s attack', async () => {
    fight();
    await asDruid(7, ['Primal Strike']);
    answerWith(null);
    rolls = [15, 4];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await indexOf('Longsword') })).dealt).toBe(7);
    fight();
    await feature('Wild Shape', { form: 'Wolf' });
    fight();
    const bite = (await actions()).actions.find((action) => action.name === 'Bite')!;
    const offered = answerWith('Primal Strike (Cold)');
    // The d20, the Bite's die (1 + 2), then Primal Strike's d8.
    rolls = [15, 1, 5];
    const hit = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: bite.index });
    expect(offered.options).toHaveLength(4);
    expect(hit.dealt).toBe(8);
    expect(hit.summary).toContain('Primal Strike (Cold)');
  });

  it('adds the Wisdom modifier to a Druid cantrip with Potent Spellcasting', async () => {
    await asDruid(7, ['Elemental Fury: Potent Spellcasting']);
    const listed = (await actions()).actions;
    expect(listed.find((action) => action.name === 'Starry Wisp')!.attack!.damage).toBe('2d8+1 radiant');
    expect(listed.find((action) => action.name === 'Fire Bolt')!.attack!.damage).toBe('2d10 fire');
  });
});

describe('Wild Resurgence and Wild Companion', () => {
  it('expends a spell slot for a use of Wild Shape, once on a turn with none left', async () => {
    fight();
    await asDruid(5, [], { featureUses: { 'Wild Shape': 2 } });
    const done = await feature('Wild Resurgence', { slotLevel: 3 });
    expect(done.summary).toBe('Hero: Wild Resurgence: a level 3 spell slot expended for a use of Wild Shape');
    expect(done.left).toBe(1);
    const after = await sheet();
    expect(after.spellcasting.slots['3'].expended).toBe(1);
    expect(after.featureUses).toEqual({ 'Wild Shape': 1 });
    expect((await feature('Wild Resurgence', { slotLevel: 3 })).error).toBe('Hero has expended a spell slot with Wild Resurgence this turn');
  });

  it('expends a use of Wild Shape for a level 1 spell slot, once until a Long Rest', async () => {
    fight();
    await asDruid(5);
    const done = await feature('Wild Resurgence');
    expect(done.summary).toBe('Hero: Wild Resurgence: a use of Wild Shape expended for a level 1 spell slot (1 use of Wild Shape left)');
    const after = await sheet();
    expect(after.spellcasting.slots['1'].expended).toBe(1);
    expect(after.featureUses).toEqual({ 'Wild Shape': 1, 'Wild Resurgence': 1 });
    expect((await feature('Wild Resurgence')).error).toBe('Hero: Wild Resurgence has given its spell slot until a Long Rest');
    expect((await feature('Wild Resurgence', { slotLevel: 3 })).error).toBe('Hero: Wild Resurgence gives a use of Wild Shape when none is left');
    expect((await feature('Wild Shape', { form: 'Wolf', slotLevel: 1 })).error).toBe('Only Wild Resurgence, Wild Companion and Font of Inspiration take a spell slot');
  });

  it('casts Find Familiar with Wild Companion: a Magic action and a use of Wild Shape, or a spell slot', async () => {
    fight();
    await asDruid(2);
    const done = await feature('Wild Companion');
    expect(done.summary).toBe('Hero: Wild Companion: Find Familiar cast with a use of Wild Shape (1 left); the familiar is the table’s to place');
    expect(getState(campaignId).turn?.action).toBe('Magic');
    expect((await feature('Wild Companion')).error).toBe('Hero has taken its action this turn');
    fight();
    await feature('Wild Companion', { slotLevel: 1 });
    const after = await sheet();
    expect(after.spellcasting.slots['1'].expended).toBe(3);
    expect(after.featureUses).toEqual({ 'Wild Shape': 1 });
  });
});

describe('Natural Recovery', () => {
  it('recovers a Land Druid’s slots as a Short Rest ends, once until a Long Rest', async () => {
    await asDruid(6, ['Natural Recovery (Druid 6)']);
    const finish = (recover: number[]) => ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'shortFinish', recover });
    expect((await finish([1, 1, 1, 1])).error).toBe('Hero: Those slots come to level 4; Natural Recovery recovers 3 at most');
    expect((await finish([1, 1])).summary).toBe('Hero finishes a Short Rest: Natural Recovery: 2 spell slots recovered (level 1, level 1)');
    expect((await sheet()).spellcasting.slots['1'].expended).toBe(0);
    expect((await finish([1])).error).toBe('Hero: Natural Recovery is used until a Long Rest');
  });
});

describe("Nature's Ward", () => {
  it('resists the damage of the land the sheet names, and keeps the Poisoned condition off', async () => {
    fight();
    await asDruid(10, ['Nature’s Ward (Arid)']);
    // 2 + 2 + 3 = 7 Fire damage, halved to 3.
    rolls = [15, 2, 2];
    const burnt = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: await indexOf('Torch', dm, OGRE) });
    expect(burnt.dealt).toBe(3);
    rolls = [15, 1];
    const stung = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: await indexOf('Sting', dm, OGRE) });
    expect(stung.summary).toContain("Hero is immune to the Poisoned condition (Nature's Ward)");
    expect((await hero()).conditions ?? []).not.toContain('Poisoned');
  });

  it('leaves another Druid Poisoned', async () => {
    fight();
    await asDruid(9, ['Nature’s Ward (Arid)']);
    rolls = [15, 1];
    await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: await indexOf('Sting', dm, OGRE) });
    expect((await hero()).conditions).toContain('Poisoned');
  });
});
