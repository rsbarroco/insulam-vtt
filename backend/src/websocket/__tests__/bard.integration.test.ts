/**
 * The Bard past Bardic Inspiration, over the socket: Cutting Words asked of a
 * Lore Bard once an enemy's hit or successful check is known, Peerless Skill
 * after its own miss or failed check, Countercharm after a failed save against
 * a frightening effect, Font of Inspiration and Superior Inspiration.
 *
 * The fixtures are those of bardicInspiration.integration.test.ts.
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
    {
      name: 'Dread Roar',
      description:
        'Wisdom Saving Throw: DC 13, each creature within 30 feet. Failure: The target has the Frightened condition until the end of its next turn.',
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
const heroSheet = (features: string[] = ['Cutting Words', 'Peerless Skill'], level = 14, used = 0) => ({
  class: 'Bard',
  level,
  featureUses: used > 0 ? { 'Bardic Inspiration': used } : {},
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
  stats: { strength: { score: 16, modifier: 3 }, wisdom: { score: 12, modifier: 1 }, charisma: { score: 16, modifier: 3 } },
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
      data: { email: `lorebard-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `lorebard-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `LoreBard ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
const fight = (currentTokenId: string = OGRE) =>
  setState(campaignId, {
    active: true,
    round: 1,
    currentTokenId,
    combatants: [
      entry(HERO, 'Hero', 18),
      entry(ALLY, 'Ally', 12),
      entry(OGRE, 'Ogre', 9),
      entry(FAR, 'Far Ogre', 5),
    ],
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0 },
  });
const actionIndex = async (socket: ClientSocket, tokenId: string, name: string) => {
  const listed = (await ask(socket, 'combat.actions', { tokenId })) as unknown as {
    actions: Array<{ index: number; name: string }>;
  };
  return listed.actions.find((action) => action.name === name)!.index;
};
/** Answer the next question the player is asked with `choice`; what was asked comes back. */
const answerWith = (choice: string | null) => {
  const asked: Array<{ promptId: string; text: string; options: string[] }> = [];
  player.once('combat.prompt', (offer: { promptId: string; text: string; options: string[] }) => {
    asked.push(offer);
    player.emit('combat.react', { promptId: offer.promptId, choice }, () => undefined);
  });
  return asked;
};
/** Answer the questions the player is asked, in order, with `choices`; what was asked comes back. */
const answerAll = (choices: Array<string | null>) => {
  const asked: Array<{ promptId: string; text: string; options: string[] }> = [];
  player.on('combat.prompt', (offer: { promptId: string; text: string; options: string[] }) => {
    const choice = choices[asked.length] ?? null;
    asked.push(offer);
    player.emit('combat.react', { promptId: offer.promptId, choice }, () => undefined);
  });
  return asked;
};
const sheetNow = async () => (await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data as {
  featureUses?: Record<string, number>;
  spellcasting: { slots: Record<string, { expended: number }> };
};
const usesSpent = async () => (await sheetNow()).featureUses?.['Bardic Inspiration'] ?? 0;
const setSheet = (sheet: ReturnType<typeof heroSheet>) =>
  prisma.character.update({ where: { id: heroCharacterId }, data: { data: toJson(sheet) } });
const greatclub = async () => ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: await actionIndex(dm, OGRE, 'Greatclub') });

