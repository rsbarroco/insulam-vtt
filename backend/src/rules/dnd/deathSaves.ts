// ============================================
// Death saving throws, by the D&D rules (2024 revision, SRD 5.2)
//
// A character at 0 Hit Points rolls a d20 at the start of each of its turns:
// 10 or higher is a success, lower a failure. Three successes and it is
// Stable; three failures and it dies. A 1 counts as two failures, and a 20
// puts it back on its feet with 1 Hit Point. Damage taken at 0 Hit Points is
// a failure, two if it was a Critical Hit.
// ============================================

import type { RollDie } from './d20';
import { rollDie } from './d20';

export interface DeathSaves {
  successes: number;
  failures: number;
}

export type DeathSaveResult = 'continues' | 'stable' | 'dead' | 'revived';

export interface DeathSaveOutcome {
  natural: number;
  saves: DeathSaves;
  result: DeathSaveResult;
}

const settle = (saves: DeathSaves): DeathSaveResult =>
  saves.failures >= 3 ? 'dead' : saves.successes >= 3 ? 'stable' : 'continues';

const capped = (saves: DeathSaves): DeathSaves => ({
  successes: Math.min(3, saves.successes),
  failures: Math.min(3, saves.failures),
});

/** Roll one death saving throw. A 20 clears the saves and revives the character with 1 Hit Point. */
export function deathSavingThrow(saves: DeathSaves, roll: RollDie = rollDie): DeathSaveOutcome {
  const natural = roll(20);
  if (natural === 20) return { natural, saves: { successes: 0, failures: 0 }, result: 'revived' };
  const next = capped(
    natural >= 10
      ? { ...saves, successes: saves.successes + 1 }
      : { ...saves, failures: saves.failures + (natural === 1 ? 2 : 1) }
  );
  return { natural, saves: next, result: settle(next) };
}

/** Damage taken at 0 Hit Points: one failure, or two from a Critical Hit. */
export function damageAtZero(saves: DeathSaves, critical = false): { saves: DeathSaves; result: DeathSaveResult } {
  const next = capped({ ...saves, failures: saves.failures + (critical ? 2 : 1) });
  return { saves: next, result: settle(next) };
}

/** A sheet's death saves as stored, read safely. */
export function readDeathSaves(stored: unknown): DeathSaves {
  const saves = (stored ?? {}) as Partial<DeathSaves>;
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(3, Math.floor(value))) : 0);
  return { successes: count(saves.successes), failures: count(saves.failures) };
}

/**
 * What damage does to a character's death saves, given its Hit Points
 * before and after. Damage at 0 is a failure, two from a Critical Hit;
 * dropping to 0 starts the saves afresh. Null when they are unchanged.
 */
export function deathSavesAfterDamage(saves: DeathSaves, before: number, after: number, critical: boolean): DeathSaves | null {
  if (before <= 0) return damageAtZero(saves, critical).saves;
  if (after <= 0 && (saves.successes !== 0 || saves.failures !== 0)) return { successes: 0, failures: 0 };
  return null;
}

/** Whether a character is making death saves: at 0 Hit Points, neither Stable nor dead. */
export function isDying(currentHp: number, saves: DeathSaves): boolean {
  return currentHp <= 0 && saves.successes < 3 && saves.failures < 3;
}
