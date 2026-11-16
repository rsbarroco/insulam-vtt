/**
 * Barbarian features and the Path of the Berserker over the socket: Relentless
 * Rage, Frenzy, Mindless Rage, Retaliation, Intimidating Presence, Persistent
 * Rage, a Rage extended with a Bonus Action, Indomitable Might and Primal
 * Knowledge.
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
import { clearPrompts } from '../reactionPrompts';
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
      name: 'Roar',
      description: 'Wisdom Saving Throw: DC 13, each creature within 30 feet. Failure: The target has the Frightened condition.',
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
  stats: { strength: { score: 16, modifier: 3 }, dexterity: { score: 14, modifier: 2 }, wisdom: { score: 12, modifier: 1 } },
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
      data: { email: `barbfeat-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `barbfeat-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `BarbFeat ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
  clearPrompts();
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
const fight = (turn: Record<string, unknown> = {}, currentTokenId: string = HERO) =>
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
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0, ...turn },
  });
type Sheet = Record<string, unknown>;
const actionIndex = async (socket: ClientSocket, tokenId: string, name: string) => {
  const listed = await ask(socket, 'combat.actions', { tokenId });
  return listed.actions!.find((action) => action.name === name)?.index ?? -1;
};
const asBarbarian = (level: number, features: string[], extra: Sheet = {}) =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: { data: toJson({ ...heroSheet(['Reckless Attack', 'Extra Attack', ...features]), class: 'Barbarian', level, ...extra }) },
  });
const sheetNow = async () =>
  (await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data as {
    hp: { current: number };
    featureUses?: Record<string, number>;
  };
const patchSheet = async (patch: Sheet) =>
  prisma.character.update({ where: { id: heroCharacterId }, data: { data: toJson({ ...(await sheetNow()), ...patch }) } });
const tokenNow = async (id: string) =>
  ((await prisma.map.findUnique({ where: { id: mapId } }))!.tokens as Array<{ id: string; conditions?: string[] }>).find((t) => t.id === id)!;
/** Answer the next question the player is asked with `choice`; what was asked comes back. */
const answerWith = (choice: string | null) => {
  const asked: Array<{ promptId: string; text: string; options: string[] }> = [];
  player.once('combat.prompt', (offer: { promptId: string; text: string; options: string[] }) => {
    asked.push(offer);
    player.emit('combat.react', { promptId: offer.promptId, choice }, () => undefined);
  });
  return asked;
};
const rage = () => ask(player, 'combat.feature', { tokenId: HERO, feature: 'Rage' });
/** The Hero's turn again with nothing spent, keeping the marks of the fight. */
const freshTurn = () =>
  setState(campaignId, { ...getState(campaignId), turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0 } });
const until = async (check: () => boolean) => {
  for (let tries = 0; tries < 100 && !check(); tries++) await new Promise((resolve) => setTimeout(resolve, 20));
};

describe('Frenzy', () => {
  it('adds as many d6s as the Rage Damage to the first Strength hit of a reckless turn while raging', async () => {
    fight();
    await asBarbarian(9, ['Frenzy']);
    expect((await rage()).ok).toBe(true);
    const index = await actionIndex(player, HERO, 'Longsword');
    // Two d20s for the Advantage; 4 + 3 slashing, +3 Rage Damage, and 2 + 3 + 4 for the three d6s.
    rolls = [15, 10, 4, 2, 3, 4];
    const hit = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: index, reckless: true });
    expect(hit.ok).toBe(true);
    expect(hit.dealt).toBe(19);
    expect(hit.summary).toContain('Frenzy (3d6)');

    rolls = [15, 10, 4];
    const again = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: index });
    expect(again.dealt).toBe(10);
    expect(again.summary).not.toContain('Frenzy');
  });

  it('adds nothing without Reckless Attack, or out of a Rage', async () => {
    fight();
    await asBarbarian(9, ['Frenzy']);
    const index = await actionIndex(player, HERO, 'Longsword');
    rolls = [15, 10, 4];
    const calm = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: index, reckless: true });
    expect(calm.dealt).toBe(7);
    fight();
    await rage();
    rolls = [15, 4];
    const careful = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: index });
    expect(careful.dealt).toBe(10);
    expect(careful.summary).not.toContain('Frenzy');
  });
});

