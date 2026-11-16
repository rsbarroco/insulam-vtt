// ============================================
// A Fighter's always-on features, by the D&D rules (2024 revision, SRD 5.2.1)
//
// The ones here ask no choice of the player; the server applies them when
// the sheet lists the feature:
//
//   • Improved Critical (Champion 3): attack rolls with weapons and Unarmed
//     Strikes score a Critical Hit on a 19 or 20 on the d20. Superior Critical
//     (Champion 15): on an 18, 19 or 20. Only a 20 hits whatever the Armor
//     Class; an 18 or 19 that misses is a miss.
//   • Remarkable Athlete (Champion 3): Advantage on Initiative rolls and on
//     Strength (Athletics) checks. The half-Speed move after a Critical Hit is
//     the table's.
//   • Dueling (Fighting Style): +2 to damage rolls with a Melee weapon held in
//     one hand while no other weapon is held. The server cannot see hands; it
//     reads them from the sheet (see `duelingBonus`).
//   • Studied Attacks (Fighter 13): after an attack roll that misses a
//     creature, Advantage on the Fighter's next attack roll against it before
//     the end of the Fighter's next turn. Kept as a mark on the fight.
//   • Survivor (Champion 18): Defy Death — Advantage on Death Saving Throws,
//     and an 18, 19 or 20 on one counts as a 20; Heroic Rally — at the start
//     of each of its turns, a Bloodied Champion with at least 1 Hit Point
//     regains 5 + its Constitution modifier.
//
// Pure.
// ============================================

import { findSrdWeapon, hasWeaponProperty } from '../../utils/srdWeapons';
import type { CombatAction } from './actions';
import { hasFeature } from './featureEffects';
import { hasFeat } from './feats';

type Features = ReadonlyArray<{ name: string }>;

/** An attack roll with a weapon or an Unarmed Strike: not a spell's. */
const weaponOrUnarmed = (action: CombatAction) =>
  action.attack !== undefined && action.source !== 'spell' && action.spell === undefined;

/**
 * The lowest d20 that makes this attack's hit a Critical Hit: 20, 19 with
 * Improved Critical, 18 with Superior Critical, for weapons and Unarmed Strikes.
 */
export function criticalFrom(features: Features, action: CombatAction): number {
  if (!weaponOrUnarmed(action)) return 20;
  if (hasFeature(features, 'Superior Critical')) return 18;
  if (hasFeature(features, 'Improved Critical')) return 19;
  return 20;
}

/** Whether the sheet lists a Champion's Remarkable Athlete. */
export function hasRemarkableAthlete(features: Features): boolean {
  return hasFeature(features, 'Remarkable Athlete');
}

/**
 * What Dueling adds to this attack's damage: 2 with a Melee weapon that is
 * not Two-Handed, when the inventory has no other weapon equipped. An attack
 * the reference document does not know as a weapon counts when it is a melee
 * attack from the sheet. A Versatile weapon swung with two hands is not
 * something the server can see.
 */
export function duelingBonus(
  features: Features,
  action: CombatAction,
  inventory: ReadonlyArray<{ name: string; equipped: boolean }>
): number {
  const profile = action.attack;
  if (!profile || action.source !== 'sheet' || action.unarmed || profile.twoHanded) return 0;
  const weapon = findSrdWeapon(action.weapon ?? action.name);
  if (weapon ? weapon.kind !== 'melee' || hasWeaponProperty(weapon, 'two-handed') : profile.kind !== 'melee') return 0;
  if (!hasFeat(features, 'Dueling')) return 0;
  const other = inventory.some((item) => {
    if (!item.equipped) return false;
    const held = findSrdWeapon(item.name);
    return held !== null && held.name !== weapon?.name;
  });
  return other ? 0 : 2;
}

/** A sheet's inventory as Dueling reads it: each item's name and whether it is equipped. */
export function readInventory(sheet: { inventory?: unknown } | null | undefined): Array<{ name: string; equipped: boolean }> {
  const list = Array.isArray(sheet?.inventory) ? sheet.inventory : [];
  return list.flatMap((entry) => {
    const item = (entry ?? {}) as { name?: unknown; equipped?: unknown; quantity?: unknown };
    if (typeof item.name !== 'string' || item.quantity === 0) return [];
    return [{ name: item.name, equipped: item.equipped === true }];
  });
}

/** The action with a flat bonus added to its first damage line. */
export function withDamageBonus(action: CombatAction, bonus: number): CombatAction {
  const profile = action.attack;
  if (!profile || bonus === 0 || profile.damage.length === 0) return action;
  const [first, ...rest] = profile.damage;
  return {
    ...action,
    attack: { ...profile, damage: [{ ...first, roll: { ...first.roll, bonus: (first.roll.bonus ?? 0) + bonus } }, ...rest] },
  };
}

/** Whether the sheet lists the Fighter's Studied Attacks. */
export function hasStudiedAttacks(features: Features): boolean {
  return hasFeature(features, 'Studied Attacks');
}

/** Whether the sheet lists a Champion's Survivor. */
export function hasSurvivor(features: Features): boolean {
  return hasFeature(features, 'Survivor');
}

/** Defy Death: how a Survivor rolls its Death Saving Throws. */
export const DEFY_DEATH = { advantage: true, reviveFrom: 18 } as const;

/**
 * Heroic Rally: the Hit Points a Survivor regains at the start of its turn,
 * 5 + its Constitution modifier while it is Bloodied (half its Hit Points or
 * fewer) and has at least 1; 0 otherwise.
 */
export function heroicRally(hp: { current: number; max: number }, conModifier: number): number {
  if (hp.current < 1 || hp.current * 2 > hp.max) return 0;
  return Math.max(0, Math.min(5 + conModifier, hp.max - hp.current));
}
