// ============================================
// A Druid's Wild Shape, by the D&D rules (SRD 5.2.1)
//
// As a Bonus Action, a use of Wild Shape turns the Druid into a Beast: one of
// Challenge Rating 1/4 or lower without a Fly Speed from Druid 2, 1/2 from
// level 4, 1 (and a Fly Speed allowed) from level 8. It gains Temporary Hit
// Points equal to its Druid level. The Beast's stat block replaces its game
// statistics, but it keeps its Hit Points, its mental scores, its class
// features and its proficiencies, using the better of a skill or save
// modifier; it cannot cast spells.
//
// The known forms (four, chosen on a Long Rest) are the table's: every Beast
// of the SRD the Druid's level allows is offered.
// ============================================

import { allMonsters, challengeNumber, findMonster, type Monster } from './monsters';
import { classLevel } from './resources';

type Sheet = Record<string, unknown>;

/** The largest Challenge Rating a Druid of this level can take, and whether the form may fly. */
export function wildShapeLimit(level: number): { maxCr: number; fly: boolean } | null {
  if (level >= 8) return { maxCr: 1, fly: true };
  if (level >= 4) return { maxCr: 0.5, fly: false };
  if (level >= 2) return { maxCr: 0.25, fly: false };
  return null;
}

const isBeast = (monster: Monster) => /\bbeast\b/i.test(monster.creatureType);
const flies = (monster: Monster) => /\bfly\b/i.test(monster.statBlock.speed ?? '');

/** The Beasts a Druid's sheet can take the form of, by name, lowest Challenge Rating first. */
export function wildShapeForms(sheet: Sheet): string[] {
  const limit = wildShapeLimit(classLevel(sheet, 'Druid'));
  if (!limit) return [];
  return allMonsters()
    .filter((monster) => isBeast(monster) && challengeNumber(monster.challengeRating) <= limit.maxCr && (limit.fly || !flies(monster)))
    .sort((a, b) => challengeNumber(a.challengeRating) - challengeNumber(b.challengeRating) || a.name.localeCompare(b.name))
    .map((monster) => monster.name);
}

/** The Beast a token has taken the form of with Wild Shape, kept in its metadata; null when it has none. */
export function wildShapeOf(token: { metadata?: Record<string, unknown> | null }): Monster | null {
  const name = token.metadata?.wildShape;
  return typeof name === 'string' ? findMonster(name) : null;
}

/** The Temporary Hit Points a Druid gains when it takes a form: its Druid level. */
export function wildShapeTemporaryHitPoints(sheet: Sheet): number {
  return classLevel(sheet, 'Druid');
}
