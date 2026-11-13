// ============================================
// The extra attacks a weapon gives, by the D&D rules
//
// SRD 5.2.1, Equipment:
//
//   • Light: when you take the Attack action on your turn and attack with a
//     Light weapon, you can make one extra attack as a Bonus Action later on
//     the same turn with a different Light weapon, without adding your
//     ability modifier to its damage unless it is negative.
//   • Nick (mastery): that extra attack is made as part of the Attack action
//     instead of as a Bonus Action, once per turn.
//   • Cleave (mastery): when you hit a creature with a melee attack roll
//     using the weapon, you can make a melee attack roll with it against a
//     second creature within 5 feet of the first that is also within your
//     reach. On a hit it takes the weapon's damage without your ability
//     modifier unless that modifier is negative. Once per turn.
//
// The Two-Weapon Fighting style (a Fighting Style feat) adds the modifier to
// the Light extra attack after all.
//
// Pure: the caller keeps what the turn has done.
// ============================================

import type { CombatAction } from './actions';

export type ExtraAttack = 'cleave' | 'light' | 'flurry';

/** The extra attacks an action can be made as: Cleave for a weapon whose mastery it uses, Light for a Light weapon. */
export function extrasOf(action: CombatAction): ExtraAttack[] {
  // An Unarmed Strike can be one of Flurry of Blows' two.
  if (action.unarmed === 'damage') return ['flurry'];
  if (!action.attack || action.source === 'spell' || action.source === 'unarmed') return [];
  const out: ExtraAttack[] = [];
  if (action.mastery === 'Cleave' && action.attack.kind === 'melee') out.push('cleave');
  if (action.attack.light) out.push('light');
  return out;
}

/** The action with a positive ability modifier taken off its first damage line; a negative one stays. */
export function withoutAbilityModifier(action: CombatAction, modifier: number): CombatAction {
  const profile = action.attack;
  if (!profile || modifier <= 0 || profile.damage.length === 0) return action;
  const [first, ...rest] = profile.damage;
  const bonus = (first.roll.bonus ?? 0) - modifier;
  return {
    ...action,
    attack: { ...profile, damage: [{ ...first, roll: { ...first.roll, bonus } }, ...rest] },
  };
}

/** Whether a sheet's features include the Two-Weapon Fighting style. */
export function hasTwoWeaponFighting(features: ReadonlyArray<{ name: string }>): boolean {
  return features.some((feature) => /two[- ]weapon fighting/i.test(feature.name));
}
