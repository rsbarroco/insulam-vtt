// ============================================
// Barbarian features and the Path of the Berserker, by the D&D rules (SRD 5.2.1)
//
// What a Rage does (Resistance, Rage Damage, Advantage on Strength checks and
// saves), Reckless Attack, Danger Sense and Brutal Strike have their own
// places. Here:
//
//   • Primal Knowledge (Barbarian 3): while raging, an Acrobatics,
//     Intimidation, Perception, Stealth or Survival check can be made as a
//     Strength check.
//   • Relentless Rage (Barbarian 11): dropping to 0 Hit Points while raging,
//     without dying outright, the Barbarian can make a DC 10 Constitution
//     save; on a success its Hit Points become twice its Barbarian level. The
//     DC goes up by 5 with each use, and is 10 again after a Short or Long Rest.
//   • Persistent Rage (Barbarian 15): a Rage lasts 10 minutes without being
//     extended from round to round; once until a Long Rest, all uses of Rage
//     come back when Initiative is rolled.
//   • Indomitable Might (Barbarian 18): a Strength check or Strength save
//     whose total is less than the Strength score uses the score instead.
//   • Frenzy (Berserker 3): on a turn it attacks recklessly while raging, the
//     first target it hits with a Strength-based attack takes extra d6s, as
//     many as its Rage Damage bonus, of the weapon's type.
//   • Mindless Rage (Berserker 6): Immunity to the Charmed and Frightened
//     conditions while raging; both end on entering a Rage.
//   • Retaliation (Berserker 10): damaged by a creature within 5 feet, a
//     Reaction to make one melee attack against it.
//   • Intimidating Presence (Berserker 14): a Bonus Action; each creature of
//     the Berserker's choice in a 30-foot Emanation makes a Wisdom save (DC 8
//     + Strength modifier + Proficiency Bonus) or is Frightened for 1 minute,
//     repeating the save at the end of each of its turns. Once until a Long
//     Rest, or again for a use of Rage.
//
// Pure: a sheet in, numbers and actions out.
// ============================================

import type { CombatAction, DamageComponent } from './actions';
import type { DamageType } from './damage';
import { hasFeature, readFeatures } from './featureEffects';
import { abilityModifier, classLevel, rageDamage, resourcesOf } from './resources';

type Sheet = Record<string, unknown>;

const has = (sheet: Sheet | null | undefined, name: string) => !!sheet && hasFeature(readFeatures(sheet), name);

// ── Relentless Rage ─────────────────────────────────────────────────────────

/** Where a sheet's `featureUses` counts the uses of Relentless Rage since the last rest: any rest clears it. */
export const RELENTLESS_RAGE = 'Relentless Rage';

function relentlessUses(sheet: Sheet): number {
  const used = ((sheet.featureUses ?? {}) as Record<string, unknown>)[RELENTLESS_RAGE];
  return typeof used === 'number' && Number.isInteger(used) && used > 0 ? used : 0;
}

/** The DC of the Constitution save: 10, and 5 more for each use since the last Short or Long Rest. */
export function relentlessRageDC(sheet: Sheet): number {
  return 10 + 5 * relentlessUses(sheet);
}

/** The Hit Points a successful save leaves: twice the Barbarian level, no more than the maximum. */
export function relentlessRageHitPoints(sheet: Sheet, max: number): number {
  return Math.max(1, Math.min(max, 2 * classLevel(sheet, 'Barbarian')));
}

/**
 * Whether Relentless Rage answers this damage: a raging Barbarian with the
 * feature, above 0 Hit Points before, at 0 after, and not killed outright
 * (the damage past 0 is less than its Hit Point maximum).
 */
export function relentlessRageApplies(
  sheet: Sheet | null,
  raging: boolean,
  before: { current: number; max: number; temp: number } | null,
  dealt: number
): boolean {
  if (!raging || !sheet || !before || !has(sheet, RELENTLESS_RAGE) || classLevel(sheet, 'Barbarian') <= 0) return false;
  if (before.current <= 0) return false;
  const past = dealt - before.current - before.temp;
  return past >= 0 && past < before.max;
}

/** The sheet with one more use of Relentless Rage counted. */
export function withRelentlessRageUsed(sheet: Sheet): Sheet {
  return { ...sheet, featureUses: { ...((sheet.featureUses ?? {}) as Record<string, unknown>), [RELENTLESS_RAGE]: relentlessUses(sheet) + 1 } };
}

// ── Persistent Rage ─────────────────────────────────────────────────────────

/** How many of the Barbarian's turns a Persistent Rage lasts: 10 minutes. */
export const PERSISTENT_RAGE_TURNS = 100;

export function hasPersistentRage(sheet: Sheet | null): boolean {
  return has(sheet, 'Persistent Rage');
}