describe('Cutting Words', () => {
  it('asks the Lore Bard after an enemy hit, before the damage is shown, and the die can turn it into a miss', async () => {
    fight();
    const asked = answerWith('Cutting Words (attack roll)');
    // 10 + 6 = 16 hits AC 16; 3 + 4 + 4 bludgeoning; the d10 takes 2 off: 14 misses.
    rolls = [10, 3, 4, 2];
    const answer = await greatclub();
    expect(asked).toHaveLength(1);
    expect(asked[0].options).toEqual(['Cutting Words (attack roll)']);
    expect(asked[0].text).toContain('Ogre hits Hero with Greatclub (16 against AC 16).');
    expect(asked[0].text).not.toContain('damage');
    expect(answer).toMatchObject({ ok: true, hit: false, dealt: 0 });
    expect(answer.summary).toContain("Hero's Cutting Words -2");
    expect(await usesSpent()).toBe(1);
    expect(getState(campaignId).reactionsSpent).toContain(HERO);
  });

  it('leaves a hit a hit when the die is too low, still spends the use, and asks nothing more', async () => {
    fight();
    const asked = answerAll(['Cutting Words (attack roll)', 'Cutting Words (damage)']);
    rolls = [15, 3, 4, 2];
    const answer = await greatclub();
    expect(asked).toHaveLength(1);
    expect(answer).toMatchObject({ ok: true, hit: true, dealt: 11 });
    expect(answer.summary).toContain("Hero's Cutting Words -2 (still a hit)");
    expect(await usesSpent()).toBe(1);
  });

  it('asks a second time with the damage when the attack roll was left alone, and takes the die off the damage roll', async () => {
    fight();
    const asked = answerAll([null, 'Cutting Words (damage)']);
    rolls = [10, 3, 4, 5];
    const answer = await greatclub();
    expect(asked.map((offer) => offer.options)).toEqual([['Cutting Words (attack roll)'], ['Cutting Words (damage)']]);
    expect(asked[1].text).toContain('Ogre hits Hero with Greatclub for 11 damage.');
    expect(answer).toMatchObject({ ok: true, hit: true, dealt: 6 });
    expect(answer.summary).toContain("Hero's Cutting Words -5 damage");
    expect(await usesSpent()).toBe(1);
    expect(getState(campaignId).reactionsSpent).toContain(HERO);
  });

  it('spends nothing when it is declined, and is not asked without a use or the reaction', async () => {
    fight();
    const asked = answerAll([null, null]);
    rolls = [10, 3, 4];
    expect(await greatclub()).toMatchObject({ ok: true, hit: true, dealt: 11 });
    expect(asked).toHaveLength(2);
    player.removeAllListeners('combat.prompt');
    expect(await usesSpent()).toBe(0);
    expect(getState(campaignId).reactionsSpent).not.toContain(HERO);

    // No use left: the attack resolves without a question.
    await setSheet(heroSheet(undefined, 14, 3));
    fight();
    const none = answerWith('Cutting Words (damage)');
    rolls = [10, 3, 4];
    expect(await greatclub()).toMatchObject({ ok: true, hit: true, dealt: 11 });
    expect(none).toHaveLength(0);
    player.removeAllListeners('combat.prompt');

    // The reaction spent: no question either.
    await setSheet(heroSheet());
    fight();
    setState(campaignId, { ...getState(campaignId), reactionsSpent: [HERO] });
    const spent = answerWith('Cutting Words (damage)');
    rolls = [10, 3, 4];
    expect(await greatclub()).toMatchObject({ ok: true, hit: true, dealt: 11 });
    expect(spent).toHaveLength(0);
    player.removeAllListeners('combat.prompt');
  });

  it('is asked about the damage alone on a natural 20', async () => {
    fight();
    const asked = answerAll(['Cutting Words (damage)']);
    // A Critical Hit: 3 + 4 + 5 + 6 + 4 = 22; the d10 takes 7 off.
    rolls = [20, 3, 4, 5, 6, 7];
    const answer = await greatclub();
    expect(asked.map((offer) => offer.options)).toEqual([['Cutting Words (damage)']]);
    expect(answer).toMatchObject({ ok: true, hit: true, critical: true, dealt: 15 });
  });

  it('is not asked for a hit by a creature of the Bard\'s own side', async () => {
    fight(ALLY);
    const asked = answerWith('Cutting Words (damage)');
    rolls = [10, 3, 4];
    const answer = await ask(dm, 'combat.attack', { attackerId: ALLY, targetId: OGRE, action: await actionIndex(dm, ALLY, 'Greatclub') });
    expect(answer).toMatchObject({ ok: true, hit: true, dealt: 11 });
    expect(asked).toHaveLength(0);
    player.removeAllListeners('combat.prompt');
  });

  it('is asked after an enemy succeeds on a check, and can turn it into a failure', async () => {
    fight();
    const asked = answerWith('Cutting Words');
    // 10 + 4 = 14 against DC 12; the d10 takes 3 off: 11 fails.
    rolls = [10, 3];
    const answer = await ask(dm, 'combat.check', { tokenId: OGRE, ability: 'str', dc: 12 });
    expect(asked[0]?.options).toEqual(['Cutting Words']);
    expect(answer).toMatchObject({ ok: true, total: 11, success: false });
    expect(answer.summary).toContain("Hero's Cutting Words -3: 11, failure");
    expect(await usesSpent()).toBe(1);
    expect(getState(campaignId).reactionsSpent).toContain(HERO);
  });
});

