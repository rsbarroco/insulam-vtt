/**
 * Monk and Warrior of the Open Hand features over the socket: the Deflect
 * Attacks redirect, Open Hand Technique, Slow Fall, Wholeness of Body,
 * Self-Restoration, Disciplined Survivor and Heightened Focus.
 *
 * The fixtures are those of deflectAttacks.integration.test.ts.
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
      data: { email: `monkfeat-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' },
    })
  ).id;
  playerId = (
    await prisma.user.create({
      data: {
        email: `monkfeat-player-${runId}@test.cozyvtt.local`,
        passwordHash: 'x',
        displayName: 'Player',
      },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: `MonkFeat ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' },
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
const fight = (turn: Record<string, unknown> = {}, current = HERO) =>
  setState(campaignId, {
    active: true,
    round: 1,
    currentTokenId: current,
    combatants: [
      entry(HERO, 'Hero', 18),
      entry(ALLY, 'Ally', 12),
      entry(OGRE, 'Ogre', 9),
      entry(FAR, 'Far Ogre', 5),
    ],
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0, ...turn },
  });
const greatclub = async () => {
  const listed = (await ask(dm, 'combat.actions', { tokenId: OGRE })) as unknown as {
    actions: Array<{ index: number; name: string }>;
  };
  return listed.actions.find((action) => action.name === 'Greatclub')!.index;
};
const asMonk = (level: number, features: string[], extra: Record<string, unknown> = {}) =>
  prisma.character.update({
    where: { id: heroCharacterId },
    data: {
      data: toJson({
        ...heroSheet(features),
        class: 'Monk',
        level,
        stats: { strength: { score: 16, modifier: 3 }, dexterity: { score: 16, modifier: 3 }, wisdom: { score: 12, modifier: 1 } },
        ...extra,
      }),
    },
  });
const heroData = async () =>
  ((await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data ?? {}) as {
    hp: { current: number; temporary: number };
    featureUses?: Record<string, number>;
  };
const mapToken = async (id: string) =>
  (
    (await prisma.map.findUnique({ where: { id: mapId } }))!.tokens as unknown as Array<{
      id: string;
      position: { x: number; y: number };
      conditions: string[];
      hp?: { current: number };
    }>
  ).find((entry) => entry.id === id)!;
/** Answer each prompt with the choice that `pick` makes of its options. */
const answering = (pick: (options: string[]) => string | null) => {
  const seen: string[][] = [];
  player.on('combat.prompt', (offer: { promptId: string; options: string[] }) => {
    seen.push(offer.options);
    player.emit('combat.react', { promptId: offer.promptId, choice: pick(offer.options) }, () => undefined);
  });
  return seen;
};
const unarmedIndex = async () => {
  const listed = (await ask(player, 'combat.actions', { tokenId: HERO })) as unknown as {
    actions: Array<{ index: number; name: string }>;
  };
  return listed.actions.find((action) => action.name === 'Unarmed Strike')!.index;
};
const stomp = async () => {
  const listed = (await ask(dm, 'combat.actions', { tokenId: OGRE })) as unknown as {
    actions: Array<{ index: number; name: string }>;
  };
  return listed.actions.find((action) => action.name === 'Stomp')!.index;
};

