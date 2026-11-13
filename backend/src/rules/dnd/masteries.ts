// ============================================
// Weapon masteries, by the D&D rules
//
// A character with a feature such as Weapon Mastery uses the mastery
// property of the kinds of weapons it chose (SRD 5.2.1, "Mastery
// Properties"; the definitions are in utils/srdWeapons.ts). These are the
// ones that act at once on the attack that triggers them:
//
//   • Topple: on a hit, a Constitution saving throw against DC 8 + the
//     attack's ability modifier + Proficiency Bonus, or the target is Prone.
//   • Push: on a hit, the target, if Large or smaller, is pushed up to 10
//     feet straight away.
//   • Graze: on a miss, the target takes damage equal to the attack's
//     ability modifier, of the weapon's type.
//
// Pure: what the mastery does; the caller applies it.
// ============================================

import type { WeaponMastery } from '../../utils/srdWeapons';
import { findSrdWeapon, hasWeaponProperty } from '../../utils/srdWeapons';

/** Whether a sheet's features include one that unlocks weapon masteries. */
export function hasWeaponMastery(features: ReadonlyArray<{ name: string }>): boolean {
  return features.some((feature) => /^weapon mastery\b/i.test(feature.name.trim()));
}

/** The ability modifier an attack with this SRD weapon uses: Strength, Dexterity, or the better with Finesse. */
export function weaponModifier(weaponName: string, scores: { str: number; dex: number }): number {
  const weapon = findSrdWeapon(weaponName);
  if (!weapon) return scores.str;
  if (hasWeaponProperty(weapon, 'finesse')) return Math.max(scores.str, scores.dex);
  return weapon.kind === 'ranged' ? scores.dex : scores.str;
}

export type MasteryEffect =
  | { kind: 'topple'; dc: number }
  | { kind: 'push'; squares: number }
  | { kind: 'graze'; damage: number; type: string }
  | null;

/**
 * What a mastery does on this attack, if anything: Topple and Push on a hit,
 * Graze on a miss. Push moves only a target no more than two squares across
 * (Large or smaller). The rest are the table's to apply for now.
 */
export function masteryEffect(
  mastery: WeaponMastery,
  outcome: { hit: boolean },
  wielder: { modifier: number; proficiencyBonus: number },
  target: { squares: number },
  weaponName: string,
  feetPerSquare = 5
): MasteryEffect {
  if (mastery === 'Topple' && outcome.hit)
    return { kind: 'topple', dc: 8 + wielder.modifier + wielder.proficiencyBonus };
  if (mastery === 'Push' && outcome.hit && target.squares <= 2)
    return { kind: 'push', squares: Math.max(1, Math.floor(10 / feetPerSquare)) };
  if (mastery === 'Graze' && !outcome.hit && wielder.modifier > 0) {
    return {
      kind: 'graze',
      damage: wielder.modifier,
      type: findSrdWeapon(weaponName)?.damageType ?? 'slashing',
    };
  }
  return null;
}
