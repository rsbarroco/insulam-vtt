// ============================================
// Monk features past the basics, by the D&D rules (SRD 5.2.1)
//
//   • Martial Arts die: the Martial Arts column of the Monk table (1d6 to
//     1d12).
//   • Deflect Attacks, the redirect (Monk 3): when the reduction brings the
//     damage to 0, the Monk can spend 1 Focus Point; a creature within 5 feet
//     (a melee attack) or 60 feet (a ranged one) makes a Dexterity save or
//     takes two rolls of the Martial Arts die + the Monk's Dexterity modifier,
//     of the attack's damage type.
//   • Slow Fall (Monk 4): a Reaction that takes five times the Monk level off
//     the damage of a fall.
//   • Heightened Focus (Monk 10): Flurry of Blows makes three Unarmed Strikes;
//     Patient Defense with a Focus Point gives Temporary Hit Points equal to
//     two rolls of the Martial Arts die.
//   • Self-Restoration (Monk 10): at the end of each of its turns, the Monk
//     can end one of Charmed, Frightened or Poisoned on itself.
//   • Disciplined Survivor (Monk 14): a failed saving throw rolled again for
//     1 Focus Point; the new roll stands.
//   • Open Hand Technique (Warrior of the Open Hand 3): a hit with a Flurry
//     of Blows strike imposes one of Addle (no Opportunity Attacks until the
//     start of the target's next turn), Push (Strength save or pushed 15
//     feet) or Topple (Dexterity save or Prone).
//   • Wholeness of Body (Warrior of the Open Hand 6): a Bonus Action that
//     restores the Martial Arts die + Wisdom modifier Hit Points (at least 1),
//     as many times as the Wisdom modifier (at least once) until a Long Rest.
//
// The saves are against 8 + Wisdom modifier + Proficiency Bonus
// (`monkSaveDC`).
//
// Pure: a sheet in, numbers out.
// ============================================

import { columnAt } from './classes';
import { abilityModifier, classLevel } from './resources';

type Sheet = Record<string, unknown>;

/** The sides of a Monk's Martial Arts die at its level: 6, 8, 10 or 12. */
export function martialArtsDie(sheet: Sheet): number {
  const level = classLevel(sheet, 'Monk');
  const die = level > 0 ? columnAt('Monk', 'Martial Arts', level) : null;
  return Number(/d(\d+)/i.exec(die ?? '')?.[1]) || 6;
}

/** How far the Monk can send a deflected attack: 5 feet for a melee attack, 60 for a ranged one. */
export const REDIRECT_MELEE_FEET = 5;
export const REDIRECT_RANGED_FEET = 60;

/** What a redirected attack deals to a creature that fails its Dexterity save: two Martial Arts dice + Dexterity modifier. */
export function redirectDamage(sheet: Sheet): { count: number; sides: number; bonus: number } {
  return { count: 2, sides: martialArtsDie(sheet), bonus: abilityModifier(sheet, 'dexterity') };
}

/** What Slow Fall takes off a fall's damage: five times the Monk level. */
export function slowFallReduction(sheet: Sheet): number {
  return 5 * classLevel(sheet, 'Monk');
}

/** The Hit Points Wholeness of Body restores for a roll of the Martial Arts die: the roll + Wisdom modifier, at least 1. */
export function wholenessOfBodyHealing(sheet: Sheet, rolled: number): number {
  return Math.max(1, rolled + abilityModifier(sheet, 'wisdom'));
}

/** The conditions Self-Restoration can end, in the order the rule lists them. */
export const SELF_RESTORATION_CONDITIONS = ['Charmed', 'Frightened', 'Poisoned'] as const;

/** Which of a creature's conditions Self-Restoration can end, named as the rule names them. */
export function selfRestorable(conditions: readonly string[]): string[] {
  const carried = new Set(conditions.map((name) => name.trim().toLowerCase()));
  return SELF_RESTORATION_CONDITIONS.filter((name) => carried.has(name.toLowerCase()));
}

/** The three effects of Open Hand Technique. */
export const OPEN_HAND_OPTIONS = ['Addle', 'Push', 'Topple'] as const;
export type OpenHandOption = (typeof OPEN_HAND_OPTIONS)[number];

/** How far Open Hand Technique's Push sends a creature that fails its Strength save. */
export const OPEN_HAND_PUSH_FEET = 15;

/** The Unarmed Strikes Flurry of Blows gives: two, or three with Heightened Focus. */
export function flurryStrikes(heightened: boolean): number {
  return heightened ? 3 : 2;
}