describe('Deflect Attacks redirect', () => {
  it('sends an attack brought to 0 back at the attacker for a Focus Point', async () => {
    fight();
    await asMonk(3, ['Deflect Attacks']);
    const seen = answering((options) => options[0]);
    // 15 + 6 hits AC 16; 1 + 1 + 4 = 6 bludgeoning; 10 + 6 off: none left.
    // The Ogre's Dexterity save: 5 - 1 = 4 against DC 11; 4 + 4 + 3 = 11 bludgeoning.
    rolls = [15, 1, 1, 10, 5, 4, 4];
    const hit = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: await greatclub() });
    expect(hit.dealt).toBe(0);
    expect(seen).toEqual([['Deflect Attacks'], ['Redirect (1 Focus Point)']]);
    expect(hit.summary).toContain('Deflect Attacks redirect (1 Focus Point): Ogre fails (Dexterity 4 vs DC 11) and takes 11 bludgeoning damage');
    expect((await mapToken(OGRE)).hp!.current).toBe(48);
    expect((await heroData()).featureUses).toEqual({ 'Focus Points': 1 });
  });

  it('spends the point and deals nothing when the attacker saves', async () => {
    fight();
    await asMonk(3, ['Deflect Attacks']);
    answering((options) => options[0]);
    rolls = [15, 1, 1, 10, 18];
    const hit = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: await greatclub() });
    expect(hit.summary).toContain('Deflect Attacks redirect (1 Focus Point): Ogre saves (Dexterity 17 vs DC 11)');
    expect((await mapToken(OGRE)).hp!.current).toBe(59);
    expect((await heroData()).featureUses).toEqual({ 'Focus Points': 1 });
  });

  it('is not asked while damage is left, nor spent when refused', async () => {
    fight();
    await asMonk(3, ['Deflect Attacks']);
    const seen = answering((options) => (options[0] === 'Deflect Attacks' ? options[0] : null));
    rolls = [15, 5, 5, 2];
    expect((await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: await greatclub() })).dealt).toBe(6);
    expect(seen).toEqual([['Deflect Attacks']]);
    fight();
    rolls = [15, 1, 1, 10];
    const hit = await ask(dm, 'combat.attack', { attackerId: OGRE, targetId: HERO, action: await greatclub() });
    expect(hit.dealt).toBe(0);
    expect(hit.summary).not.toContain('redirect');
    expect((await heroData()).featureUses ?? {}).toEqual({});
  });
});

describe('the Flurry of Blows strike in the attack menu', () => {
  const unarmedExtras = async () => {
    const listed = (await ask(player, 'combat.actions', { tokenId: HERO })) as unknown as {
      actions: Array<{ name: string; extras?: string[] }>;
    };
    return listed.actions.find((action) => action.name === 'Unarmed Strike')!.extras;
  };

  it('is offered only once Flurry of Blows has given strikes this turn', async () => {
    fight();
    await asMonk(3, []);
    expect(await unarmedExtras()).toBeUndefined();
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Flurry of Blows' })).ok).toBe(true);
    expect(await unarmedExtras()).toEqual(['flurry']);
  });

  it('is not offered to a character of another class', async () => {
    fight();
    await asMonk(3, []);
    await prisma.character.update({ where: { id: heroCharacterId }, data: { data: toJson({ ...heroSheet([]), class: 'Wizard', level: 3 }) } });
    expect(await unarmedExtras()).toBeUndefined();
  });
});

