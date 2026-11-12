/**
 * Filling the creature library with the SRD 5.2.1 monsters.
 *
 * The creatures come with the server, so a seed fetches nothing. It replaces
 * what an earlier seed stored: the 2014 creatures the library used to fetch,
 * or an earlier build of these.
 *
 * Every test keeps to creatures named for this run, so it neither sees nor
 * removes the creatures of a suite running beside it.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../../config/database';
import { allMonsters } from '../../rules/dnd/monsters';
import { seedSrdCreatures, type SeedCreature } from '../creatureSeed';

jest.setTimeout(30000);

const run = randomUUID().slice(0, 8);
// Each test has creatures of its own, by the first word of their names.
const named = (name: string) => `${name} ${run}`;
const goblin = allMonsters().find((monster) => monster.name === 'Goblin Warrior')!;
const creature = (name: string, over: Partial<SeedCreature> = {}): SeedCreature => ({ ...goblin, name: named(name), ...over });
const seed = (creatures: SeedCreature[]) => {
  const test = creatures[0].name.split(' ')[0];
  return seedSrdCreatures(prisma, { creatures, within: (name) => name.startsWith(`${test} `) && name.endsWith(` ${run}`) });
};
const row = (name: string) => prisma.creatureTemplate.findFirst({ where: { source: 'srd', name: named(name) } });
const count = (name: string) => prisma.creatureTemplate.count({ where: { name: named(name) } });

afterAll(async () => {
  await prisma.creatureTemplate.deleteMany({ where: { name: { endsWith: ` ${run}` } } });
  await prisma.$disconnect();
});

describe('seedSrdCreatures', () => {
  it('stores each creature as the library keeps one, for every campaign', async () => {
    const result = await seed([creature('Stored one')]);
    expect(result).toMatchObject({ fetched: 1, created: 1, updated: 0, skipped: 0, removed: 0, rejected: 0 });
    expect(await row('Stored one')).toMatchObject({
      source: 'srd', gameSystem: 'DND_5E', campaignId: null, createdById: null, challengeRating: '1/4',
      creatureType: 'Small Fey (Goblinoid)', alignment: 'Chaotic Neutral', size: { width: 1, height: 1 },
    });
  });

  it('leaves alone a creature already stored with the same stat block', async () => {
    await seed([creature('Again one')]);
    const before = await row('Again one');
    const result = await seed([creature('Again one')]);
    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1, alreadyExisted: 1 });
    expect((await row('Again one'))?.updatedAt).toEqual(before?.updatedAt);
  });

  it('replaces the stat block of an SRD creature stored under the same name, and keeps its picture', async () => {
    await prisma.creatureTemplate.create({
      data: {
        name: named('Older one'), gameSystem: 'DND_5E', source: 'srd', challengeRating: '1/8', creatureType: 'Small humanoid (goblinoid)',
        imageUrl: '/api/assets/tokens/goblin', statBlock: { ac: 13, speed: '30 ft.', abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 } },
      },
    });
    const result = await seed([creature('Older one')]);
    expect(result).toMatchObject({ created: 0, updated: 1, removed: 0 });
    expect(await row('Older one')).toMatchObject({ challengeRating: '1/4', creatureType: 'Small Fey (Goblinoid)', imageUrl: '/api/assets/tokens/goblin' });
    expect(((await row('Older one'))?.statBlock as { ac: number }).ac).toBe(15);
  });

  it('removes an SRD creature this set does not have, and never a custom one', async () => {
    const stat = { ac: 10, speed: '30 ft.', abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } };
    await prisma.creatureTemplate.createMany({
      data: [
        { name: named('Gone only in 2014'), gameSystem: 'DND_5E', source: 'srd', statBlock: stat },
        { name: named('Gone homebrew'), gameSystem: 'DND_5E', source: 'custom', statBlock: stat },
      ],
    });
    const result = await seed([creature('Gone kept')]);
    expect(result.removed).toBe(1);
    expect(await count('Gone only in 2014')).toBe(0);
    expect(await count('Gone homebrew')).toBe(1);
    expect(await count('Gone kept')).toBe(1);
  });

  it('leaves out a stat block the creature library would refuse', async () => {
    const result = await seed([creature('Checked sound'), creature('Checked armoured', { statBlock: { ...goblin.statBlock, ac: 500 } })]);
    expect(result.rejected).toBe(1);
    expect(await count('Checked sound')).toBe(1);
    expect(await count('Checked armoured')).toBe(0);
  });

  it('creates each creature once when two seeds run at the same time', async () => {
    const results = await Promise.all([seed([creature('Twice one')]), seed([creature('Twice one')])]);
    expect(await count('Twice one')).toBe(1);
    expect(results.map((result) => result.created).sort()).toEqual([0, 1]);
  });

  it('has the 330 creatures of the document to store by default, every one accepted', async () => {
    // Counted without writing: a seed of the whole set would replace what other suites keep.
    const names = new Set(allMonsters().map((monster) => monster.name));
    expect(names.size).toBe(330);
  });
});