describe('Peerless Skill', () => {
  it('adds the die to a missed attack roll, and keeps the use when it still misses', async () => {
    fight(HERO);
    const asked = answerWith('Peerless Skill');
    // 4 + 5 = 9 misses AC 11; the d10 adds 1: 10 still misses.
    rolls = [4, 1];
    const missed = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await actionIndex(player, HERO, 'Longsword') });
    expect(asked[0]?.options).toEqual(['Peerless Skill']);
    expect(missed).toMatchObject({ ok: true, hit: false });
    expect(await usesSpent()).toBe(0);

    fight(HERO);
    answerWith('Peerless Skill');
    // The d10 adds 4: 13 hits; 5 + 3 slashing.
    rolls = [4, 4, 5];
    const hit = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await actionIndex(player, HERO, 'Longsword') });
    expect(hit).toMatchObject({ ok: true, hit: true, dealt: 8 });
    expect(hit.summary).toContain('Peerless Skill +4');
    expect(await usesSpent()).toBe(1);
  });

  it('adds the die to a failed check, spending the use on a success only', async () => {
    fight(HERO);
    answerWith('Peerless Skill');
    // 3 + 6 = 9 against DC 15; the d10 adds 2: 11 still fails.
    rolls = [3, 2];
    const failed = await ask(player, 'combat.check', { tokenId: HERO, skill: 'stealth', dc: 15 });
    expect(failed).toMatchObject({ ok: true, total: 11, success: false });
    expect(failed.summary).toContain('Peerless Skill +2: 11, still a failure, the use is kept');
    expect(await usesSpent()).toBe(0);

    answerWith('Peerless Skill');
    rolls = [3, 7];
    const passed = await ask(player, 'combat.check', { tokenId: HERO, skill: 'stealth', dc: 15 });
    expect(passed).toMatchObject({ ok: true, total: 16, success: true });
    expect(await usesSpent()).toBe(1);
  });
});

describe('Countercharm', () => {
  it('asks the Bard after a creature within 30 feet fails a save against a frightening effect, and rolls it again with Advantage', async () => {
    fight();
    const asked = answerWith('Countercharm');
    // 5 - 2 = 3 fails DC 13; rolled again with Advantage: 16 and 8, 16 - 2 = 14 saves.
    rolls = [5, 16, 8];
    const answer = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [ALLY], action: await actionIndex(dm, OGRE, 'Dread Roar') });
    expect(asked[0]?.options).toEqual(['Countercharm']);
    expect(asked[0]?.text).toContain('Ally fails the');
    expect(answer.targets?.[0]).toMatchObject({ saved: true, total: 14 });
    expect(answer.summary).toContain("Ally fails (3), Hero's Countercharm: saves (14)");
    expect(getState(campaignId).reactionsSpent).toContain(HERO);
    expect(await usesSpent()).toBe(0);
  });

  it('is not asked for a save against an effect that neither charms nor frightens', async () => {
    fight();
    const asked = answerWith('Countercharm');
    rolls = [4, 6, 2];
    const answer = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [ALLY], action: await actionIndex(dm, OGRE, 'Stomp') });
    expect(answer.targets?.[0]).toMatchObject({ saved: false });
    expect(asked).toHaveLength(0);
    player.removeAllListeners('combat.prompt');
  });
});

describe('Font of Inspiration', () => {
  const font = (slotLevel?: number) => ask(player, 'combat.feature', { tokenId: HERO, feature: 'Font of Inspiration', ...(slotLevel ? { slotLevel } : {}) });

  it('expends a spell slot to regain one expended use of Bardic Inspiration', async () => {
    expect((await font(3)).error).toBe('Hero: No expended use of Bardic Inspiration to regain');
    await setSheet(heroSheet(undefined, 14, 2));
    expect((await font()).error).toBe('Font of Inspiration needs the level of the spell slot to expend');
    expect((await font(1)).error).toBe('No level 1 spell slot left');
    const listed = (await ask(player, 'combat.actions', { tokenId: HERO })) as unknown as { fontOfInspiration: number[] };
    expect(listed.fontOfInspiration).toEqual([3, 4]);
    const answer = await font(3);
    expect(answer).toMatchObject({ ok: true, left: 2 });
    expect(answer.summary).toBe('Hero expends a level 3 spell slot with Font of Inspiration: one use of Bardic Inspiration regained (2 uses left)');
    const sheet = await sheetNow();
    expect(sheet.featureUses?.['Bardic Inspiration']).toBe(1);
    expect(sheet.spellcasting.slots['3'].expended).toBe(1);
  });

  it('is a Bard feature of level 5', async () => {
    await setSheet(heroSheet(undefined, 4, 2));
    expect((await font(3)).error).toBe('Hero: Font of Inspiration is a Bard feature of level 5');
  });
});

describe('Superior Inspiration', () => {
  it('brings a Bard of level 18 back to two uses when it rolls Initiative', async () => {
    await setSheet(heroSheet(undefined, 18, 3));
    setState(campaignId, { ...getState(campaignId), active: false, combatants: [entry(HERO, 'Hero', 0)] });
    const rolled = new Promise((resolve) => dm.once('character.updated', resolve));
    dm.emit('initiative.roll', { tokenId: HERO, mapId });
    await rolled;
    expect(await usesSpent()).toBe(1);
  });
});
