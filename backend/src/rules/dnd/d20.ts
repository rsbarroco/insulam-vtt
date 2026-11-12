// ============================================
// D20 Tests, by the D&D rules (2024 revision, SRD 5.2)
//
// Attack rolls, saving throws and ability checks: a d20 plus a modifier
// against a target number. Advantage rolls two and keeps the higher,
// Disadvantage the lower, and having both is having neither.
//
// The server is the one that rolls. Every function takes its die roller as
// an argument, so a test can say what was rolled.
// ============================================

/** A die roller: a whole number from 1 to `sides`. */
export type RollDie = (sides: number) => number;

export const rollDie: RollDie = (sides) => Math.floor(Math.random() * sides) + 1;

/** How a d20 is rolled. */
export type RollMode = 'normal' | 'advantage' | 'disadvantage';

/** Any number of sources of each make one mode; having both cancels to a normal roll. */
export function rollMode(advantage: boolean, disadvantage: boolean): RollMode {
  if (advantage === disadvantage) return 'normal';
  return advantage ? 'advantage' : 'disadvantage';
}

export interface D20Roll {
  mode: RollMode;
  /** The d20s rolled: one, or two with Advantage or Disadvantage. */
  dice: number[];
  /** The d20 that counts. */
  natural: number;
  modifier: number;
  total: number;
}

export function rollD20(modifier: number, mode: RollMode = 'normal', roll: RollDie = rollDie): D20Roll {
  const dice = mode === 'normal' ? [roll(20)] : [roll(20), roll(20)];
  const natural = mode === 'disadvantage' ? Math.min(...dice) : Math.max(...dice);
  return { mode, dice, natural, modifier, total: natural + modifier };
}

/** The bonus cover gives to Armor Class and Dexterity saving throws. Total cover cannot be targeted at all. */
export type Cover = 'none' | 'half' | 'three-quarters' | 'total';

export function coverBonus(cover: Cover): number {
  if (cover === 'half') return 2;
  if (cover === 'three-quarters') return 5;
  return 0;
}

export interface AttackOutcome {
  roll: D20Roll;
  /** The Armor Class the roll had to meet, cover included. */
  armorClass: number;
  hit: boolean;
  /** A hit that rolls its damage dice twice. */
  critical: boolean;
}

export interface AttackInput {
  /** The attack bonus: ability modifier, proficiency and anything else. */
  bonus: number;
  armorClass: number;
  cover?: Cover;
  mode?: RollMode;
  /** The hit is a Critical Hit whatever is rolled, as against a Paralyzed target within 5 feet. */
  criticalOnHit?: boolean;
}

/**
 * An attack roll. A 20 on the d20 hits whatever the Armor Class and is a
 * Critical Hit; a 1 misses whatever the bonus. A target with total cover
 * cannot be attacked, which is the caller's to refuse before rolling.
 */
export function attackRoll(input: AttackInput, roll: RollDie = rollDie): AttackOutcome {
  const rolled = rollD20(input.bonus, input.mode ?? 'normal', roll);
  const armorClass = input.armorClass + coverBonus(input.cover ?? 'none');
  const hit = rolled.natural === 20 || (rolled.natural !== 1 && rolled.total >= armorClass);
  return { roll: rolled, armorClass, hit, critical: hit && (rolled.natural === 20 || input.criticalOnHit === true) };
}

export interface SaveOutcome {
  roll: D20Roll | null;
  dc: number;
  success: boolean;
}

export interface SaveInput {
  bonus: number;
  dc: number;
  mode?: RollMode;
  /** The save fails without a roll, as a Strength save does for a Stunned creature. */
  autoFail?: boolean;
}

/** A saving throw: meet or beat the DC. A 20 or a 1 on the die means nothing special. */
export function savingThrow(input: SaveInput, roll: RollDie = rollDie): SaveOutcome {
  if (input.autoFail) return { roll: null, dc: input.dc, success: false };
  const rolled = rollD20(input.bonus, input.mode ?? 'normal', roll);
  return { roll: rolled, dc: input.dc, success: rolled.total >= input.dc };
}

/** An ability check: meet or beat the DC. */
export function abilityCheck(input: { bonus: number; dc: number; mode?: RollMode }, roll: RollDie = rollDie): SaveOutcome {
  return savingThrow(input, roll);
}
