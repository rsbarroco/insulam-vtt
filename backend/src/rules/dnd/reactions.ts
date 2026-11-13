// ============================================
// Reactions that answer a hit, by the D&D rules (SRD 5.2.1)
//
// Uncanny Dodge (Rogue 5) halves the hit's damage; Deflect Attacks (Monk 3)
// takes 1d10 + the Monk's Dexterity modifier + its Monk level off a hit whose
// damage includes Bludgeoning, Piercing or Slashing damage. The creature holds
// the reaction ready before the attack, and the server spends it on the first
// hit it answers.
// ============================================

import type { DamageType } from './damage';
import { abilityModifier, classesOf } from './resources';

type Sheet = Record<string, unknown>;

/** A reduction a reaction makes to a hit: rolled, and only against the damage types it names. */
export interface DamageReduction {
  label: string;
  roll: { count: number; sides: number; bonus: number };
  types: readonly DamageType[];
}

/** A sheet's Monk level: its level when Monk is among its classes (a gestalt character has each at full level), else 0. */
export function monkLevel(sheet: Sheet): number {
  const { classes, level } = classesOf(sheet);
  return classes.some((name) => name.toLowerCase() === 'monk') ? level : 0;
}

/** Deflect Attacks: 1d10 + Dexterity modifier + Monk level off a Bludgeoning, Piercing or Slashing hit. */
export function deflectReduction(sheet: Sheet): DamageReduction {
  return {
    label: 'Deflect Attacks',
    roll: { count: 1, sides: 10, bonus: abilityModifier(sheet, 'dexterity') + monkLevel(sheet) },
    types: ['bludgeoning', 'piercing', 'slashing'],
  };
}