describe('Relentless Rage', () => {
  it('is asked when a raging Barbarian drops to 0, and a saved DC 10 leaves twice its level; the DC then rises by 5', async () => {
    fight();
    await asBarbarian(11, ['Relentless Rage']);
    await rage();
    await patchSheet({ hp: { current: 5, maximum: 30, temporary: 0 } });
    const club = await actionIndex(dm, OGRE, 'Greatclub');
    const asked = answerWith('Relentless Rage');
    // 15 + 6 hits AC 16; 8 + 8 + 4 = 20 bludgeoning, halved by the Rage; then the save: 12 + 2 = 14.
    rolls = [15, 8, 8, 12];
    const hit = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: club });
    expect(hit.ok).toBe(true);
    expect(asked).toEqual([expect.objectContaining({ options: ['Relentless Rage'], text: expect.stringContaining('DC 10 Constitution save') })]);
    expect(hit.summary).toContain("Hero's Relentless Rage: Constitution 14 vs DC 10, success, 22 Hit Points");
    expect((await sheetNow()).hp.current).toBe(22);
    expect((await sheetNow()).featureUses?.['Relentless Rage']).toBe(1);

    await patchSheet({ hp: { current: 5, maximum: 30, temporary: 0 } });
    const second = answerWith('Relentless Rage');
    rolls = [15, 8, 8, 12];
    const again = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: club });
    expect(second[0].text).toContain('DC 15 Constitution save');
    expect(again.summary).toContain("Hero's Relentless Rage: Constitution 14 vs DC 15, failure");
    expect((await sheetNow()).hp.current).toBe(0);
    expect((await sheetNow()).featureUses?.['Relentless Rage']).toBe(2);
  });

  it('counts no use when declined, and is not asked out of a Rage', async () => {
    fight();
    await asBarbarian(11, ['Relentless Rage'], { hp: { current: 5, maximum: 30, temporary: 0 } });
    const club = await actionIndex(dm, OGRE, 'Greatclub');
    const calm = answerWith('Relentless Rage');
    rolls = [15, 8, 8];
    await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: club });
    expect(calm).toEqual([]);
    expect((await sheetNow()).hp.current).toBe(0);
    player.removeAllListeners('combat.prompt');

    await patchSheet({ hp: { current: 5, maximum: 30, temporary: 0 } });
    await rage();
    const asked = answerWith(null);
    rolls = [15, 8, 8];
    const hit = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: club });
    expect(asked).toHaveLength(1);
    expect(hit.summary).not.toContain('Relentless Rage');
    expect((await sheetNow()).hp.current).toBe(0);
    expect((await sheetNow()).featureUses?.['Relentless Rage']).toBeUndefined();
  });
});

describe('Mindless Rage', () => {
  it('ends the Frightened condition on entering a Rage, and keeps it off while raging', async () => {
    await prisma.map.update({
      where: { id: mapId },
      data: { tokens: toJson(freshTokens().map((t) => (t.id === HERO ? { ...t, conditions: ['Frightened'] } : t))) },
    });
    fight();
    await asBarbarian(6, ['Mindless Rage']);
    const entered = await rage();
    expect(entered.summary).toContain('no longer Frightened (Mindless Rage)');
    expect((await tokenNow(HERO)).conditions).toEqual([]);

    // The Ogre's Roar: 3 + 1 = 4 fails DC 13, and the condition does not take hold.
    rolls = [3];
    const roar = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [HERO], action: await actionIndex(dm, OGRE, 'Roar') });
    expect(roar.targets?.[0].saved).toBe(false);
    expect(roar.summary).toContain('Hero is immune to the Frightened condition (Mindless Rage)');
    expect((await tokenNow(HERO)).conditions).toEqual([]);
  });
});

