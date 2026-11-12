// ============================================
// Damage and healing, by the D&D rules (2024 revision, SRD 5.2)
//
// Damage has a type. Immunity takes none of it, Resistance halves it and
// Vulnerability doubles it, each instance of damage on its own, and all of
// that comes after any other change to the number. Temporary Hit Points are
// lost first. A creature at 0 Hit Points whose leftover damage equals or
// exceeds its Hit Point maximum dies outright.
// ============================================

import type { RollDie } from './d20';
import { rollDie } from './d20';

/** The damage types of the rules. */
export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

export interface HitPoints {
  current: number;
  max: number;
  temp: number;
}

export interface Defences {
  resistances?: readonly DamageType[];
  vulnerabilities?: readonly DamageType[];
  immunities?: readonly DamageType[];
}

export interface DamageInstance {
  amount: number;
  type: DamageType;
}

/**
 * One instance of damage after the target's defences. Immunity first; then
 * Resistance halves, rounding down, and Vulnerability doubles. With both,
 * the halving is applied before the doubling.
 */
export function adjustedDamage(instance: DamageInstance, defences: Defences): number {
  let amount = Math.max(0, Math.floor(instance.amount));
  if (defences.immunities?.includes(instance.type)) return 0;
  if (defences.resistances?.includes(instance.type)) amount = Math.floor(amount / 2);
  if (defences.vulnerabilities?.includes(instance.type)) amount *= 2;
  return amount;
}

export interface DamageOutcome {
  hp: HitPoints;
  /** Damage after defences, before Temporary Hit Points. */
  dealt: number;
  /** How much of it Temporary Hit Points took. */
  absorbed: number;
  /** The creature went from above 0 Hit Points to 0. */
  dropped: boolean;
  /** The damage left over at 0 Hit Points equalled or exceeded the maximum: it dies outright. */
  instantDeath: boolean;
}

/** Deal damage to a creature. The hit points handed in are not changed. */
export function applyDamage(
  hp: HitPoints,
  instances: readonly DamageInstance[],
  defences: Defences = {}
): DamageOutcome {
  const dealt = instances.reduce((sum, instance) => sum + adjustedDamage(instance, defences), 0);
  const absorbed = Math.min(Math.max(0, hp.temp), dealt);
  const through = dealt - absorbed;
  const current = Math.max(0, hp.current - through);
  const leftover = through - hp.current;
  return {
    hp: { current, max: hp.max, temp: hp.temp - absorbed },
    dealt,
    absorbed,
    dropped: hp.current > 0 && current === 0,
    instantDeath: current === 0 && through > 0 && leftover >= hp.max,
  };
}

/** Heal a creature, never past its maximum. The hit points handed in are not changed. */
export function applyHealing(hp: HitPoints, amount: number): HitPoints {
  return { ...hp, current: Math.min(hp.max, hp.current + Math.max(0, Math.floor(amount))) };
}

/** Temporary Hit Points do not add up: a creature keeps the larger of what it has and what it is given. */
export function grantTempHp(hp: HitPoints, amount: number): HitPoints {
  return { ...hp, temp: Math.max(hp.temp, Math.max(0, Math.floor(amount))) };
}

/** Dice and a flat number, such as 2d6 + 3. */
export interface DamageRoll {
  count: number;
  sides: number;
  bonus?: number;
}

export interface RolledDamage {
  dice: number[];
  bonus: number;
  total: number;
}

/**
 * Roll damage. On a Critical Hit the dice are rolled twice and the flat
 * number is added once. Damage is never below 0.
 */
export function rollDamage(damage: DamageRoll, critical = false, roll: RollDie = rollDie): RolledDamage {
  const count = Math.max(0, damage.count) * (critical ? 2 : 1);
  const dice = Array.from({ length: count }, () => roll(damage.sides));
  const bonus = damage.bonus ?? 0;
  return { dice, bonus, total: Math.max(0, dice.reduce((sum, die) => sum + die, 0) + bonus) };
}

/** A save for half: the damage a creature takes when it succeeds, rounded down. */
export function halfDamage(amount: number): number {
  return Math.floor(Math.max(0, amount) / 2);
}

/**
 * The DC of the Constitution save a creature makes to keep Concentration
 * when it takes damage: 10 or half the damage, whichever is higher, to at
 * most 30.
 */
export function concentrationDC(damage: number): number {
  return Math.min(30, Math.max(10, Math.floor(damage / 2)));
}
