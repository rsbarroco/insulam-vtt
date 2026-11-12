// ============================================
// A token's movement numbers for the tactical view
//
// Move and Jump are set by the DM on each token and kept in the token's
// `metadata.tactical`, which only the DM can write. A token without them has
// no reach to show and moves as freely as it always did.
// ============================================

import type { Token } from '@/types';
import { TokenDisposition } from '@/types';
import type { CharacterHpInfo } from '@/utils/characterHp';
import { isTokenDowned } from '../tokenHitTest';
import type { Cell } from './projection';

export interface TacticalStats {
  /** Cells the token can walk in one move. */
  move: number;
  /** Height steps it can climb or drop between neighbouring cells. */
  jump: number;
}

export const TACTICAL_LIMITS = { maxMove: 30, maxJump: 32 } as const;

const whole = (value: unknown, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null;

/** The token's movement numbers, or null when it has none that can be read. */
export function readTacticalStats(token: Pick<Token, 'metadata'>): TacticalStats | null {
  const stored = (token.metadata as Record<string, unknown> | undefined)?.tactical;
  if (typeof stored !== 'object' || stored === null) return null;
  const { move, jump } = stored as Record<string, unknown>;
  const parsedMove = whole(move, TACTICAL_LIMITS.maxMove);
  const parsedJump = whole(jump, TACTICAL_LIMITS.maxJump);
  return parsedMove === null || parsedJump === null ? null : { move: parsedMove, jump: parsedJump };
}

/** The metadata patch that stores movement numbers, or clears them. */
export function tacticalStatsPatch(stats: TacticalStats | null): {
  tactical: TacticalStats | null;
} {
  return { tactical: stats };
}

/** Hostile tokens are one side; everyone else, the party and its friends, the other. */
function isHostile(token: Pick<Token, 'disposition'>): boolean {
  return token.disposition === TokenDisposition.HOSTILE;
}

function overlaps(origin: Cell, size: { width: number; height: number }, other: Token): boolean {
  return (
    origin.x < other.position.x + other.size.width &&
    origin.x + size.width > other.position.x &&
    origin.y < other.position.y + other.size.height &&
    origin.y + size.height > other.position.y
  );
}

/**
 * Who stands in a moving token's way: it walks through tokens of its own
 * side and round the others, and stops on neither. A downed token holds no
 * square, as in the top-down view. `others` is what this viewer can see: a
 * creature they cannot see does not shape the reach they are shown.
 */
export function reachObstacles(
  moving: Token,
  others: readonly Token[],
  characterHpCache: Record<string, CharacterHpInfo>
): { blocked: (origin: Cell) => boolean; occupied: (origin: Cell) => boolean } {
  const standing = others.filter(
    (token) =>
      token.id !== moving.id &&
      token.layer === moving.layer &&
      !isTokenDowned(token, characterHpCache)
  );
  const opposing = standing.filter((token) => isHostile(token) !== isHostile(moving));
  return {
    blocked: (origin) => opposing.some((token) => overlaps(origin, moving.size, token)),
    occupied: (origin) => standing.some((token) => overlaps(origin, moving.size, token)),
  };
}
