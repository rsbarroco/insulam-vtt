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
//   • Indomitable (Fighter 9): one use, two from level 13, three from 17; a
//     failed saving throw rerolled with a bonus of the Fighter level. All back
//     on a Long Rest.
//   • Rage (Barbarian 1): uses from the Rages column. One back on a Short
//     Rest, all on a Long Rest. (What a Rage does comes with its own rules.)
//   • Bardic Inspiration (Bard 1): as many uses as the Charisma modifier, at
//     least one; all back on a Long Rest, and from level 5 (Font of
//     Inspiration) on a Short Rest too. Its die is the Bardic Die column.
//   • Channel Divinity (Cleric 2, Paladin 3): uses from the class's column,
//     the larger for a gestalt of both. One back on a Short Rest, all on a
//     Long Rest.
//   • Wild Shape (Druid 2): uses from the Wild Shape column. One back on a
//     Short Rest, all on a Long Rest.
//   • Focus Points (Monk 2): the Focus Points column; all back on a Short or
//     Long Rest.
//   • Sorcery Points (Sorcerer 2): the Sorcery Points column; all back on a
//     Long Rest.
//   • Lay on Hands (Paladin 1): a pool of five times the Paladin level in
//     Hit Points, spent a point at a time; all back on a Long Rest.
//   • Favored Enemy (Ranger 1): Hunter's Mark cast without a spell slot, as
//     many times as the column says; all back on a Long Rest.
//
// A sheet keeps what it has spent in `featureUses`: { "Second Wind": 1 }.
// A gestalt character is both of its classes at its full level.
//
// Pure: a sheet in, what it has and what a rest gives back out.
// ============================================

import { columnAt } from './classes';
import { hasRelentlessEndurance } from './species';

export type ResourceName =
  | 'Second Wind'
  | 'Action Surge'
  | 'Rage'
  | 'Bardic Inspiration'
  | 'Channel Divinity'
  | 'Wild Shape'
  | 'Focus Points'
  | 'Sorcery Points'
  | 'Favored Enemy'
  | 'Lay on Hands'
  | 'Relentless Endurance'
  | 'Indomitable';

/** The features spent a point at a time, several at once: the rest are spent one use at a time. */
export const POINT_RESOURCES: readonly ResourceName[] = ['Focus Points', 'Sorcery Points', 'Lay on Hands'];

export interface Resource {
  name: ResourceName;
  max: number;
  used: number;
  /** What a Short Rest gives back: one use, all, or none. */
  shortRest: 'one' | 'all' | 'none';
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

/** A sheet's level in one class: its level when the class is among its classes (gestalt: each at full level), else 0. */
export function classLevel(sheet: Sheet, name: string): number {
  const { classes, level } = classesOf(sheet);
  return classes.some((entry) => entry.toLowerCase() === name.toLowerCase()) ? level : 0;
}

/** A number from a class table's column, 0 where it has a dash. */
const count = (name: Parameters<typeof columnAt>[0], column: string, level: number) =>
  Number(columnAt(name, column, level) ?? 0) || 0;

/** An ability modifier from a sheet's stats: the modifier it writes, or one from the score. */
export function abilityModifier(sheet: Sheet, ability: string): number {
  const stat = (sheet.stats as Record<string, { score?: unknown; modifier?: unknown } | undefined> | undefined)?.[ability];
  if (typeof stat?.modifier === 'number') return stat.modifier;
  if (typeof stat?.score === 'number') return Math.floor((stat.score - 10) / 2);
  return 0;
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
  const add = (name: ResourceName, max: number, shortRest: Resource['shortRest']) => {
    if (max > 0) out.push({ name, max, used: Math.min(max, spent(sheet, name)), shortRest });
  };
  if (has(classes, 'Fighter')) {
    add('Second Wind', Number(columnAt('Fighter', 'Second Wind', level) ?? 0), 'one');
    add('Action Surge', level >= 17 ? 2 : level >= 2 ? 1 : 0, 'all');
    add('Indomitable', level >= 17 ? 3 : level >= 13 ? 2 : level >= 9 ? 1 : 0, 'none');
  }
  if (has(classes, 'Barbarian'))
    add('Rage', Number(columnAt('Barbarian', 'Rages', level) ?? 0), 'one');
  if (has(classes, 'Bard'))
    add('Bardic Inspiration', Math.max(1, abilityModifier(sheet, 'charisma')), level >= 5 ? 'all' : 'none');
  const divinity = Math.max(
    has(classes, 'Cleric') ? count('Cleric', 'Channel Divinity', level) : 0,
    has(classes, 'Paladin') ? count('Paladin', 'Channel Divinity', level) : 0
  );
  add('Channel Divinity', divinity, 'one');
  if (has(classes, 'Paladin')) add('Lay on Hands', 5 * level, 'none');
  if (has(classes, 'Druid')) add('Wild Shape', count('Druid', 'Wild Shape', level), 'one');
  if (has(classes, 'Monk')) add('Focus Points', count('Monk', 'Focus Points', level), 'all');
  if (has(classes, 'Sorcerer')) add('Sorcery Points', count('Sorcerer', 'Sorcery Points', level), 'none');
  // A species trait used once until a Long Rest.
  if (hasRelentlessEndurance(sheet)) add('Relentless Endurance', 1, 'none');
  if (has(classes, 'Ranger')) add('Favored Enemy', count('Ranger', 'Favored Enemy', level), 'none');
  return out;
}

/** A sheet with `amount` uses (or points) of a feature spent, or why not. */
export function spendResource(
  sheet: Sheet,
  name: ResourceName,
  amount = 1
): { ok: true; sheet: Sheet; left: number } | { ok: false; reason: string } {
  const resource = resourcesOf(sheet).find((entry) => entry.name === name);
  if (!resource) return { ok: false, reason: `The sheet has no ${name}` };
  if (resource.used >= resource.max)
    return { ok: false, reason: `No uses of ${name} left until a rest` };
  if (resource.used + amount > resource.max)
    return { ok: false, reason: `Only ${resource.max - resource.used} ${name} left` };
  const uses = {
    ...((sheet.featureUses ?? {}) as Record<string, unknown>),
    [name]: resource.used + amount,
  };
  return {
    ok: true,
    sheet: { ...sheet, featureUses: uses },
    left: resource.max - resource.used - amount,
  };
}

/** The die a Bard's Bardic Inspiration gives at its level: "d6". */
export function bardicDie(sheet: Sheet): string | null {
  const { classes, level } = classesOf(sheet);
  if (!has(classes, 'Bard')) return null;
  return (columnAt('Bard', 'Bardic Die', level) ?? 'D6').toLowerCase();
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
    if (rest === 'short' && resource.shortRest === 'none') {
      uses[resource.name] = resource.used;
      continue;
    }
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