describe('Retaliation', () => {
  it('asks a Berserker damaged from within 5 feet, and offers one melee attack with its reaction', async () => {
    fight({}, OGRE);
    await asBarbarian(10, ['Retaliation']);
    const club = await actionIndex(dm, OGRE, 'Greatclub');
    const asked = answerWith('Retaliation');
    rolls = [15, 2, 2];
    const hit = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: club });
    expect(hit.dealt).toBe(8);
    await until(() => getState(campaignId).opportunities.length > 0);
    expect(asked).toEqual([expect.objectContaining({ options: ['Retaliation'], text: 'Ogre deals 8 damage to Hero from within 5 feet.' })]);
    expect(getState(campaignId).opportunities).toEqual([expect.objectContaining({ attackerId: HERO, targetId: OGRE, reason: 'Retaliation' })]);

    rolls = [15, 4];
    const back = await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await actionIndex(player, HERO, 'Longsword'), opportunity: true });
    expect(back.ok).toBe(true);
    expect(back.dealt).toBe(7);
    expect(back.summary).toContain('Retaliation');
    expect(getState(campaignId).reactionsSpent).toContain(HERO);
    expect(getState(campaignId).opportunities).toEqual([]);
  });

  it('offers nothing when declined, or against a creature farther than 5 feet', async () => {
    fight({}, OGRE);
    await asBarbarian(10, ['Retaliation']);
    const asked = answerWith(null);
    rolls = [15, 2, 2];
    await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: await actionIndex(dm, OGRE, 'Greatclub') });
    await until(() => asked.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getState(campaignId).opportunities).toEqual([]);

    const far = answerWith('Retaliation');
    rolls = [15, 2, 2];
    const javelin = await ask(dm, 'combat.attack', { attackerId: FAR, targetId: HERO, action: await actionIndex(dm, FAR, 'Javelin') });
    expect(javelin.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(far).toEqual([]);
  });
});

describe('Intimidating Presence', () => {
  it('is a Bonus Action: a Wisdom save or Frightened, once, then for a use of Rage', async () => {
    fight();
    await asBarbarian(14, ['Intimidating Presence'], { proficiencyBonus: 5 });
    const listed = await ask(player, 'combat.actions', { tokenId: HERO });
    const presence = listed.actions!.find((action) => action.name === 'Intimidating Presence')!;
    expect(presence.cost).toBe('bonusAction');
    // DC 8 + 3 + 5 = 16. The Ogre rolls 10 - 2 = 8 and fails; the Ally rolls 20 - 2 = 18 and saves.
    rolls = [10, 20];
    const answer = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE, ALLY], action: presence.index });
    expect(answer.ok).toBe(true);
    expect(answer.targets).toEqual([expect.objectContaining({ saved: false }), expect.objectContaining({ saved: true })]);
    expect(answer.summary).toContain('Ogre has the Frightened condition');
    expect((await tokenNow(OGRE)).conditions).toEqual(['Frightened']);
    expect((await tokenNow(ALLY)).conditions).toEqual([]);
    expect(getState(campaignId).marks).toContainEqual(
      expect.objectContaining({ kind: 'condition', targetId: OGRE, condition: 'Frightened', ends: 'save', save: { ability: 'wis', dc: 16 } })
    );
    expect(getState(campaignId).turn).toMatchObject({ bonusAction: true, action: null });
    expect((await sheetNow()).featureUses?.['Intimidating Presence']).toBe(1);

    const spent = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [OGRE], action: presence.index });
    expect(spent.error).toBe('Hero has used its Bonus Action this turn');

    freshTurn();
    const again = await ask(player, 'combat.actions', { tokenId: HERO });
    const fuelled = again.actions!.find((action) => action.name === 'Intimidating Presence (a use of Rage)')!;
    expect(again.actions!.some((action) => action.name === 'Intimidating Presence')).toBe(false);
    rolls = [20];
    const second = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [ALLY], action: fuelled.index });
    expect(second.ok).toBe(true);
    expect((await sheetNow()).featureUses?.Rage).toBe(1);
  });

  it('reaches 30 feet and no farther', async () => {
    fight();
    await asBarbarian(14, ['Intimidating Presence']);
    const far = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [FAR], action: await actionIndex(player, HERO, 'Intimidating Presence') });
    expect(far.ok).toBe(false);
  });
});

