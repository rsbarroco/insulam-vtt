// ============================================
// Sneak Attack, by the D&D rules
//
// SRD 5.2.1, Rogue 1: once on each turn, a Rogue who hits a creature with an
// attack roll using a Finesse or a Ranged weapon deals extra damage, the
// Rogue table's Sneak Attack column, of the weapon's damage type, if
//
//   • the attack roll has Advantage, or
//   • an ally of the Rogue is within 5 feet of the target, that ally is not
//     Incapacitated, and the attack roll does not have Disadvantage.
//
// The dice are doubled on a Critical Hit, like every damage die of the attack.
// A gestalt character is a Rogue of its full level.
//
// Pure: the caller says who stands where; nothing here reads or writes.
// ============================================

import type { CombatAction, DamageComponent } from './actions';
import { columnAt } from './classes';
import type { RollMode } from './d20';
import { classesOf } from './resources';

type Sheet = Record<string, unknown>;

/** How many d6 a sheet's Sneak Attack rolls; 0 for a character who is no Rogue. */
export function sneakAttackDice(sheet: Sheet | null): number {
  if (!sheet) return 0;
  const { classes, level } = classesOf(sheet);
  if (!classes.some((name) => name.toLowerCase() === 'rogue')) return 0;
  const dice = /^(\d+)d6$/.exec(columnAt('Rogue', 'Sneak Attack', level) ?? '');
  return dice ? Number(dice[1]) : 0;
}

/** Whether an action is an attack with a Finesse or a Ranged weapon: not a spell, nor an Unarmed Strike. */
export function sneakAttackWeapon(action: CombatAction): boolean {
  if (!action.attack || action.source === 'spell' || action.source === 'unarmed' || action.unarmed)
    return false;
  return action.attack.finesse === true || action.attack.kind === 'ranged';
}

/**
 * The extra damage of a Sneak Attack for an attack rolled with `mode`, or
 * null when this roll gives none: no Advantage and no ally beside the
 * target, or Disadvantage with only the ally.
 */
export function sneakAttackDamage(
  dice: number,
  action: CombatAction,
  mode: RollMode,
  allyBesideTarget: boolean
): DamageComponent | null {
  if (dice <= 0 || !sneakAttackWeapon(action)) return null;
  if (!(mode === 'advantage' || (allyBesideTarget && mode !== 'disadvantage'))) return null;
  return {
    roll: { count: dice, sides: 6, bonus: 0 },
    type: action.attack?.damage[0]?.type ?? null,
  };
}
