// ============================================
// Opportunity Attacks, by the D&D rules
//
// "You can make an Opportunity Attack when a creature that you can see
// leaves your reach using its action, its Bonus Action, its Reaction, or one
// of its speeds. To make the Opportunity Attack, take a Reaction to make one
// melee attack with a weapon or an Unarmed Strike against the provoking
// creature. The attack occurs right before the creature leaves your reach."
// (SRD 5.2.1, Rules Glossary; `rules-glossary-opportunity-attacks`.) The
// Disengage action stops a creature's movement provoking them for the turn.
//
// Pure: who a move leaves the reach of. Whether each of those may react is
// the caller's to check, as is whose side anyone is on.
// ============================================

import { distanceFeet, type BoardHeights, type Standing } from '../../utils/boardSight';

/** A creature a mover passes, with how far its melee attacks reach. */
export interface Bystander {
  id: string;
  standing: Standing;
  reachFeet: number;
}

export interface Board {
  heights: BoardHeights | null | undefined;
  feetPerSquare: number;
  diagonalRule: 'flat' | 'alternating';
}

/** The bystanders whose reach a creature was in where it stood and is out of where it stands now. */
export function leavesReachOf(
  from: Standing,
  to: Standing,
  bystanders: readonly Bystander[],
  board: Board
): string[] {
  return bystanders
    .filter(
      (bystander) =>
        distanceFeet(bystander.standing, from, board) <= bystander.reachFeet &&
        distanceFeet(bystander.standing, to, board) > bystander.reachFeet
    )
    .map((bystander) => bystander.id);
}

export type Side = 'party' | 'foes';

/**
 * Whose side a combatant is on, from how the table marked its token: the
 * players' characters and the creatures friendly to them, or the hostile
 * ones. A neutral creature, an object and an unmarked one take no side, and
 * nobody is offered an Opportunity Attack by or against them.
 */
export function sideOf(combatant: {
  type: 'player' | 'npc' | 'object';
  disposition: 'friendly' | 'neutral' | 'hostile' | null;
}): Side | null {
  if (combatant.type === 'object') return null;
  if (combatant.disposition === 'hostile') return 'foes';
  if (combatant.type === 'player' || combatant.disposition === 'friendly') return 'party';
  return null;
}
