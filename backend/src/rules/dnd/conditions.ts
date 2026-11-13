// ============================================
// Conditions, by the D&D rules (2024 revision, SRD 5.2)
//
// What each condition does to the numbers the engine works with: attack
// rolls made by and against the creature, its saving throws, its speed, and
// whether it can act. Effects the engine cannot see (who a Charmed creature
// may not attack, what a Deafened creature cannot hear) are left to the
// table.
//
// Names are matched without regard to case, so the conditions a token
// already carries ("Prone", "prone") are read as they are. "Exhausted" is
// read as one level of Exhaustion, which is how the VTT has listed it.
// ============================================

import type { RollMode } from './d20';
import { rollMode } from './d20';

export const CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
] as const;

export type Condition = (typeof CONDITIONS)[number];

/** Exhaustion has levels; the sixth kills. */
export const MAX_EXHAUSTION = 6;

/** A creature's conditions as the engine reads them. */
export interface ConditionState {
  has: ReadonlySet<Condition>;
  /** 0 to 6. */
  exhaustion: number;
  /** It took the Dodge action and its next turn has not started. Not a condition, but carried like one. */
  dodging: boolean;
}

const ALIASES: Readonly<Record<string, Condition>> = { exhausted: 'exhaustion' };

/**
 * Read the conditions a token carries. Names the rules do not have are
 * ignored. `exhaustion` is the level, when the caller tracks one; without
 * it, carrying the condition counts as level 1.
 */
export function readConditions(names: readonly string[], exhaustion?: number): ConditionState {
  const has = new Set<Condition>();
  let dodging = false;
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (key === DODGING) dodging = true;
    const condition = ALIASES[key] ?? (CONDITIONS as readonly string[]).find((known) => known === key);
    if (condition) has.add(condition as Condition);
  }
  // Each of these includes being Incapacitated, and an Unconscious creature falls Prone.
  if (has.has('paralyzed') || has.has('petrified') || has.has('stunned') || has.has('unconscious')) {
    has.add('incapacitated');
  }
  if (has.has('unconscious')) has.add('prone');
  const level = exhaustion ?? (has.has('exhaustion') ? 1 : 0);
  const clamped = Math.max(0, Math.min(MAX_EXHAUSTION, Math.floor(level)));
  if (clamped > 0) has.add('exhaustion');
  else has.delete('exhaustion');
  return { has, exhaustion: clamped, dodging };
}

/** The name a dodging creature carries among its conditions. */
export const DODGING = 'dodging';

/**
 * Whether a creature that took the Dodge action still has its benefits: it
 * loses them while Incapacitated or while its Speed is 0.
 */
export function stillDodging(state: ConditionState): boolean {
  return state.dodging && canAct(state) && effectiveSpeed(30, state) > 0;
}

/** An Incapacitated creature takes no action, Bonus Action or Reaction. */
export function canAct(state: ConditionState): boolean {
  return !state.has.has('incapacitated');
}

/** What each level of Exhaustion takes from every D20 Test. */
export function d20Penalty(state: ConditionState): number {
  return state.exhaustion === 0 ? 0 : -2 * state.exhaustion;
}

/**
 * A creature's speed with its conditions. Grappled, Paralyzed, Petrified,
 * Restrained and Unconscious creatures do not move; each level of
 * Exhaustion takes 5 feet. A Prone creature crawls, which is the movement
 * rules' to price.
 */
export function effectiveSpeed(speed: number, state: ConditionState): number {
  const stopped = (['grappled', 'paralyzed', 'petrified', 'restrained', 'unconscious'] as const).some((c) =>
    state.has.has(c)
  );
  if (stopped) return 0;
  return Math.max(0, speed - 5 * state.exhaustion);
}

export interface AttackSituation {
  attacker: ConditionState;
  target: ConditionState;
  /** Feet between them. */
  distanceFeet: number;
  /** A ranged attack, as opposed to a melee one. */
  ranged?: boolean;
  /** The attacker is Grappled by someone other than this target. */
  grappledByAnother?: boolean;
  /** The attacker can see the one it is Frightened of. */
  fearInSight?: boolean;
  /** The target cannot see the attacker, for a reason other than its own conditions. */
  unseenAttacker?: boolean;
}

