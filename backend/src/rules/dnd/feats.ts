// ============================================
// What a character's feats do in play, by the D&D rules
//
// SRD 5.2.1, Feats, the ones the VTT applies:
//
//   • Alert (Origin): Proficiency Bonus added to Initiative, written onto the
//     sheet when the character is built.
//   • Savage Attacker (Origin): once per turn, on a hit with a weapon, its
//     damage dice are rolled twice and the better roll is used.
//   • Archery (Fighting Style): +2 to attack rolls with Ranged weapons.
//   • Great Weapon Fighting (Fighting Style): a 1 or 2 on a damage die of a
//     Melee weapon attack with a Two-Handed weapon counts as a 3.
//   • Two-Weapon Fighting is applied with the Light weapon's extra attack.
//
// A sheet lists feats among its features, however it writes them:
// "Savage Attacker (Origin feat)", "Fighting Style: Archery".
//
// Pure.
// ============================================

import type { CombatAction } from './actions';
import type { RollDie } from './d20';

/** Whether a sheet's features name a feat. */
export function hasFeat(features: ReadonlyArray<{ name: string }>, feat: string): boolean {
  const wanted = feat.toLowerCase().replace(/[-\s]+/g, ' ');
  return features.some((feature) => {
    const name = feature.name.toLowerCase().replace(/[-\s]+/g, ' ');
    return (
      name === wanted ||
      name.startsWith(`${wanted} (`) ||
      name.endsWith(`: ${wanted}`) ||
      name.includes(`style: ${wanted}`)
    );
  });
}

const weaponAttack = (action: CombatAction) =>
  action.attack !== undefined &&
  action.source !== 'spell' &&
  action.source !== 'unarmed' &&
  !action.unarmed;

/** The bonus Archery adds to an attack: +2 with a Ranged weapon. */
export function archeryBonus(
  features: ReadonlyArray<{ name: string }>,
  action: CombatAction
): number {
  return weaponAttack(action) && action.attack!.kind === 'ranged' && hasFeat(features, 'Archery')
    ? 2
    : 0;
}

/** Whether Great Weapon Fighting counts a 1 or 2 as a 3 on this attack's damage. */
export function greatWeaponFighting(
  features: ReadonlyArray<{ name: string }>,
  action: CombatAction
): boolean {
  return (
    weaponAttack(action) &&
    action.attack!.kind === 'melee' &&
    action.attack!.twoHanded === true &&
    hasFeat(features, 'Great Weapon Fighting')
  );
}

/** Whether an attack is one Savage Attacker can reroll the damage of: a weapon's. */
export function savageAttackerApplies(
  features: ReadonlyArray<{ name: string }>,
  action: CombatAction
): boolean {
  return weaponAttack(action) && hasFeat(features, 'Savage Attacker');
}

/** A damage roller that counts a 1 or 2 as a 3. */
export function atLeastThree(roll: RollDie): RollDie {
  return (sides) => Math.max(3, roll(sides));
}
