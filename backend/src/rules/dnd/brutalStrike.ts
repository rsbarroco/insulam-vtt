// ============================================
// Brutal Strike (Barbarian 9), by the D&D rules (SRD 5.2.1)
//
// On a turn it attacks recklessly, the Barbarian can forgo any Advantage on
// one Strength-based attack roll that has no Disadvantage. If that roll hits,
// the target takes an extra 1d10 damage of the weapon's type (2d10 from level
// 17) and one Brutal Strike effect:
//
//   • Forceful Blow: the target is pushed 15 feet straight away.
//   • Hamstring Blow: the target's Speed is 15 feet lower until the start of
//     the Barbarian's next turn (only the most recent one counts).
//
// The level 13 effects (Staggering Blow, Sundering Blow) are the table's.
// ============================================

import type { DamageComponent } from './actions';
import type { DamageType } from './damage';
import { classLevel } from './resources';

type Sheet = Record<string, unknown>;

export type BrutalEffect = 'forceful' | 'hamstring';

/** How far Forceful Blow pushes, and what Hamstring Blow takes off a Speed. */
export const FORCEFUL_FEET = 15;
export const HAMSTRING_FEET = 15;

/** The extra damage of a Brutal Strike: 1d10 of the weapon's type, 2d10 from Barbarian 17. */
export function brutalStrikeDamage(sheet: Sheet, type: DamageType | null): DamageComponent {
  return { roll: { count: classLevel(sheet, 'Barbarian') >= 17 ? 2 : 1, sides: 10 }, type: type ?? 'bludgeoning' };
}

export const BRUTAL_LABELS: Readonly<Record<BrutalEffect, string>> = {
  forceful: 'Forceful Blow',
  hamstring: 'Hamstring Blow',
};