export interface AttackModifiers {
  mode: RollMode;
  /** A flat change to the roll, from Exhaustion. */
  penalty: number;
  /** A hit is a Critical Hit: the target is Paralyzed or Unconscious and the attacker within 5 feet. */
  criticalOnHit: boolean;
  /** Why, in the order found, for the log. */
  reasons: string[];
}

/** How conditions change an attack roll. Any Advantage with any Disadvantage is a normal roll. */
export function attackModifiers(situation: AttackSituation): AttackModifiers {
  const { attacker, target, distanceFeet } = situation;
  const reasons: string[] = [];
  let advantage = false;
  let disadvantage = false;
  const adv = (why: string) => {
    advantage = true;
    reasons.push(`Advantage: ${why}`);
  };
  const dis = (why: string) => {
    disadvantage = true;
    reasons.push(`Disadvantage: ${why}`);
  };
  const within5 = distanceFeet <= 5;

  if (attacker.has.has('blinded')) dis('the attacker is Blinded');
  if (attacker.has.has('frightened') && situation.fearInSight !== false) dis('the attacker is Frightened');
  if (attacker.has.has('grappled') && situation.grappledByAnother) dis('the attacker is Grappled by someone else');
  if (attacker.has.has('poisoned')) dis('the attacker is Poisoned');
  if (attacker.has.has('prone')) dis('the attacker is Prone');
  if (attacker.has.has('restrained')) dis('the attacker is Restrained');
  if (attacker.has.has('invisible') || situation.unseenAttacker) adv('the target cannot see the attacker');

  // Dodging helps only against an attacker the target can see.
  const unseen = attacker.has.has('invisible') || situation.unseenAttacker || target.has.has('blinded');
  if (stillDodging(target) && !unseen) dis('the target is Dodging');
  if (target.has.has('blinded')) adv('the target is Blinded');
  if (target.has.has('invisible')) dis('the target is Invisible');
  if (target.has.has('paralyzed')) adv('the target is Paralyzed');
  if (target.has.has('petrified')) adv('the target is Petrified');
  if (target.has.has('restrained')) adv('the target is Restrained');
  if (target.has.has('stunned')) adv('the target is Stunned');
  if (target.has.has('unconscious')) adv('the target is Unconscious');
  // Unconscious includes Prone; the Advantage above already covers a close attacker.
  if (target.has.has('prone')) {
    if (within5) adv('the target is Prone and within 5 feet');
    else dis('the target is Prone and farther than 5 feet');
  }

  return {
    mode: rollMode(advantage, disadvantage),
    penalty: d20Penalty(attacker),
    criticalOnHit: within5 && (target.has.has('paralyzed') || target.has.has('unconscious')),
    reasons,
  };
}

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export interface SaveModifiers {
  mode: RollMode;
  penalty: number;
  /** The save fails without a roll. */
  autoFail: boolean;
}

/** How a creature's own conditions change a saving throw it makes. */
export function saveModifiers(state: ConditionState, ability: Ability): SaveModifiers {
  const physical = ability === 'str' || ability === 'dex';
  const helpless = (['paralyzed', 'petrified', 'stunned', 'unconscious'] as const).some((c) => state.has.has(c));
  return {
    mode: rollMode(ability === 'dex' && stillDodging(state), ability === 'dex' && state.has.has('restrained')),
    penalty: d20Penalty(state),
    autoFail: physical && helpless,
  };
}

/** A condition on a creature, with when it ends. */
export interface ConditionInstance {
  condition: Condition;
  /** The tokenId of whoever caused it, when that matters (a grappler, the one feared). */
  sourceTokenId?: string;
  /**
   * When it ends by itself: at the start or end of a combatant's turn, in or
   * after a round. Absent means until something removes it.
   */
  until?: { round: number; tokenId: string; at: 'start' | 'end' };
}

/**
 * The conditions still running at a moment in the fight: this round, at the
 * start or end of this combatant's turn. Meant to be asked at every turn
 * boundary, in order: one that ends at a boundary is dropped when that
 * boundary is reached, and anything from an earlier round is dropped too.
 */
export function unexpired(
  instances: readonly ConditionInstance[],
  now: { round: number; tokenId: string; at: 'start' | 'end' }
): ConditionInstance[] {
  return instances.filter(({ until }) => {
    if (!until) return true;
    if (now.round > until.round) return false;
    return !(now.round === until.round && now.tokenId === until.tokenId && now.at === until.at);
  });
}
