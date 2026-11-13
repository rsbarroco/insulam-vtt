// ============================================
// Class features with a number of uses, by the D&D rules
//
// The features a character spends and gets back on a rest, read from its
// sheet's classes and level (SRD 5.2.1, the class chapters):
//
//   • Second Wind (Fighter 1): uses from the Fighter table's Second Wind
//     column; a Bonus Action that restores 1d10 + Fighter level Hit Points.
//     One use back on a Short Rest, all on a Long Rest.
//   • Action Surge (Fighter 2): one use, two from level 17, once a turn; one
//     more action, not the Magic action. All back on a Short or Long Rest.
//   • Rage (Barbarian 1): uses from the Rages column. One back on a Short
//     Rest, all on a Long Rest. (What a Rage does comes with its own rules.)
//
// A sheet keeps what it has spent in `featureUses`: { "Second Wind": 1 }.
// A gestalt character is both of its classes at its full level.
//
// Pure: a sheet in, what it has and what a rest gives back out.
// ============================================

import { columnAt } from './classes';

export type ResourceName = 'Second Wind' | 'Action Surge' | 'Rage';

export interface Resource {
  name: ResourceName;
  max: number;
  used: number;
  /** What a Short Rest gives back: one use, or all. */
  shortRest: 'one' | 'all';
}

type Sheet = Record<string, unknown>;

/** The classes a sheet's "Fighter / Wizard" names, and its level. */
export function classesOf(sheet: Sheet): { classes: string[]; level: number } {
  const classes =
    typeof sheet.class === 'string'
      ? sheet.class
          .split('/')
          .map((name) => name.trim())
          .filter(Boolean)
      : [];
  const level =
    typeof sheet.level === 'number' && Number.isInteger(sheet.level)
      ? Math.max(1, Math.min(20, sheet.level))
      : 1;
  return { classes, level };
}

const has = (classes: string[], name: string) =>
  classes.some((entry) => entry.toLowerCase() === name.toLowerCase());

function spent(sheet: Sheet, name: ResourceName): number {
  const uses = (sheet.featureUses ?? {}) as Record<string, unknown>;
  const used = uses[name];
  return typeof used === 'number' && Number.isInteger(used) && used > 0 ? used : 0;
}

/** The features with uses a sheet's classes give at its level, with what is spent. */
export function resourcesOf(sheet: Sheet): Resource[] {
  const { classes, level } = classesOf(sheet);
  const out: Resource[] = [];
  const add = (name: ResourceName, max: number, shortRest: 'one' | 'all') => {
    if (max > 0) out.push({ name, max, used: Math.min(max, spent(sheet, name)), shortRest });
  };
  if (has(classes, 'Fighter')) {
    add('Second Wind', Number(columnAt('Fighter', 'Second Wind', level) ?? 0), 'one');
    add('Action Surge', level >= 17 ? 2 : level >= 2 ? 1 : 0, 'all');
  }
  if (has(classes, 'Barbarian'))
    add('Rage', Number(columnAt('Barbarian', 'Rages', level) ?? 0), 'one');
  return out;
}

/** A sheet with one use of a feature spent, or why not. */
export function spendResource(
  sheet: Sheet,
  name: ResourceName
): { ok: true; sheet: Sheet; left: number } | { ok: false; reason: string } {
  const resource = resourcesOf(sheet).find((entry) => entry.name === name);
  if (!resource) return { ok: false, reason: `The sheet has no ${name}` };
  if (resource.used >= resource.max)
    return { ok: false, reason: `No uses of ${name} left until a rest` };
  const uses = {
    ...((sheet.featureUses ?? {}) as Record<string, unknown>),
    [name]: resource.used + 1,
  };
  return {
    ok: true,
    sheet: { ...sheet, featureUses: uses },
    left: resource.max - resource.used - 1,
  };
}

/** What a rest gives back: on a Short Rest one use or all, as each feature says; on a Long Rest, all. */
export function restoreResources(
  sheet: Sheet,
  rest: 'short' | 'long'
): { sheet: Sheet; regained: string[] } {
  const regained: string[] = [];
  const uses: Record<string, number> = {};
  for (const resource of resourcesOf(sheet)) {
    if (resource.used === 0) continue;
    const back = rest === 'long' || resource.shortRest === 'all' ? resource.used : 1;
    if (resource.used - back > 0) uses[resource.name] = resource.used - back;
    regained.push(`${back} ${resource.name}`);
  }
  return { sheet: { ...sheet, featureUses: uses }, regained };
}

/** The damage a Rage adds to a Strength attack, from the Barbarian table's Rage Damage column; 0 without the class. */
export function rageDamage(sheet: Sheet): number {
  const { classes, level } = classesOf(sheet);
  if (!has(classes, 'Barbarian')) return 0;
  return Number((columnAt('Barbarian', 'Rage Damage', level) ?? '0').replace('+', '')) || 0;
}

/** The Hit Points Second Wind restores, before the die: the character's Fighter level. */
export function secondWindBonus(sheet: Sheet): number {
  return classesOf(sheet).level;
}
