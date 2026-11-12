// ============================================
// A token's speed for the tactical view
//
// A creature's walking speed, in feet. A token made from a creature carries
// a stat block whose speed line gives it. The DM can set a speed on any
// token, which wins over the stat block and is how a player character gets
// one until the server reads character sheets (phase 9). It is kept in the
// token's `metadata.tactical`, which only the DM can write.
//
// A token with no speed has no reach to show and moves as freely as it
// always did.
// ============================================

import type { Token } from '@/types';
import { TokenDisposition } from '@/types';
import type { CharacterHpInfo } from '@/utils/characterHp';
import { isTokenDowned } from '../tokenHitTest';
import type { Cell } from './projection';

export const TACTICAL_LIMITS = { maxSpeed: 600 } as const;

/** The speed the DM set on the token, or null when there is none that can be read. */
export function readSpeedOverride(token: Pick<Token, 'metadata'>): number | null {
  const stored = (token.metadata as Record<string, unknown> | undefined)?.tactical;
  if (typeof stored !== 'object' || stored === null) return null;
  const { speed } = stored as Record<string, unknown>;
  return typeof speed === 'number' &&
    Number.isInteger(speed) &&
    speed >= 0 &&
    speed <= TACTICAL_LIMITS.maxSpeed
    ? speed
    : null;
}

/**
 * The walking speed in a stat block's speed line, such as "30 ft., fly 60
 * ft.": the first number, unless the line opens by naming another way of
 * moving ("fly 60 ft."), which means the creature does not walk.
 */
export function walkingSpeedFromLine(line: string | null | undefined): number | null {
  if (!line) return null;
  const match = /^\s*(?:walk\s+)?(\d{1,3})\s*(?:ft|feet)?\b/i.exec(line);
  if (!match) return null;
  const speed = Number(match[1]);
  return speed <= TACTICAL_LIMITS.maxSpeed ? speed : null;
}

/** The token's walking speed in feet and where it comes from, or null when it has none. */
export function tokenSpeed(
  token: Pick<Token, 'metadata' | 'statBlock'>
): { feet: number; source: 'token' | 'statBlock' } | null {
  const override = readSpeedOverride(token);
  if (override !== null) return { feet: override, source: 'token' };
  const printed = walkingSpeedFromLine(token.statBlock?.speed);
  return printed !== null ? { feet: printed, source: 'statBlock' } : null;
}

/** The metadata patch that stores a speed on the token, or clears it. */
export function speedPatch(speed: number | null): { tactical: { speed: number } | null } {
  return { tactical: speed === null ? null : { speed } };
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
