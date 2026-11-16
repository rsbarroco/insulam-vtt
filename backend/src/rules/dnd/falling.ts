// ============================================
// Falling, by the D&D rules
//
// "A creature that falls takes 1d6 Bludgeoning damage at the end of the fall
// for every 10 feet it fell, to a maximum of 20d6. When the creature lands,
// it has the Prone condition unless it avoids taking any damage from the
// fall." (SRD 5.2.1, Rules Glossary; `rules-glossary-falling-hazard`.)
//
// Pure: the caller says how far the creature fell and stores what comes back.
// ============================================

import { rollDie, type RollDie } from './d20';
import {
  applyDamage,
  rollDamage,
  type Defences,
  type HitPoints,
  type RolledDamage,
} from './damage';

/** A fall shorter than this does no damage. */
export const FALL_STEP_FEET = 10;
export const MAX_FALL_DICE = 20;

/** The d6s a fall of this many feet rolls. */
export function fallDice(feet: number): number {
  return Math.max(0, Math.min(MAX_FALL_DICE, Math.floor(feet / FALL_STEP_FEET)));
}

export interface Faller {
  name: string;
  /** Null when the creature tracks no hit points. */
  hp: HitPoints | null;
  defences?: Defences;
}

export interface FallResult {
  feet: number;
  rolled: RolledDamage;
  /** Damage after the creature's defences. */
  dealt: number;
  /** Its hit points afterwards, or null when it tracks none. */
  hp: HitPoints | null;
  /** It lands Prone, unless it took no damage. */
  prone: boolean;
  dropped: boolean;
  instantDeath: boolean;
  /** One line for the log. */
  summary: string;
}

export function resolveFall(faller: Faller, feet: number, roll: RollDie = rollDie): FallResult {
  const rolled = rollDamage({ count: fallDice(feet), sides: 6 }, false, roll);
  const applied = applyDamage(
    faller.hp ?? { current: 1, max: 1, temp: 0 },
    [{ amount: rolled.total, type: 'bludgeoning' }],
    faller.defences
  );
  const prone = applied.dealt > 0;
  const landing =
    applied.dealt === 0
      ? 'no damage'
      : `${applied.dealt} bludgeoning damage, Prone${faller.hp && applied.instantDeath ? ', killed outright' : faller.hp && applied.dropped ? ', drops to 0 Hit Points' : ''}`;
  return {
    feet,
    rolled,
    dealt: applied.dealt,
    hp: faller.hp ? applied.hp : null,
    prone,
    dropped: faller.hp !== null && applied.dropped,
    instantDeath: faller.hp !== null && applied.instantDeath,
    summary: `${faller.name} falls ${feet} ft: ${landing}`,
  };
}

/**
 * A fall as Slow Fall leaves it: `amount` taken off the damage, to no less
 * than 0. The creature's hit points are worked out again from what they were
 * before the fall, and it lands on its feet when no damage is left.
 */
export function withSlowFall(result: FallResult, faller: Faller, amount: number): FallResult {
  if (result.dealt <= 0 || amount <= 0) return result;
  const dealt = Math.max(0, result.dealt - amount);
  // Already through the creature's defences, so applied as it stands.
  const applied = applyDamage(faller.hp ?? { current: 1, max: 1, temp: 0 }, [{ amount: dealt, type: 'force' }]);
  const dropped = faller.hp !== null && dealt > 0 && applied.dropped;
  const instantDeath = faller.hp !== null && dealt > 0 && applied.instantDeath;
  const taken = result.dealt - dealt;
  const landing =
    dealt === 0
      ? `no damage (${taken} taken off by Slow Fall)`
      : `${dealt} bludgeoning damage (${taken} taken off by Slow Fall), Prone${instantDeath ? ', killed outright' : dropped ? ', drops to 0 Hit Points' : ''}`;
  return {
    ...result,
    dealt,
    hp: faller.hp ? (dealt > 0 ? applied.hp : faller.hp) : null,
    prone: dealt > 0,
    dropped,
    instantDeath,
    summary: `${faller.name} falls ${result.feet} ft: ${landing}`,
  };
}

/**
 * A fall as the Feather Fall spell leaves it: the creature takes no damage
 * from the fall and lands on its feet. `caster` is who cast it.
 */
export function withFeatherFall(result: FallResult, faller: Faller, caster: string): FallResult {
  return {
    ...result,
    dealt: 0,
    hp: faller.hp,
    prone: false,
    dropped: false,
    instantDeath: false,
    summary: `${faller.name} falls ${result.feet} ft: no damage (Feather Fall${caster === faller.name ? '' : `, cast by ${caster}`})`,
  };
}
