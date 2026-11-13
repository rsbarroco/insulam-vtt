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
