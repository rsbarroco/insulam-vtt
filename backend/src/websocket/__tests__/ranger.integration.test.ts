/**
 * A Ranger's features and the Hunter subclass over the socket: Colossus Slayer
 * and Horde Breaker, Precise Hunter, Foe Slayer and Relentless Hunter on
 * Hunter's Mark, Defensive Tactics, Tireless, Nature's Veil, Hunter's Lore and
 * the Superior Hunter's features, asked once the damage is known.
 *
 * The fixtures are those of huntersMark.integration.test.ts.
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
const GOBLIN = randomUUID();

interface Answer {
  ok: boolean;
  error?: string;
  summary?: string;
  left?: number;
  lore?: string;
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
    extras?: string[];
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
  token(GOBLIN, 'Goblin', 2, { position: { x: 2, y: 2 }, hp: { current: 20, max: 20, temp: 0 }, statBlock: ogreBlock }),
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
      data: { email: `ranger-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `ranger-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `Ranger ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
const fight = (turn: Record<string, unknown> = {}, more: Record<string, unknown> = {}) =>
  setState(campaignId, {
    active: true,
    round: 1,
    ...more,
    currentTokenId: HERO,
    combatants: [
      entry(HERO, 'Hero', 18),
      entry(ALLY, 'Ally', 12),
      entry(OGRE, 'Ogre', 9),
      entry(GOBLIN, 'Goblin', 7),
      entry(FAR, 'Far Ogre', 5),
    ],
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0, ...turn },
  });
const asRanger = (level: number, features: string[] = [], more: Record<string, unknown> = {}) => {
  const sheet = heroSheet(features);
  return prisma.character.update({
    where: { id: heroCharacterId },
    data: {
      data: toJson({
        ...sheet,
        class: 'Ranger',
        subclass: 'Hunter',
        level,
        spellcasting: {
          ...sheet.spellcasting,
          spells: [{ name: "Hunter's Mark", level: 1, prepared: true, ritual: false, concentration: true }],
          slots: { '1': { total: 2, expended: 0 } },
        },
        ...more,
      }),
    },
  });
};
const longsword = async () => (await ask(player, 'combat.actions', { tokenId: HERO })).actions!.find((action) => action.name === 'Longsword')!.index;
const swing = (targetId: string, action: number, more: Record<string, unknown> = {}) =>
  ask(player, 'combat.attack', { attackerId: HERO, targetId, action, ...more });
const mark = (targetId: string) => ask(player, 'combat.concentrate', { tokenId: HERO, spell: "Hunter's Mark", targetId });
const answerWith = (pick: (options: string[]) => string | null) =>
  player.once('combat.prompt', (offer: { promptId: string; options: string[] }) => {
    player.emit('combat.react', { promptId: offer.promptId, choice: pick(offer.options) }, () => undefined);
  });
const heroData = async () => (await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data as Record<string, unknown>;
const tokenOf = async (id: string) =>
  ((await prisma.map.findUnique({ where: { id: mapId } }))!.tokens as unknown as Array<{ id: string; hp?: { current: number }; conditions?: string[] }>).find(
    (entry) => entry.id === id
  )!;

describe('Hunter’s Prey', () => {
  it('Colossus Slayer adds 1d8 once per turn to a weapon hit on a creature missing Hit Points', async () => {
    fight();
    await asRanger(3, ['Extra Attack', 'Hunter’s Prey: Colossus Slayer']);
    const sword = await longsword();
    // The Ogre is whole: 1d8 + 3 and nothing more.
    rolls = [15, 4];
    const first = await swing(OGRE, sword);
    expect(first.dealt).toBe(7);
    expect(first.summary).not.toContain('Colossus Slayer');
    // Now it is hurt: 7 and 1d8 = 5.
    rolls = [15, 4, 5];
    const second = await swing(OGRE, sword);
    expect(second.dealt).toBe(12);
    expect(second.summary).toContain('Colossus Slayer');
    // Once per turn.
    fight();
    rolls = [15, 4, 5];
    expect((await swing(OGRE, sword)).dealt).toBe(7);
    // A new turn gives it back.
    fight({}, { round: 2 });
    rolls = [15, 4, 5];
    expect((await swing(OGRE, sword)).dealt).toBe(12);
  });

  it('Horde Breaker makes another attack with the same weapon on a creature beside the first, once on each turn', async () => {
    fight();
    await asRanger(3, ['Horde Breaker']);
    // The menu offers it under a weapon once that weapon has made an attack this turn, until it is used.
    const hordeOffer = async () =>
      (await ask(player, 'combat.actions', { tokenId: HERO })).actions!.find((action) => action.name === 'Longsword')!.extras;
    expect(await hordeOffer()).toBeUndefined();
    const sword = await longsword();
    expect((await swing(GOBLIN, sword, { extra: 'horde' })).error).toBe(
      'Horde Breaker follows an attack with the same weapon on a creature within 5 feet of Goblin'
    );
    rolls = [15, 4];
    expect((await swing(OGRE, sword)).dealt).toBe(7);
    expect(await hordeOffer()).toEqual(['horde']);
    expect((await swing(OGRE, sword, { extra: 'horde' })).error).toBe('Hero has attacked Ogre this turn');
    rolls = [15, 6];
    const again = await swing(GOBLIN, sword, { extra: 'horde' });
    expect(again.dealt).toBe(9);
    expect(again.summary).toContain('Horde Breaker');
    expect(getState(campaignId).turn?.attacks).toBe(1);
    expect(await hordeOffer()).toBeUndefined();
    expect((await swing(FAR, sword, { extra: 'horde' })).error).toBe('Hero has used Horde Breaker this turn');
  });

  it('refuses Horde Breaker to a sheet that does not name it', async () => {
    fight();
    await asRanger(3, ['Hunter’s Prey']);
    expect((await swing(GOBLIN, await longsword(), { extra: 'horde' })).error).toBe('Hero has no Horde Breaker');
  });
});

describe('Hunter’s Mark at higher levels', () => {
  it('Precise Hunter gives Advantage against the marked creature, and Foe Slayer a d10', async () => {
    fight();
    await asRanger(20);
    await mark(OGRE);
    // A Hunter of this level is asked about Superior Hunter's Prey: declined here.
    answerWith(() => null);
    // Two d20s; 1d8 + 3 = 7; the mark's die is left to the mock: half a d10, 5.
    rolls = [15, 12, 4];
    const hit = await swing(OGRE, await longsword());
    expect(hit.reasons).toContain('Advantage: Precise Hunter');
    expect(hit.dealt).toBe(12);
    // Against another creature there is neither.
    fight();
    rolls = [15, 4];
    const other = await swing(GOBLIN, await longsword());
    expect(other.reasons).not.toContain('Advantage: Precise Hunter');
  });

  it('Relentless Hunter keeps the concentration through damage', async () => {
    fight();
    await asRanger(13);
    await mark(OGRE);
    rolls = [15, 4, 4];
    const hit = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0 });
    expect(hit.summary).toContain('Hero keeps concentration on Hunter’s Mark (Relentless Hunter)');
    expect(getState(campaignId).marks.some((entry) => entry.kind === 'concentration' && entry.attackerId === HERO)).toBe(true);
  });

  it('Hunter’s Lore tells the Hunter what the marked creature resists', async () => {
    fight();
    await asRanger(3);
    const marked = await mark(OGRE);
    expect(marked.lore).toBe("Hunter's Lore: Ogre has no Immunities, Resistances or Vulnerabilities");
    expect(marked.summary).toBe(`Hero concentrates on Hunter’s Mark, marking Ogre. ${marked.lore}`);
  });

  it('Superior Hunter’s Prey deals the mark’s damage to a second creature the player picks, once per turn', async () => {
    fight();
    await asRanger(11, ['Extra Attack']);
    await mark(OGRE);
    let offered: string[] = [];
    answerWith((options) => {
      offered = options;
      return "Superior Hunter's Prey: Goblin";
    });
    // 15 + 5 hits; 1d8 + 3 = 7, the mark 3; the Goblin takes the mark's die again, 2.
    rolls = [15, 4, 3, 2];
    const hit = await swing(OGRE, await longsword());
    expect(offered).toEqual(["Superior Hunter's Prey: Goblin", "Superior Hunter's Prey: Far Ogre"]);
    expect(hit.dealt).toBe(10);
    expect(hit.summary).toContain("Superior Hunter's Prey: Goblin takes 2 Force damage");
    expect((await tokenOf(GOBLIN)).hp!.current).toBe(18);
    // A second hit this turn asks nothing.
    let asked = false;
    player.once('combat.prompt', () => {
      asked = true;
    });
    rolls = [15, 4, 3];
    expect((await swing(OGRE, await longsword())).dealt).toBe(10);
    expect(asked).toBe(false);
    player.removeAllListeners('combat.prompt');
  });
});

describe('Defensive Tactics', () => {
  it('Multiattack Defense gives a creature that hit the Hunter Disadvantage on its other attacks this turn', async () => {
    fight();
    await asRanger(7, ['Defensive Tactics: Multiattack Defense']);
    rolls = [15, 4, 4];
    const first = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0 });
    expect(first.hit).toBe(true);
    expect(first.reasons).not.toContain('Disadvantage: Multiattack Defense');
    rolls = [15, 14, 4, 4];
    const second = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0 });
    expect(second.reasons).toContain('Disadvantage: Multiattack Defense');
    // Another creature's attacks are not touched.
    rolls = [15, 4, 4];
    const other = await ask(dm, 'combat.attack', { attackerId: GOBLIN, targetId: HERO, action: 0 });
    expect(other.reasons).not.toContain('Disadvantage: Multiattack Defense');
  });

  it('Escape the Horde gives Opportunity Attacks against the Hunter Disadvantage', async () => {
    await asRanger(7, ['Escape the Horde']);
    fight({}, { opportunities: [{ attackerId: OGRE, targetId: HERO, from: { x: 1, y: 1 } }] });
    rolls = [15, 14, 4, 4];
    const hit = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0, opportunity: true });
    expect(hit.reasons).toContain('Disadvantage: Escape the Horde');
  });
});

describe('Tireless and Nature’s Veil', () => {
  it('Tireless gives 1d8 + Wisdom Temporary Hit Points with the Magic action, as many times as the Wisdom modifier', async () => {
    fight();
    await asRanger(10);
    rolls = [6];
    const used = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Tireless' });
    expect(used.summary).toBe('Hero uses Tireless: 7 Temporary Hit Points (1d8+1: 6) (0 uses left)');
    expect(((await heroData()).hp as { temporary: number }).temporary).toBe(7);
    expect(getState(campaignId).turn?.action).toBe('Magic');
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Tireless' })).error).toBe('Hero: No uses of Tireless left until a rest');
  });

  it('refuses Tireless to a Ranger below level 10', async () => {
    fight();
    await asRanger(9);
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Tireless' })).error).toBe('Hero: The sheet has no Tireless');
  });

  it('a Short Rest takes a level of Exhaustion off a Ranger with Tireless', async () => {
    await asRanger(10, [], { exhaustionLevel: 2 });
    const rested = await ask(player, 'combat.rest', { characterId: heroCharacterId, kind: 'shortFinish' });
    expect(rested.summary).toContain('one level of Exhaustion off (Tireless)');
    expect((await heroData()).exhaustionLevel).toBe(1);
  });

  it('Nature’s Veil makes the Ranger Invisible until the end of its next turn, with a Bonus Action', async () => {
    fight();
    await asRanger(14);
    const used = await ask(player, 'combat.feature', { tokenId: HERO, feature: "Nature's Veil" });
    expect(used.summary).toBe("Hero uses Nature's Veil: Invisible until the end of its next turn (0 uses left)");
    expect((await tokenOf(HERO)).conditions).toContain('Invisible');
    expect(getState(campaignId).turn?.bonusAction).toBe(true);
    expect(getState(campaignId).marks).toContainEqual(
      expect.objectContaining({ kind: 'condition', attackerId: HERO, targetId: HERO, condition: 'Invisible', ends: 'end', turnEndsLeft: 2 })
    );
    fight({ bonusAction: true });
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: "Nature's Veil" })).error).toBe('Hero has used its Bonus Action this turn');
  });
});

describe('Superior Hunter’s Defense', () => {
  it('resists the damage type of a hit when the player takes the Reaction, until the turn ends', async () => {
    fight();
    await asRanger(15);
    answerWith((options) => {
      expect(options).toEqual(["Superior Hunter's Defense (bludgeoning)"]);
      return options[0];
    });
    // 2d8 + 4 = 12 Bludgeoning, halved.
    rolls = [15, 4, 4];
    const first = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0 });
    expect(first.dealt).toBe(6);
    expect(first.summary).toContain("Resistance to bludgeoning damage from Superior Hunter's Defense");
    expect(getState(campaignId).reactionsSpent).toContain(HERO);
    // The next Bludgeoning hit this turn is resisted too, with no question; Piercing is not.
    rolls = [15, 4, 4];
    expect((await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0 })).dealt).toBe(6);
    rolls = [15, 3, 3];
    expect((await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 1 })).dealt).toBe(10);
    // The turn over, so is the Resistance.
    fight({}, { round: 2, reactionsSpent: [HERO] });
    rolls = [15, 4, 4];
    expect((await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0 })).dealt).toBe(12);
  });

  it('is asked after the damage of a failed save too', async () => {
    fight();
    await asRanger(15);
    answerWith((options) => options[0]);
    // 2d8 = 8 Thunder; the save fails on a 2; resisted, 4.
    rolls = [4, 4, 2];
    const stomp = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [HERO], action: 3 });
    expect(stomp.targets![0].dealt).toBe(4);
    expect(stomp.summary).toContain("Hero resists thunder damage until the turn ends (Superior Hunter's Defense)");
    expect(getState(campaignId).reactionsSpent).toContain(HERO);
  });

  it('leaves the hit as it is when the player declines', async () => {
    fight();
    await asRanger(15);
    answerWith(() => null);
    rolls = [15, 4, 4];
    expect((await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: 0 })).dealt).toBe(12);
    expect(getState(campaignId).reactionsSpent).not.toContain(HERO);
  });
});
