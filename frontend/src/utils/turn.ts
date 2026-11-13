// ============================================
// The turn in combat, by the D&D rules
//
// What the acting combatant has left of its movement, and the actions a
// creature can take on its turn. The server keeps the counts (CombatState's
// `turn`); nothing here or there enforces them.
// ============================================

import type { TurnState } from '@/types';

/**
 * The actions the 2024 rules give every creature, by name. The name is what
 * the turn records. The VTT applies the effect of two: Dash adds the
 * creature's speed to its movement for the turn, and Dodge gives attack
 * rolls against it Disadvantage and its Dexterity saving throws Advantage
 * until its next turn starts (the server keeps who is dodging).
 */
export const STANDARD_ACTIONS = [
  'Attack',
  'Dash',
  'Disengage',
  'Dodge',
  'Help',
  'Hide',
  'Influence',
  'Magic',
  'Ready',
  'Search',
  'Study',
  'Utilize',
] as const;

export const DASH = 'Dash';

/** Feet the combatant may move this turn: its speed, once more for each Dash. */
export function movementBudget(speed: number, turn: Pick<TurnState, 'dashes'>): number {
  return speed * (1 + turn.dashes);
}

/** Feet of movement it has left this turn, never below 0. */
export function movementLeft(
  speed: number,
  turn: Pick<TurnState, 'dashes' | 'movementSpent'>
): number {
  return Math.max(0, movementBudget(speed, turn) - turn.movementSpent);
}

/**
 * The turn fields to send when the action taken changes. Taking Dash as the
 * action counts one Dash, and giving it up takes that one back; a Dash from
 * anything else (a bonus action, say) is left as it was.
 */
export function actionChange(
  turn: Pick<TurnState, 'action' | 'dashes'>,
  action: string | null
): { action: string | null; dashes: number } {
  const wasDash = turn.action === DASH;
  const isDash = action === DASH;
  const dashes = turn.dashes + (isDash && !wasDash ? 1 : 0) - (wasDash && !isDash ? 1 : 0);
  return { action, dashes: Math.max(0, dashes) };
}

/** Feet as the bar shows them: whole, or with a half. */
export function formatFeet(feet: number): string {
  return Number.isInteger(feet) ? String(feet) : feet.toFixed(1);
}
