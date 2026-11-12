/**
 * creatureSeed.ts
 * Fills the creature library with the monsters of the System Reference
 * Document 5.2.1, the 2024 rules. Used by both the CLI script and the API
 * endpoint.
 *
 * The creatures come with the server (rules/dnd/data/srd-5.2.1-monsters.json),
 * so nothing is fetched. SRD 5.2.1 content is used under CC BY 4.0; see
 * SRD_ATTRIBUTION.md.
 *
 * The library used to be filled from Open5e with the 2014 creatures of the
 * SRD 5.1. A seed replaces those: a creature of the same name gets the 2024
 * stat block, and one the 2024 document does not have is removed.
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { NpcStatBlockSchema } from '../validators/statBlock';
import { toJson } from '../utils/prisma-json';
import logger from '../utils/logger';
import { allMonsters } from '../rules/dnd/monsters';

/** A creature as the seed stores it. */
export interface SeedCreature {
  name: string;
  challengeRating: string;
  creatureType: string;
  alignment: string | null;
  size: { width: number; height: number };
  statBlock: unknown;
}

export interface SeedOptions {
  /** The creatures to store. The monsters of the SRD 5.2.1 unless a test gives its own. */
  creatures?: readonly SeedCreature[];
  /**
   * Which of the SRD creatures already stored this seed may replace or
   * remove. All of them, unless a test keeps to its own.
   */
  within?: (name: string) => boolean;
}

export interface SeedResult {
  /** Creatures the seed had to store. Named for the days they were fetched. */
  fetched: number;
  created: number;
  /** Creatures already stored whose stat block was replaced with this one. */
  updated: number;
  /** Creatures already stored with this very stat block. */
  skipped: number;
  /** SRD creatures stored before that this set does not have, and so removed. */
  removed: number;
  alreadyExisted: number;
  /** Creatures whose stat block the Creature Library would refuse, so not stored. */
  rejected: number;
}

/**
 * One lock for every seed, the command-line script's and each backend
 * process's: held while the existing SRD creatures are read and the rest
 * written, so two seeds at once cannot both add the same creature.
 */
const SEED_LOCK_KEY = 703_118_2026;
/** Long enough for a second seed to wait out the first one's writes. */
const SEED_WRITE_TIMEOUT_MS = 120_000;

/** JSON with every object's keys in order: the database stores a stat block's keys in an order of its own. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * Seed the CreatureTemplate table with the SRD 5.2.1 monsters.
 *
 * Safe to call again: a creature stored with the same stat block is left
 * alone. An SRD creature stored under the same name with another stat block
 * (the 2014 one, or an earlier build of this one) is replaced, and an SRD
 * creature this set does not have is removed, with its favourites. Custom
 * creatures are never touched. Each stat block is checked as the Creature
 * Library checks one it is given, and one that fails is left out.
 */
export async function seedSrdCreatures(prisma: PrismaClient, options: SeedOptions = {}): Promise<SeedResult> {
  const creatures = options.creatures ?? allMonsters();
  const within = options.within ?? (() => true);

  // Made ready, and checked, before the lock is taken.
  let rejected = 0;
  const ready = new Map<string, SeedCreature>();
  for (const creature of creatures) {
    const checked = NpcStatBlockSchema.safeParse(creature.statBlock);
    if (!checked.success) {
      rejected++;
      logger.warn(`Left out SRD creature "${creature.name}": ${checked.error.issues[0]?.message ?? 'invalid stat block'}`);
      continue;
    }
    if (!ready.has(creature.name)) ready.set(creature.name, { ...creature, statBlock: checked.data });
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<SeedResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY})`;

    const existing = (
      await tx.creatureTemplate.findMany({
        where: { source: 'srd' },
        select: { id: true, name: true, statBlock: true, challengeRating: true, creatureType: true, alignment: true, size: true },
      })
    ).filter((row) => within(row.name));
    const existingByName = new Map(existing.map((row) => [row.name, row]));

    let updated = 0;
    let skipped = 0;
    const toCreate: Prisma.CreatureTemplateCreateManyInput[] = [];

    for (const creature of ready.values()) {
      const row = existingByName.get(creature.name);
      if (!row) {
        toCreate.push({
          id: randomUUID(),
          name: creature.name,
          gameSystem: 'DND_5E',
          source: 'srd',
          challengeRating: creature.challengeRating,
          creatureType: creature.creatureType,
          alignment: creature.alignment,
          imageUrl: null,
          statBlock: toJson(creature.statBlock),
          size: toJson(creature.size),
          disposition: 'hostile',
          displayMode: 'pog',
          createdById: null,
          campaignId: null,
        });
        continue;
      }
      const unchanged =
        same(row.statBlock, creature.statBlock) &&
        same(row.size, creature.size) &&
        row.challengeRating === creature.challengeRating &&
        row.creatureType === creature.creatureType &&
        row.alignment === creature.alignment;
      if (unchanged) {
        skipped++;
        continue;
      }
      // The picture, the disposition and the look on the map are kept as they were.
      await tx.creatureTemplate.update({
        where: { id: row.id },
        data: {
          statBlock: toJson(creature.statBlock),
          size: toJson(creature.size),
          challengeRating: creature.challengeRating,
          creatureType: creature.creatureType,
          alignment: creature.alignment,
          gameSystem: 'DND_5E',
        },
      });
      updated++;
    }

    const gone = existing.filter((row) => !ready.has(row.name)).map((row) => row.id);
    if (gone.length > 0) await tx.creatureTemplate.deleteMany({ where: { id: { in: gone } } });
    if (toCreate.length > 0) await tx.creatureTemplate.createMany({ data: toCreate });

    return {
      fetched: ready.size + rejected,
      created: toCreate.length,
      updated,
      skipped,
      removed: gone.length,
      alreadyExisted: existingByName.size,
      rejected,
    };
  }, { timeout: SEED_WRITE_TIMEOUT_MS, maxWait: SEED_WRITE_TIMEOUT_MS });
}

/**
 * Check current SRD seed status, and whether what is stored is the 2024 set.
 *
 * The custom count covers what this campaign's library shows: creatures with
 * no campaign plus its own. Another campaign's homebrew is not counted, since
 * any member may ask.
 */
export async function getSrdSeedStatus(
  prisma: PrismaClient,
  campaignId: string,
): Promise<{ srdCount: number; customCount: number; srdOutdated: boolean }> {
  const names = allMonsters().map((monster) => monster.name);
  const [srdCount, current, customCount] = await Promise.all([
    prisma.creatureTemplate.count({ where: { source: 'srd' } }),
    prisma.creatureTemplate.count({ where: { source: 'srd', name: { in: names } } }),
    prisma.creatureTemplate.count({
      where: { source: 'custom', OR: [{ campaignId: null }, { campaignId }] },
    }),
  ]);
  // Stored SRD creatures that are not the 2024 set, name for name, are from an
  // earlier import: the 2014 creatures, or an earlier build of these.
  const srdOutdated = srdCount > 0 && (srdCount !== names.length || current !== names.length);
  return { srdCount, customCount, srdOutdated };
}
