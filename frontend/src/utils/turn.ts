// ============================================
// The turn in combat, by the D&D rules
//
// What the acting combatant has left of its movement, and the actions a
// creature can take on its turn. The server keeps the counts (CombatState's
// `turn`); nothing here or there enforces them.
// ============================================

import type { CombatState, TurnState } from '@/types';

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

/** What a Slow mastery takes from a creature's Speed: 10 feet, however many weapons slowed it. */
export const SLOW_FEET = 10;

/** What a Barbarian's Hamstring Blow takes from a creature's Speed: 15 feet. */
export const HAMSTRING_FEET = 15;

/** A Speed with any Slow and Hamstring Blow on the creature taken off, never below 0. */
export function slowedSpeed(speed: number, marks: CombatState['marks'], tokenId: string): number {
  const slow = marks.some((mark) => mark.kind === 'slow' && mark.targetId === tokenId) ? SLOW_FEET : 0;
  const hamstring = marks.some((mark) => mark.kind === 'hamstring' && mark.targetId === tokenId) ? HAMSTRING_FEET : 0;
  return Math.max(0, speed - slow - hamstring);
}

/** The marks a creature carries, as the tracker names them. */
export function markLabels(marks: CombatState['marks'], tokenId: string): string[] {
  const labels: string[] = [];
  if (marks.some((mark) => mark.kind === 'sap' && mark.targetId === tokenId)) labels.push('Sapped');
  if (marks.some((mark) => mark.kind === 'slow' && mark.targetId === tokenId)) labels.push('Slowed');
  if (marks.some((mark) => mark.kind === 'hamstring' && mark.targetId === tokenId)) labels.push('Hamstrung');
  if (marks.some((mark) => mark.kind === 'vex' && mark.targetId === tokenId)) labels.push('Vexed');
  if (marks.some((mark) => mark.kind === 'rage' && mark.targetId === tokenId)) labels.push('Raging');
  if (marks.some((mark) => mark.kind === 'help' && mark.targetId === tokenId)) labels.push('Distracted');
  if (marks.some((mark) => mark.kind === 'ready' && mark.targetId === tokenId)) labels.push('Readied against');
  if (marks.some((mark) => mark.kind === 'reckless' && mark.attackerId === tokenId)) labels.push('Reckless');
  if (marks.some((mark) => mark.kind === 'uncanny' && mark.attackerId === tokenId)) labels.push('Holding Uncanny Dodge');
  if (marks.some((mark) => mark.kind === 'deflect' && mark.attackerId === tokenId)) labels.push('Holding Deflect Attacks');
  if (marks.some((mark) => mark.kind === 'indomitable' && mark.attackerId === tokenId)) labels.push('Holding Indomitable');
  const held = marks.find((mark) => mark.kind === 'concentration' && mark.attackerId === tokenId);
  if (held) labels.push(`Concentrating (${held.action ?? 'a spell'})`);
  return labels;
}

/** Feet as the bar shows them: whole, or with a half. */
export function formatFeet(feet: number): string {
  return Number.isInteger(feet) ? String(feet) : feet.toFixed(1);
}
