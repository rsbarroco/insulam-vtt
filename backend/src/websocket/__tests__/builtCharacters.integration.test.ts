/**
 * A character from the guided builder fights with what it was built with.
 *
 * A Fighter, a Rogue, a Wizard, a Cleric and a Warlock are built over REST
 * (POST …/rules/dnd/build) with their starting equipment and spells, saved
 * through POST /api/characters, put on the map, and their actions read with
 * `combat.actions`. Every bonus and damage below is worked out by hand from
 * the scores, the Proficiency Bonus and the weapon or spell.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson } from '../../utils/prisma-json';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { createTestUser, TEST_PASSWORD, prisma as testPrisma } from '../../__tests__/helpers/db';
import { createWsTestServer, WsTestServer } from '../../__tests__/helpers/websocket-test-server';

jest.setTimeout(30000);

const runId = randomUUID().slice(0, 8);
let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let mapId: string;
let player: ClientSocket;
const tokenOf: Record<string, string> = {};

interface ActionRow {
  name: string;
  cost: string;
  attack: { kind: string; bonus: number; damage: string } | null;
  save: { ability: string; dc: number; damage: string } | null;
  heal?: { dice: string };
  darts?: { count: number; damage: string };
}

const base = {
  species: 'Dwarf',
  level: 1,
  improvements: [],
};

const CHARACTERS = {
  Fighter: {
    ...base,
    name: 'Brann',
    background: 'Soldier',
    classes: ['Fighter'],
    // Strength 17 (+3), Dexterity 13 (+1).
    abilityScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    backgroundIncreases: { str: 2, con: 1 },
    originFeat: 'Savage Attacker',
    skills: ['perception', 'survival'],
    featureChoices: { fightingStyleFighter: ['Archery'] },
    equipment: { class: 'A', background: 'A' },
    masteries: ['Greatsword', 'Javelin', 'Shortbow'],
  },
  Rogue: {
    ...base,
    name: 'Vex',
    background: 'Criminal',
    classes: ['Rogue'],
    // Dexterity 17 (+3).
    abilityScores: { str: 10, dex: 15, con: 14, int: 12, wis: 13, cha: 8 },
    backgroundIncreases: { dex: 2, con: 1 },
    originFeat: 'Alert',
    skills: ['acrobatics', 'deception', 'insight', 'perception'],
    equipment: { class: 'A', background: 'A' },
    masteries: ['Dagger', 'Shortbow'],
  },
  Wizard: {
    ...base,
    name: 'Ilse',
    background: 'Sage',
    classes: ['Wizard'],
    // Intelligence 17 (+3), Dexterity 14 (+2), Strength 8 (-1).
    abilityScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    backgroundIncreases: { int: 2, con: 1 },
    originFeat: 'Magic Initiate',
    skills: ['investigation', 'medicine'],
    equipment: { class: 'A', background: 'A' },
    spells: [
      {
        class: 'Wizard',
        cantrips: ['Fire Bolt', 'Ray of Frost', 'Mage Hand'],
        spellbook: ['Magic Missile', 'Shield', 'Thunderwave', 'Sleep', 'Detect Magic', 'Feather Fall'],
        prepared: ['Magic Missile', 'Shield', 'Thunderwave', 'Sleep'],
      },
    ],
  },
  Cleric: {
    ...base,
    name: 'Odo',
    level: 3,
    background: 'Acolyte',
    classes: ['Cleric'],
    // Wisdom 17 (+3), Strength 14 (+2), Dexterity 13 (+1).
    abilityScores: { str: 14, dex: 13, con: 12, int: 8, wis: 15, cha: 10 },
    backgroundIncreases: { wis: 2, cha: 1 },
    originFeat: 'Magic Initiate',
    skills: ['history', 'medicine'],
    equipment: { class: 'A', background: 'B' },
    spells: [
      {
        class: 'Cleric',
        cantrips: ['Sacred Flame', 'Guidance', 'Thaumaturgy'],
        prepared: ['Guiding Bolt', 'Healing Word', 'Shield of Faith', 'Command', 'Sanctuary', 'Hold Person'],
      },
    ],
  },
  Warlock: {
    ...base,
    name: 'Mor',
    background: 'Acolyte',
    classes: ['Warlock'],
    // Charisma 17 (+3), Dexterity 14 (+2), Strength 10 (0).
    abilityScores: { str: 10, dex: 14, con: 13, int: 12, wis: 8, cha: 15 },
    backgroundIncreases: { cha: 2, int: 1 },
    originFeat: 'Magic Initiate',
    skills: ['arcana', 'deception'],
    equipment: { class: 'A', background: 'B' },
    spells: [{ class: 'Warlock', cantrips: ['Eldritch Blast', 'Prestidigitation'], prepared: ['Hellish Rebuke', 'Charm Person'] }],
  },
} as const;

type Hero = keyof typeof CHARACTERS;
const sheets: Partial<Record<Hero, Record<string, unknown>>> = {};

beforeAll(async () => {
  const dm = await createTestUser({ email: `built-dm-${runId}@test.cozyvtt.local`, displayName: 'DM' });
  const user = await createTestUser({ email: `built-player-${runId}@test.cozyvtt.local`, displayName: 'Player' });
  dmId = dm.id;
  playerId = user.id;
  campaignId = (await prisma.campaign.create({ data: { name: `Built ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: 'DND_5E' } })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });

  // Built and saved as the builder does it, over REST.
  const rest = request.agent(createTestApp());
  expect((await rest.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(200);
  const tokens = [];
  let x = 0;
  for (const [hero, choices] of Object.entries(CHARACTERS) as Array<[Hero, (typeof CHARACTERS)[Hero]]>) {
    const built = await rest.post(`/api/campaigns/${campaignId}/rules/dnd/build`).send(choices);
    expect([hero, built.status, built.body.errors]).toEqual([hero, 200, undefined]);
    const saved = await rest.post('/api/characters').send({ name: choices.name, gameSystem: 'DND_5E', campaignId, data: built.body.sheet });
    expect([hero, saved.status, saved.body.message]).toEqual([hero, 201, saved.body.message]);
    sheets[hero] = saved.body.character.data;
    const id = randomUUID();
    tokenOf[hero] = id;
    tokens.push({
      id,
      name: choices.name,
      imageUrl: '',
      position: { x: x++, y: 1 },
      size: { width: 1, height: 1 },
      layer: 'token',
      visible: true,
      controlledBy: playerId,
      characterId: saved.body.character.id,
      type: 'player',
      rotation: 0,
      conditions: [],
      metadata: {},
    });
  }
  mapId = (
    await prisma.map.create({
      data: {
        campaignId,
        name: 'Built',
        imageUrl: '/api/assets/maps/x',
        baseLayerUrl: '/api/assets/maps/x',
        width: 10,
        height: 10,
        gridSize: 50,
        annotations: [],
        fogEnabled: false,
        tokens: toJson(tokens),
      },
    })
  ).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId, status: 'ACTIVE' } });
  server = await createWsTestServer();
  player = await server.connectAndAuth(await server.loginAs(playerId), campaignId);
});

afterAll(async () => {
  player?.disconnect();
  await server?.close();
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await prisma.map.deleteMany({ where: { campaignId } });
  await prisma.character.deleteMany({ where: { campaignId } });
  await prisma.campaignMembership.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: { in: [dmId, playerId] } } });
  await prisma.$disconnect();
  await testPrisma.$disconnect();
});

const actionsOf = (hero: Hero) =>
  new Promise<ActionRow[]>((resolve, reject) =>
    player.emit('combat.actions', { tokenId: tokenOf[hero] }, (answer: { ok: boolean; error?: string; actions?: ActionRow[] }) =>
      answer.ok ? resolve(answer.actions!) : reject(new Error(answer.error))
    )
  );
const attacks = (actions: ActionRow[]) =>
  actions.filter((action) => action.attack && !/^Unarmed Strike/.test(action.name)).map((action) => [action.name, action.attack!.kind, action.attack!.bonus, action.attack!.damage]);
const named = (actions: ActionRow[], name: string) => actions.find((action) => action.name === name);

describe('a built character’s actions in combat', () => {
  it('a Fighter swings and shoots its starting weapons, Archery left to the roll', async () => {
    const actions = await actionsOf('Fighter');
    // Proficiency Bonus 2: Strength +3 for the melee and thrown weapons, Dexterity +1 for the Shortbow.
    expect(attacks(actions)).toEqual([
      ['Greatsword', 'melee', 5, '2d6+3 slashing'],
      ['Flail', 'melee', 5, '1d8+3 bludgeoning'],
      ['Javelin', 'melee', 5, '1d6+3 piercing'],
      ['Spear', 'melee', 5, '1d6+3 piercing'],
      ['Shortbow', 'ranged', 3, '1d6+1 piercing'],
    ]);
    // The Unarmed Strike is the server's own, once.
    expect(actions.filter((action) => action.name === 'Unarmed Strike')).toHaveLength(1);
    // Chain Mail, worn.
    expect(sheets.Fighter!.armorClass).toBe(16);
    expect((sheets.Fighter!.attacks as Array<{ name: string; useMastery?: boolean }>).filter((attack) => attack.useMastery).map((attack) => attack.name)).toEqual([
      'Greatsword', 'Javelin', 'Shortbow',
    ]);
  });

  it('a Rogue uses Dexterity with its Finesse and ranged weapons', async () => {
    expect(attacks(await actionsOf('Rogue'))).toEqual([
      ['Dagger', 'melee', 5, '1d4+3 piercing'],
      ['Shortsword', 'melee', 5, '1d6+3 piercing'],
      ['Shortbow', 'ranged', 5, '1d6+3 piercing'],
    ]);
    // Leather Armor 11 + Dexterity 3.
    expect(sheets.Rogue!.armorClass).toBe(14);
  });

  it('a Wizard casts its cantrips and prepared spells, not the rest of its book', async () => {
    const actions = await actionsOf('Wizard');
    // Intelligence +3 and Proficiency Bonus 2: +5 to hit, save DC 13.
    expect(attacks(actions)).toEqual([
      ['Dagger', 'melee', 4, '1d4+2 piercing'],
      ['Quarterstaff', 'melee', 1, '1d6-1 bludgeoning'],
      ['Fire Bolt', 'ranged', 5, '1d10 fire'],
      ['Ray of Frost', 'ranged', 5, '1d8 cold'],
    ]);
    expect(named(actions, 'Thunderwave')?.save).toMatchObject({ ability: 'con', dc: 13, damage: '2d8 thunder' });
    expect(named(actions, 'Magic Missile')?.darts).toMatchObject({ count: 3, damage: '1d4+1 force' });
    expect(named(actions, 'Shield')?.cost).toBe('reaction');
    expect(named(actions, 'Mage Hand')).toBeDefined();
    expect(named(actions, 'Sleep')).toBeDefined();
    expect(named(actions, 'Detect Magic')).toBeUndefined();
    expect(named(actions, 'Feather Fall')).toBeUndefined();
  });

  it('a Cleric has its domain spells prepared beside the ones it chose', async () => {
    const actions = await actionsOf('Cleric');
    // Wisdom +3, Proficiency Bonus 2; the Mace with Strength +2.
    expect(attacks(actions)).toEqual([
      ['Mace', 'melee', 4, '1d6+2 bludgeoning'],
      ['Guiding Bolt', 'ranged', 5, '4d6 radiant'],
    ]);
    expect(named(actions, 'Sacred Flame')?.save).toMatchObject({ ability: 'dex', dc: 13, damage: '1d8 radiant' });
    expect(named(actions, 'Healing Word')).toMatchObject({ cost: 'bonusAction', heal: { dice: '2d4+3' } });
    // Life Domain Spells at Cleric level 3.
    expect(named(actions, 'Cure Wounds')?.heal).toMatchObject({ dice: '2d8+3' });
    expect(named(actions, 'Bless')).toBeDefined();
    expect(named(actions, 'Aid')).toBeDefined();
    // Chain Shirt 13 + Dexterity 1 + Shield 2.
    expect(sheets.Cleric!.armorClass).toBe(16);
  });

  it('a Warlock casts by Pact Magic and carries its weapons', async () => {
    const actions = await actionsOf('Warlock');
    expect(attacks(actions)).toEqual([
      ['Sickle', 'melee', 2, '1d4 slashing'],
      ['Dagger', 'melee', 4, '1d4+2 piercing'],
      ['Eldritch Blast', 'ranged', 5, '1d10 force'],
    ]);
    expect(named(actions, 'Hellish Rebuke')).toMatchObject({ cost: 'reaction', save: { ability: 'dex', dc: 13, damage: '2d10 fire' } });
    expect(named(actions, 'Charm Person')?.save).toMatchObject({ ability: 'wis', dc: 13 });
    expect((sheets.Warlock!.spellcasting as { slots: Record<string, { total: number }> }).slots['1'].total).toBe(1);
  });
});
