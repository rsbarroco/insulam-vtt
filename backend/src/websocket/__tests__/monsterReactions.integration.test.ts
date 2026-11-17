/**
 * Reaction spells of stat blocks over the socket: the SRD Mage's Protective
 * Magic (3/Day) casts Shield and Counterspell, asked of the DM as a
 * character's player is asked, and its Spellcasting list (Fireball, 2/Day)
 * can be answered with Counterspell. Uses a day are kept on the token's
 * metadata; a countered spell keeps its use.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson } from '../../utils/prisma-json';
import { createWsTestServer, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { clearState, getState, setState, type CombatantEntry } from '../initiativeState';
import { findMonster } from '../../rules/dnd/monsters';
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
const MAGE = randomUUID();
const PROTECTIVE = 'Protective Magic (3/Day)';

interface Answer {
  ok: boolean;
  error?: string;
  summary?: string;
  countered?: boolean;
  targets?: Array<{ tokenId: string; saved: boolean; total: number | null; dealt: number }>;
  hit?: boolean;
  dealt?: number;
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
const mageBlock = findMonster('Mage')!.statBlock;
const freshTokens = (spent: Record<string, number> = {}) => [
  token(HERO, 'Hero', 1, { controlledBy: playerId, characterId: heroCharacterId, type: 'player' }),
  token(MAGE, 'Mage', 2, {
    type: 'npc',
    disposition: 'hostile',
    hp: { current: 81, max: 81, temp: 0 },
    statBlock: mageBlock,
    metadata: Object.keys(spent).length > 0 ? { dailyUses: spent } : {},
  }),
];
const heroSheet = () => ({
  featuresAndTraits: [],
  hp: { current: 60, maximum: 60, temporary: 0 },
  armorClass: 16,
  savingThrows: {
    strength: { bonus: 2 },
    dexterity: { bonus: 2 },
    constitution: { bonus: 2 },
    intelligence: { bonus: 0 },
    wisdom: { bonus: 1 },
    charisma: { bonus: 0 },
  },
  attacks: [{ name: 'Longsword', attackBonus: 5, damageRoll: '1d8+3', damageType: 'slashing' }],
  proficiencyBonus: 2,
  stats: { strength: { score: 16, modifier: 3 } },
  spellcasting: {
    spellAttackBonus: 6,
    spellSaveDC: 14,
    cantrips: [],
    spells: [
      { name: 'Fireball', level: 3, prepared: true },
      { name: 'Counterspell', level: 3, prepared: true },
    ],
    slots: { '3': { total: 2, expended: 0 } },
  },
});

let rolls: number[] = [];

beforeAll(async () => {
  dmId = (await prisma.user.create({ data: { email: `mrx-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'DM' } })).id;
  playerId = (
    await prisma.user.create({ data: { email: `mrx-player-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Player' } })
  ).id;
  campaignId = (
    await prisma.campaign.create({ data: { name: `Monster Reactions ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' } })
  ).id;
  heroCharacterId = (
    await prisma.character.create({
      data: { userId: playerId, campaignId, name: 'Hero', gameSystem: 'DND_5E', data: toJson(heroSheet()) },
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
        name: 'Tower',
        imageUrl: '/api/assets/maps/x',
        baseLayerUrl: '/api/assets/maps/x',
        width: 10,
        height: 10,
        gridSize: 50,
        annotations: [],
        fogEnabled: false,
        tokens: toJson([]),
      },
    })
  ).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId, status: 'ACTIVE' } });
  server = await createWsTestServer();
});

beforeEach(async () => {
  clearState(campaignId);
  await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(freshTokens()) } });
  await prisma.character.update({ where: { id: heroCharacterId }, data: { data: toJson(heroSheet()) } });
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
const fight = (currentTokenId: string) =>
  setState(campaignId, {
    active: true,
    round: 1,
    currentTokenId,
    combatants: [entry(HERO, 'Hero', 18), entry(MAGE, 'Mage', 12)],
    turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0 },
  });
type Listed = { index: number; name: string; perDay?: { max: number; left: number }; spell: { noSlot?: boolean } | null };
const listActions = async (tokenId: string) =>
  ((await ask(dm, 'combat.actions', { tokenId })) as unknown as { actions: Listed[] }).actions;
const actionIndex = async (tokenId: string, name: string) => (await listActions(tokenId)).find((action) => action.name === name)!.index;
interface Offer {
  promptId: string;
  text: string;
  options: string[];
}
const answering = (socket: ClientSocket, choose: (offer: Offer) => string | null): Offer[] => {
  const offers: Offer[] = [];
  socket.on('combat.prompt', (offer: Offer) => {
    offers.push(offer);
    socket.emit('combat.react', { promptId: offer.promptId, choice: choose(offer) }, () => undefined);
  });
  return offers;
};
const mageToken = async () => {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  return (map!.tokens as unknown as Array<{ id: string; hp: { current: number }; metadata?: { dailyUses?: Record<string, number> } }>).find(
    (t) => t.id === MAGE
  )!;
};
const heroSlots = async () => {
  const character = await prisma.character.findUnique({ where: { id: heroCharacterId } });
  return (character!.data as { spellcasting: { slots: Record<string, { expended: number }> } }).spellcasting.slots['3'].expended;
};
const heroHp = async () =>
  ((await prisma.character.findUnique({ where: { id: heroCharacterId } }))!.data as { hp: { current: number } }).hp.current;

describe('a stat block’s Spellcasting', () => {
  it('lists its spells at their version, with no slot and the uses a day left', async () => {
    const actions = await listActions(MAGE);
    const fireball = actions.find((action) => action.name === 'Fireball')!;
    expect(fireball.perDay).toEqual({ max: 2, left: 2 });
    expect(fireball.spell?.noSlot).toBe(true);
    expect(actions.find((action) => action.name === 'Misty Step (3/Day)')!.perDay).toEqual({ max: 3, left: 3 });
  });
});

describe('Shield cast by a stat block', () => {
  it('turns a hit into a miss, spending a use of Protective Magic and the reaction', async () => {
    fight(HERO);
    const offers = answering(dm, (offer) => offer.options[0]);
    // 12 + 5 = 17 hits AC 15, and misses AC 20.
    rolls = [12, 4];
    const attack = await ask(player, 'combat.attack', { attackerId: HERO, targetId: MAGE, action: await actionIndex(HERO, 'Longsword') });
    expect(offers).toHaveLength(1);
    expect(offers[0].options).toEqual(['Shield (Protective Magic, 3 of 3/Day left)']);
    expect(offers[0].text).toContain('17 against AC 15');
    expect(attack.hit).toBe(false);
    expect(attack.summary).toContain('(AC 20): miss');
    expect(attack.summary).toContain('Shield (Protective Magic, 3 of 3/Day left): +5 AC');
    const mage = await mageToken();
    expect(mage.hp.current).toBe(81);
    expect(mage.metadata?.dailyUses).toEqual({ [PROTECTIVE]: 1 });
    expect(getState(campaignId).reactionsSpent).toContain(MAGE);
  });

  it('is not offered once Protective Magic’s uses are gone for the day', async () => {
    fight(HERO);
    await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(freshTokens({ [PROTECTIVE]: 3 })) } });
    const offers = answering(dm, (offer) => offer.options[0]);
    rolls = [12, 4];
    const attack = await ask(player, 'combat.attack', { attackerId: HERO, targetId: MAGE, action: await actionIndex(HERO, 'Longsword') });
    expect(offers).toHaveLength(0);
    expect(attack.hit).toBe(true);
    expect((await mageToken()).hp.current).toBe(81 - 7);
  });
});

describe('Counterspell against a stat block’s spell', () => {
  it('makes the Mage’s Fireball dissipate: the action is spent and its use a day kept', async () => {
    fight(MAGE);
    const offers = answering(player, (offer) => offer.options[0]);
    // The Mage's Constitution save: 5 + 0 against the Hero's DC 14.
    rolls = [5];
    const fireball = await actionIndex(MAGE, 'Fireball');
    const cast = await ask(dm, 'combat.save', { sourceId: MAGE, targetIds: [HERO], action: fireball });
    expect(offers).toHaveLength(1);
    expect(offers[0].options).toEqual(['Counterspell (level 3 slot)']);
    expect(offers[0].text).toContain('Mage casts Fireball');
    expect(cast.countered).toBe(true);
    expect(cast.summary).toContain('Fireball dissipates: the action is spent, and no spell slot or use a day');
    expect(await heroHp()).toBe(60);
    expect(await heroSlots()).toBe(1);
    expect((await mageToken()).metadata?.dailyUses ?? {}).toEqual({});
    expect(getState(campaignId).turn?.action).toBe('Magic');
  });

  it('lets the Fireball through when declined, at its level 4 version, and spends its use', async () => {
    fight(MAGE);
    answering(player, () => null);
    // 9d6 of 3 each = 27 Fire; the Hero's Dexterity save of 2 + 2 fails against DC 14.
    rolls = [3, 3, 3, 3, 3, 3, 3, 3, 3, 2];
    const cast = await ask(dm, 'combat.save', { sourceId: MAGE, targetIds: [HERO], action: await actionIndex(MAGE, 'Fireball') });
    expect(cast.ok).toBe(true);
    expect(cast.targets![0].dealt).toBe(27);
    expect(await heroHp()).toBe(33);
    expect((await mageToken()).metadata?.dailyUses).toEqual({ Fireball: 1 });
  });

  it('refuses a spell whose uses a day are gone', async () => {
    fight(MAGE);
    await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(freshTokens({ Fireball: 2 })) } });
    const fireball = (await listActions(MAGE)).find((action) => action.name === 'Fireball')!;
    expect(fireball.perDay).toEqual({ max: 2, left: 0 });
    const cast = await ask(dm, 'combat.save', { sourceId: MAGE, targetIds: [HERO], action: fireball.index });
    expect(cast.ok).toBe(false);
    expect(cast.error).toBe('Mage has no use of Fireball left today');
  });
});

describe('Counterspell cast by a stat block', () => {
  it('answers a character’s spell with Protective Magic: the slot kept, a use and the reaction spent', async () => {
    fight(HERO);
    const offers = answering(dm, (offer) => offer.options[0]);
    // The Hero's Constitution save: 5 + 2 = 7 against the Mage's DC 14.
    rolls = [5];
    const cast = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [MAGE], action: await actionIndex(HERO, 'Fireball') });
    expect(offers).toHaveLength(1);
    expect(offers[0].options).toEqual(['Counterspell (Protective Magic, 3 of 3/Day left)']);
    expect(cast.countered).toBe(true);
    expect(cast.summary).toContain('Mage casts Counterspell (Protective Magic, 3 of 3/Day left)');
    expect(await heroSlots()).toBe(0);
    expect((await mageToken()).hp.current).toBe(81);
    expect((await mageToken()).metadata?.dailyUses).toEqual({ [PROTECTIVE]: 1 });
    expect(getState(campaignId).reactionsSpent).toContain(MAGE);
  });

  it('is not offered with its uses gone, and the spell is cast', async () => {
    fight(HERO);
    await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(freshTokens({ [PROTECTIVE]: 3 })) } });
    const offers = answering(dm, (offer) => offer.options[0]);
    const cast = await ask(player, 'combat.save', { sourceId: HERO, targetIds: [MAGE], action: await actionIndex(HERO, 'Fireball') });
    expect(offers).toHaveLength(0);
    expect(cast.ok).toBe(true);
    expect(cast.countered).toBeUndefined();
    expect(await heroSlots()).toBe(1);
  });
});

describe('Hellish Rebuke and Feather Fall cast by a stat block', () => {
  const imp = {
    ...mageBlock,
    ac: 12,
    reactions: [],
    actions: [
      {
        name: 'Spellcasting',
        description:
          'The cultist casts one of the following spells, using Charisma as the spellcasting ability (spell save DC 13): At Will: Feather Fall 1/Day Each: Hellish Rebuke (level 2 version)',
      },
    ],
  };
  const withImp = () =>
    prisma.map.update({
      where: { id: mapId },
      data: { tokens: toJson(freshTokens().map((t) => (t.id === MAGE ? { ...t, name: 'Cultist', statBlock: imp } : t))) },
    });
  const until = async (done: () => Promise<boolean>) => {
    for (let tries = 0; tries < 100 && !(await done()); tries++) await new Promise((resolve) => setTimeout(resolve, 30));
  };

  it('rebukes the creature that damaged it, at the version its list writes, once a day', async () => {
    fight(HERO);
    await withImp();
    const offers = answering(dm, (offer) => offer.options[0]);
    // 15 + 5 hits AC 12 for 4 + 3. The rebuke: 3d10 = 5 + 5 + 5 Fire; the Hero's Dexterity save of 2 + 2 fails against DC 13.
    rolls = [15, 4, 5, 5, 5, 2];
    await ask(player, 'combat.attack', { attackerId: HERO, targetId: MAGE, action: await actionIndex(HERO, 'Longsword') });
    await until(async () => (await heroHp()) < 60);
    expect(offers).toHaveLength(1);
    expect(offers[0].options).toEqual(['Hellish Rebuke (1 of 1/Day left)']);
    expect(await heroHp()).toBe(45);
    expect((await mageToken()).metadata?.dailyUses).toEqual({ 'Hellish Rebuke': 1 });
    expect(getState(campaignId).reactionsSpent).toContain(MAGE);
  });

  it('casts Feather Fall at will on its own fall', async () => {
    fight(MAGE);
    await withImp();
    const offers = answering(dm, (offer) => offer.options[0]);
    const fall = (await ask(dm, 'combat.fall', { tokenId: MAGE, feet: 30 })) as unknown as { dealt: number; summary: string };
    expect(offers).toHaveLength(1);
    expect(offers[0].options).toEqual(['Feather Fall (at will)']);
    expect(fall.dealt).toBe(0);
    expect((await mageToken()).metadata?.dailyUses ?? {}).toEqual({});
    expect(getState(campaignId).reactionsSpent).toContain(MAGE);
  });
});

describe('Shield of a stat block asked again on a new hit', () => {
  it('declined, then a hit made again after Cutting Words: asked again, taken, one use spent', async () => {
    fight(HERO);
    const skaldId = (
      await prisma.character.create({
        data: {
          userId: dmId,
          campaignId,
          name: 'Skald',
          gameSystem: 'DND_5E',
          data: toJson({
            ...heroSheet(),
            class: 'Bard',
            level: 5,
            featuresAndTraits: [{ name: 'Cutting Words', description: '' }],
            stats: { charisma: { score: 16, modifier: 3 } },
          }),
        },
      })
    ).id;
    const SKALD = randomUUID();
    await prisma.map.update({
      where: { id: mapId },
      data: {
        tokens: toJson([
          ...freshTokens().map((t) =>
            t.id === HERO ? { ...t, metadata: { bardicInspiration: { sides: 8, from: 'Bard', until: Date.now() + 3_600_000 } } } : t
          ),
          token(SKALD, 'Skald', 2, { position: { x: 2, y: 2 }, characterId: skaldId, type: 'npc', disposition: 'hostile' }),
        ]),
      },
    });
    const heroAsked = answering(player, (offer) => (offer.options.includes('Bardic Inspiration') ? 'Bardic Inspiration' : null));
    // The Mage declines Shield the first time and casts it the second; the Skald takes Cutting Words.
    const dmAsked: Offer[] = [];
    dm.on('combat.prompt', (offer: Offer) => {
      dmAsked.push(offer);
      const [option] = offer.options;
      const shields = dmAsked.filter((asked) => asked.options[0].startsWith('Shield')).length;
      const choice = option.startsWith('Shield') ? (shields > 1 ? option : null) : option === 'Cutting Words (attack roll)' ? option : null;
      dm.emit('combat.react', { promptId: offer.promptId, choice }, () => undefined);
    });
    // 11 + 5 = 16 hits AC 15 (Shield would make it a miss: declined); the Skald's d8 takes 4 off: 12 misses;
    // the Hero's d8 adds 6: 18 hits again; Shield, asked again: AC 20, a miss.
    rolls = [11, 4, 4, 6, 5];
    const swing = await ask(player, 'combat.attack', { attackerId: HERO, targetId: MAGE, action: await actionIndex(HERO, 'Longsword') });
    expect(dmAsked.map((offer) => offer.options)).toEqual([
      ['Shield (Protective Magic, 3 of 3/Day left)'],
      ['Cutting Words (attack roll)'],
      ['Shield (Protective Magic, 3 of 3/Day left)'],
    ]);
    expect(heroAsked.map((offer) => offer.options)).toEqual([['Bardic Inspiration']]);
    expect(swing).toMatchObject({ ok: true, hit: false, dealt: 0 });
    expect(swing.summary).toContain('Bardic Inspiration +6');
    expect(swing.summary).toContain('Shield (Protective Magic, 3 of 3/Day left): +5 AC');
    expect((await mageToken()).metadata?.dailyUses).toEqual({ [PROTECTIVE]: 1 });
    expect(getState(campaignId).reactionsSpent).toContain(MAGE);
  });
});