/** The sheet with every use of Rage back, as Persistent Rage gives when Initiative is rolled. */
export function withRagesRegained(sheet: Sheet): Sheet {
  const uses = { ...((sheet.featureUses ?? {}) as Record<string, unknown>) };
  delete uses.Rage;
  return { ...sheet, featureUses: uses };
}

// ── Indomitable Might, Primal Knowledge ─────────────────────────────────────

/** The total of a Strength check or save with Indomitable Might: the Strength score when the total is less. Null when nothing changes. */
export function indomitableMight(sheet: Sheet | null, total: number): number | null {
  if (!has(sheet, 'Indomitable Might')) return null;
  const score = (sheet!.stats as Record<string, { score?: unknown } | undefined> | undefined)?.strength?.score;
  return typeof score === 'number' && total < score ? score : null;
}

/** The skills Primal Knowledge lets a raging Barbarian use Strength for. */
export const PRIMAL_KNOWLEDGE_SKILLS: readonly string[] = ['acrobatics', 'intimidation', 'perception', 'stealth', 'survival'];

/** Whether a raging Barbarian's check with this skill can be made as a Strength check. */
export function primalKnowledgeApplies(sheet: Sheet | null, raging: boolean, skill: string): boolean {
  return raging && has(sheet, 'Primal Knowledge') && PRIMAL_KNOWLEDGE_SKILLS.includes(skill);
}

// ── Frenzy ──────────────────────────────────────────────────────────────────

/** Frenzy's extra damage: as many d6s as the Rage Damage bonus, of the weapon's type. Null without the feature. */
export function frenzyDamage(sheet: Sheet | null, type: DamageType | null): DamageComponent | null {
  if (!sheet || !has(sheet, 'Frenzy')) return null;
  const count = rageDamage(sheet);
  return count > 0 ? { roll: { count, sides: 6 }, type: type ?? 'bludgeoning' } : null;
}

// ── Mindless Rage ───────────────────────────────────────────────────────────

/** The conditions a Mindless Rage is immune to. */
export const MINDLESS_RAGE_CONDITIONS: readonly string[] = ['Charmed', 'Frightened'];

/** Whether a raging creature's Mindless Rage keeps this condition off it. */
export function mindlessRageBlocks(sheet: Sheet | null, raging: boolean, condition: string): boolean {
  return raging && has(sheet, 'Mindless Rage') && MINDLESS_RAGE_CONDITIONS.some((name) => name.toLowerCase() === condition.toLowerCase());
}

export function hasMindlessRage(sheet: Sheet | null): boolean {
  return has(sheet, 'Mindless Rage');
}

// ── Retaliation ─────────────────────────────────────────────────────────────

export function hasRetaliation(sheet: Sheet | null): boolean {
  return has(sheet, 'Retaliation');
}

// ── Intimidating Presence ───────────────────────────────────────────────────

export const INTIMIDATING_PRESENCE = 'Intimidating Presence';
export const INTIMIDATING_PRESENCE_FEET = 30;

/** The save DC: 8 + Strength modifier + Proficiency Bonus. */
export function intimidatingPresenceDC(sheet: Sheet): number {
  const proficiency = typeof sheet.proficiencyBonus === 'number' ? sheet.proficiencyBonus : 2;
  return 8 + abilityModifier(sheet, 'strength') + proficiency;
}

/**
 * Intimidating Presence among a sheet's actions: with its own use while it
 * has it, and after that for a use of Rage while one is left.
 */
export function intimidatingPresenceActions(sheet: Sheet): CombatAction[] {
  if (!has(sheet, INTIMIDATING_PRESENCE)) return [];
  const resources = resourcesOf(sheet);
  const left = (name: string) => {
    const found = resources.find((entry) => entry.name === name);
    return found ? found.max - found.used : 0;
  };
  const spends = left(INTIMIDATING_PRESENCE) > 0 ? ('Intimidating Presence' as const) : left('Rage') > 0 ? ('Rage' as const) : null;
  if (!spends) return [];
  return [
    {
      name: spends === 'Rage' ? `${INTIMIDATING_PRESENCE} (a use of Rage)` : INTIMIDATING_PRESENCE,
      cost: 'bonusAction',
      source: 'sheet',
      // Creatures of the Berserker's choice within the Emanation: targets are picked, as for Turn Undead.
      rangeFeet: INTIMIDATING_PRESENCE_FEET,
      presence: spends,
      text: 'A Bonus Action: each creature of your choice in a 30-foot Emanation makes a Wisdom save or is Frightened for 1 minute, repeating the save at the end of each of its turns. Once until a Long Rest, or again for a use of Rage.',
      save: { ability: 'wis', dc: intimidatingPresenceDC(sheet), halfOnSuccess: false, damage: [] },
    },
  ];
}