describe('Persistent Rage and extending a Rage', () => {
  it('extends a Rage with a Bonus Action on the Barbarian’s own turn', async () => {
    fight();
    await asBarbarian(5, []);
    const calm = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Extend Rage' });
    expect(calm.error).toBe('Hero is not raging');
    await rage();
    const spent = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Extend Rage' });
    expect(spent.error).toBe('Hero has used its Bonus Action this turn');
    // A turn later the Rage has one turn end left; the Bonus Action gives it two.
    setState(campaignId, {
      ...getState(campaignId),
      marks: getState(campaignId).marks.map((mark) => ({ ...mark, turnEndsLeft: 1 })),
      turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0 },
    });
    const extended = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Extend Rage' });
    expect(extended.summary).toBe('Hero extends its Rage to the end of its next turn');
    expect(getState(campaignId).marks).toContainEqual(expect.objectContaining({ kind: 'rage', turnEndsLeft: 2 }));
    expect(getState(campaignId).turn?.bonusAction).toBe(true);
  });

  it('lasts 10 minutes with Persistent Rage, which gives every use of Rage back once', async () => {
    fight();
    await asBarbarian(15, ['Persistent Rage']);
    const full = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Persistent Rage' });
    expect(full.error).toBe('Hero has every use of Rage');
    await rage();
    expect(getState(campaignId).marks).toContainEqual(expect.objectContaining({ kind: 'rage', turnEndsLeft: 100 }));
    expect((await sheetNow()).featureUses?.Rage).toBe(1);
    const regained = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Persistent Rage' });
    expect(regained.summary).toBe('Hero regains every use of Rage (Persistent Rage): 5 uses, once until a Long Rest');
    expect((await sheetNow()).featureUses).toEqual({ 'Persistent Rage': 1 });
    await patchSheet({ featureUses: { Rage: 2, 'Persistent Rage': 1 } });
    const twice = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Persistent Rage' });
    expect(twice.error).toBe('Hero: No uses of Persistent Rage left until a rest');
  });
});

describe('Indomitable Might and Primal Knowledge', () => {
  const mighty = { stats: { strength: { score: 24, modifier: 7 }, dexterity: { score: 14, modifier: 2 }, wisdom: { score: 12, modifier: 1 } } };

  it('uses the Strength score for a Strength check that totals less', async () => {
    fight();
    await asBarbarian(18, ['Indomitable Might'], mighty);
    rolls = [2];
    const low = await ask(player, 'combat.check', { tokenId: HERO, ability: 'str', dc: 20 });
    expect(low).toMatchObject({ total: 24, success: true });
    expect(low.summary).toBe('Hero Strength check: 24 vs DC 20: success (Indomitable Might, rolled 9)');
    rolls = [19];
    const high = await ask(player, 'combat.check', { tokenId: HERO, ability: 'str' });
    expect(high.total).toBe(26);
  });

  it('uses the Strength score for a failed Strength save it would turn into a success', async () => {
    fight();
    await asBarbarian(18, ['Indomitable Might'], mighty);
    // The Ogre shoves (DC 14): the Hero saves with the better of Strength (+6) and Dexterity (+4), and rolls 2 + 6 = 8.
    await patchSheet({ savingThrows: { strength: { bonus: 6 }, dexterity: { bonus: 4 }, constitution: { bonus: 2 }, wisdom: { bonus: 1 } } });
    const shove = await actionIndex(dm, OGRE, 'Shove: knock Prone');
    rolls = [2];
    const answer = await ask(dm, 'combat.save', { sourceId: OGRE, targetIds: [HERO], action: shove });
    expect(answer.ok).toBe(true);
    expect(answer.targets?.[0]).toMatchObject({ saved: true, total: 24 });
    expect(answer.summary).toContain('Hero uses its Strength score, 24 (Indomitable Might, rolled 8)');
    expect((await tokenNow(HERO)).conditions).toEqual([]);
  });

  it('makes a Stealth check with Strength while raging, with the Advantage a Rage gives', async () => {
    fight();
    await asBarbarian(3, ['Primal Knowledge'], mighty);
    rolls = [10];
    const calm = await ask(player, 'combat.check', { tokenId: HERO, skill: 'stealth' });
    expect(calm.summary).toBe('Hero Dexterity (Stealth) check: 16');
    await rage();
    // Stealth +6 with Dexterity +2 is +11 with Strength +7; the better of 3 and 5.
    rolls = [3, 5];
    const raging = await ask(player, 'combat.check', { tokenId: HERO, skill: 'stealth' });
    expect(raging.summary).toBe('Hero Strength (Stealth) check: 16');
    expect(raging.reasons).toEqual(expect.arrayContaining(['Advantage: Rage', 'Primal Knowledge: made with Strength']));
  });
});