describe('Open Hand Technique', () => {
  const flurry = async () => {
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Flurry of Blows' })).ok).toBe(true);
    const strike = await unarmedIndex();
    return () => ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: strike, extra: 'flurry' });
  };

  it('asks after a Flurry of Blows hit, and Topple knocks Prone on a failed Dexterity save', async () => {
    fight();
    await asMonk(3, ['Open Hand Technique']);
    const seen = answering(() => 'Topple');
    const strike = await flurry();
    // 15 hits AC 11; the Ogre's Dexterity save: 5 - 1 = 4 against DC 11.
    rolls = [15, 5];
    const hit = await strike();
    expect(seen).toEqual([['Addle', 'Push', 'Topple']]);
    expect(hit.summary).toContain('Open Hand Technique (Topple): Ogre fails (Dexterity 4 vs DC 11) and is Prone');
    expect((await mapToken(OGRE)).conditions).toContain('Prone');
  });

  it('Push sends the target 15 feet away on a failed Strength save, and not on a success', async () => {
    fight();
    await asMonk(3, ['Open Hand Technique']);
    answering(() => 'Push');
    const strike = await flurry();
    // The Ogre's Strength save: 15 + 4 against DC 11.
    rolls = [15, 15];
    expect((await strike()).summary).toContain('Open Hand Technique (Push): Ogre saves (Strength 19 vs DC 11)');
    expect((await mapToken(OGRE)).position.x).toBe(2);
    rolls = [15, 2];
    expect((await strike()).summary).toContain('Open Hand Technique (Push): Ogre fails (Strength 6 vs DC 11) and is pushed 15 ft');
    expect((await mapToken(OGRE)).position.x).toBe(5);
  });

  it('Addle keeps the target from Opportunity Attacks until its next turn starts', async () => {
    const hostile = () =>
      prisma.map.update({
        where: { id: mapId },
        data: { tokens: toJson(freshTokens().map((entry) => (entry.id === OGRE ? { ...entry, disposition: 'hostile' } : entry))) },
      });
    const walkAway = async () => {
      player.emit('token.move.end', { tokenId: HERO, mapId, x: 1, y: 5 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      return getState(campaignId).opportunities.map((offer) => offer.attackerId);
    };
    // Without Addle, walking out of the hostile Ogre's reach offers it an Opportunity Attack.
    fight();
    await hostile();
    await asMonk(3, ['Open Hand Technique']);
    expect(await walkAway()).toEqual([OGRE]);
    fight();
    await hostile();
    answering(() => 'Addle');
    const strike = await flurry();
    rolls = [15];
    expect((await strike()).summary).toContain("Open Hand Technique (Addle): Ogre can't make Opportunity Attacks until the start of its next turn");
    expect(getState(campaignId).marks).toContainEqual({ kind: 'addle', attackerId: OGRE, targetId: OGRE, turnEndsLeft: 1 });
    // The Hero walks out of the Ogre's reach: no Opportunity Attack is offered.
    expect(await walkAway()).toEqual([]);
    // The mark goes as the Ogre's turn starts.
    dm.emit('initiative.next');
    await new Promise((resolve) => setTimeout(resolve, 300));
    dm.emit('initiative.next');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(getState(campaignId).currentTokenId).toBe(OGRE);
    expect(getState(campaignId).marks.filter((mark) => mark.kind === 'addle')).toEqual([]);
  });

  it('is not asked on a strike of the Attack action, nor without the feature', async () => {
    fight();
    await asMonk(3, ['Open Hand Technique']);
    const seen = answering(() => 'Topple');
    rolls = [15];
    expect((await ask(player, 'combat.attack', { attackerId: HERO, targetId: OGRE, action: await unarmedIndex() })).ok).toBe(true);
    expect(seen).toEqual([]);
    await asMonk(3, []);
    const strike = await flurry();
    rolls = [15];
    expect((await strike()).ok).toBe(true);
    expect(seen).toEqual([]);
  });
});

describe('Slow Fall', () => {
  it('takes five times the Monk level off the fall, spending the reaction', async () => {
    fight();
    await asMonk(4, ['Slow Fall']);
    answering((options) => options[0]);
    // 30 feet: 6 + 6 + 6 = 18; 20 off: none left, and the Monk lands on its feet.
    rolls = [6, 6, 6];
    const fell = await ask(player, 'combat.fall', { tokenId: HERO, feet: 30 });
    expect(fell.summary).toBe('Hero falls 30 ft: no damage (18 taken off by Slow Fall)');
    expect((await mapToken(HERO)).conditions).not.toContain('Prone');
    expect(getState(campaignId).reactionsSpent).toContain(HERO);
    // With its reaction spent, the next fall is not softened.
    rolls = [6, 6, 6, 6, 6];
    const again = await ask(player, 'combat.fall', { tokenId: HERO, feet: 50 });
    expect(again.dealt).toBe(30);
  });

  it('leaves what is left of a long fall, with the Monk Prone', async () => {
    await asMonk(4, ['Slow Fall']);
    answering((options) => options[0]);
    rolls = [6, 6, 6, 6, 6];
    const fell = await ask(player, 'combat.fall', { tokenId: HERO, feet: 50 });
    expect(fell.summary).toBe('Hero falls 50 ft: 10 bludgeoning damage (20 taken off by Slow Fall), Prone');
    expect((await heroData()).hp.current).toBe(20);
  });
});

