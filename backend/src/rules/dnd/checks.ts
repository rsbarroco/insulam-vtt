// ============================================
// Ability checks, by the D&D rules
//
// A d20 plus the creature's bonus for the ability or the skill, against a
// Difficulty Class when the table sets one (SRD 5.2.1, "D20 Tests";
// `playing-the-game-ability-checks`). A creature's own conditions change the
// roll: Poisoned and Frightened give Disadvantage on ability checks, and each
// level of Exhaustion takes 2 from every D20 Test.
//
// Pure: the caller reads the bonus from the sheet or the stat block.
// ============================================

import { d20Penalty, type Ability, type ConditionState } from './conditions';
import { rollD20, rollDie, rollMode, type D20Roll, type RollDie, type RollMode } from './d20';

/** The DC the Hide action's Dexterity (Stealth) check must meet. */
export const HIDE_DC = 15;

/** The eighteen skills as a sheet keys them, with the ability each uses and the name the rules print. */
export const SKILL_CHECKS = {
  acrobatics: { ability: 'dex', name: 'Acrobatics' },
  animalHandling: { ability: 'wis', name: 'Animal Handling' },
  arcana: { ability: 'int', name: 'Arcana' },
  athletics: { ability: 'str', name: 'Athletics' },
  deception: { ability: 'cha', name: 'Deception' },
  history: { ability: 'int', name: 'History' },
  insight: { ability: 'wis', name: 'Insight' },
  intimidation: { ability: 'cha', name: 'Intimidation' },
  investigation: { ability: 'int', name: 'Investigation' },
  medicine: { ability: 'wis', name: 'Medicine' },
  nature: { ability: 'int', name: 'Nature' },
  perception: { ability: 'wis', name: 'Perception' },
  performance: { ability: 'cha', name: 'Performance' },
  persuasion: { ability: 'cha', name: 'Persuasion' },
  religion: { ability: 'int', name: 'Religion' },
  sleightOfHand: { ability: 'dex', name: 'Sleight of Hand' },
  stealth: { ability: 'dex', name: 'Stealth' },
  survival: { ability: 'wis', name: 'Survival' },
} as const satisfies Record<string, { ability: Ability; name: string }>;

export type SkillCheck = keyof typeof SKILL_CHECKS;

export const ABILITY_CHECK_NAMES: Readonly<Record<Ability, string>> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

/** A passive check: 10 plus the bonus. Passive Perception is this for Perception. */
export function passiveScore(bonus: number): number {
  return 10 + bonus;
}

export interface CheckModifiers {
  /** The creature's conditions give Disadvantage. */
  disadvantage: boolean;
  /** A flat change to the roll, from Exhaustion. */
  penalty: number;
  /** Why, for the log. */
  reasons: string[];
}

/** How a creature's own conditions change an ability check it makes. */
export function checkModifiers(state: ConditionState): CheckModifiers {
  const reasons: string[] = [];
  if (state.has.has('poisoned')) reasons.push('Disadvantage: Poisoned');
  if (state.has.has('frightened')) reasons.push('Disadvantage: Frightened');
  return { disadvantage: reasons.length > 0, penalty: d20Penalty(state), reasons };
}

export interface CheckRequest {
  /** Who makes it, for the log. */
  name: string;
  /** "Dexterity (Stealth)", "Strength". */
  label: string;
  bonus: number;
  /** The Difficulty Class, when the table set one. */
  dc?: number;
  /** Advantage or Disadvantage the table grants beyond what the conditions give. */
  mode?: RollMode;
  conditions: ConditionState;
}

export interface CheckResult {
  roll: D20Roll;
  total: number;
  /** Null when no DC was set: the table reads the total. */
  success: boolean | null;
  reasons: string[];
  /** One line for the log. */
  summary: string;
}

export function resolveCheck(request: CheckRequest, roll: RollDie = rollDie): CheckResult {
  const modifiers = checkModifiers(request.conditions);
  const reasons = [...modifiers.reasons];
  if (request.mode === 'advantage') reasons.push('Advantage: granted by the table');
  if (request.mode === 'disadvantage') reasons.push('Disadvantage: imposed by the table');
  const mode = rollMode(
    request.mode === 'advantage',
    modifiers.disadvantage || request.mode === 'disadvantage'
  );
  const rolled = rollD20(request.bonus + modifiers.penalty, mode, roll);
  const success = request.dc === undefined ? null : rolled.total >= request.dc;
  const verdict =
    success === null
      ? `${rolled.total}`
      : `${rolled.total} vs DC ${request.dc}: ${success ? 'success' : 'failure'}`;
  return {
    roll: rolled,
    total: rolled.total,
    success,
    reasons,
    summary: `${request.name} ${request.label} check: ${verdict}`,
  };
}