describe('Wholeness of Body', () => {
  it('restores the Martial Arts die + Wisdom modifier as a Bonus Action, Wisdom-modifier times', async () => {
    fight();
    await asMonk(6, ['Wholeness of Body'], { hp: { current: 10, maximum: 30, temporary: 0 } });
    const listed = (await ask(player, 'combat.actions', { tokenId: HERO })) as unknown as { resources: Array<{ name: string; max: number }> };
    expect(listed.resources).toContainEqual(expect.objectContaining({ name: 'Wholeness of Body', max: 1 }));
    // A level 6 Monk rolls 1d8: 5 + 1.
    rolls = [5];
    const healed = await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Wholeness of Body' });
    expect(healed.summary).toBe('Hero uses Wholeness of Body: regains 6 Hit Points (0 uses left)');
    expect((await heroData()).hp.current).toBe(16);
    expect(getState(campaignId).turn?.bonusAction).toBe(true);
    fight();
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Wholeness of Body' })).error).toBe(
      'Hero: No uses of Wholeness of Body left until a rest'
    );
  });

  it('is refused a Monk whose sheet does not list it', async () => {
    await asMonk(6, []);
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Wholeness of Body' })).error).toBe(
      'Hero: The sheet has no Wholeness of Body'
    );
  });
});

describe('Self-Restoration', () => {
  const withConditions = async (conditions: string[]) => {
    const tokens = freshTokens().map((entry) => (entry.id === HERO ? { ...entry, conditions } : entry));
    await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(tokens) } });
  };

  it('ends the one condition as the turn ends', async () => {
    fight();
    await asMonk(10, ['Self-Restoration']);
    await withConditions(['Poisoned', 'Prone']);
    dm.emit('initiative.next');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await mapToken(HERO)).conditions).toEqual(['Prone']);
  });

  it('asks which when there are several, and leaves a sheet without the feature alone', async () => {
    fight();
    await asMonk(10, ['Self-Restoration']);
    await withConditions(['Charmed', 'Frightened']);
    const seen = answering(() => 'Frightened');
    dm.emit('initiative.next');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(seen).toEqual([['Charmed', 'Frightened']]);
    expect((await mapToken(HERO)).conditions).toEqual(['Charmed']);
    fight();
    await asMonk(9, []);
    dm.emit('initiative.next');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await mapToken(HERO)).conditions).toEqual(['Charmed']);
  });
});

describe('Disciplined Survivor', () => {
  it('rolls a failed save again for a Focus Point, and the new roll stands', async () => {
    fight({}, OGRE);
    await asMonk(14, ['Disciplined Survivor']);
    const seen = answering((options) => options[0]);
    // 4 + 4 thunder; the Ally's save, then the Hero's 2 + 4 = 6 against DC 13, rolled again: 15 + 4.
    rolls = [4, 4, 10, 2, 15];
    const stomped = await ask(dm, 'combat.save', { sourceId: OGRE, action: await stomp(), targetIds: [ALLY, HERO] });
    expect(seen).toEqual([['Disciplined Survivor']]);
    expect(stomped.summary).toContain('Hero fails (6), Disciplined Survivor: saves (19), 4 damage');
    expect((await heroData()).featureUses).toEqual({ 'Focus Points': 1 });
  });

  it('is not asked with no Focus Points left', async () => {
    fight({}, OGRE);
    await asMonk(14, ['Disciplined Survivor'], { featureUses: { 'Focus Points': 14 } });
    const seen = answering((options) => options[0]);
    rolls = [4, 4, 2];
    const stomped = await ask(dm, 'combat.save', { sourceId: OGRE, action: await stomp(), targetIds: [HERO] });
    expect(seen).toEqual([]);
    expect(stomped.summary).toContain('Hero fails (6), 8 damage');
  });
});

describe('Heightened Focus', () => {
  it('gives Flurry of Blows a third strike, and Patient Defense two Martial Arts dice of Temporary Hit Points', async () => {
    fight();
    await asMonk(10, ['Heightened Focus']);
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Flurry of Blows' })).summary).toBe(
      'Hero uses Flurry of Blows: 3 Unarmed Strikes (1 Focus Point, 9 left)'
    );
    fight();
    // A level 10 Monk rolls d8s: 5 + 7.
    rolls = [5, 7];
    expect((await ask(player, 'combat.feature', { tokenId: HERO, feature: 'Patient Defense', focus: true })).summary).toBe(
      'Hero uses Patient Defense: Disengage and Dodge (1 Focus Point, 8 left); Heightened Focus: 12 Temporary Hit Points'
    );
    expect((await heroData()).hp.temporary).toBe(12);
  });
});
