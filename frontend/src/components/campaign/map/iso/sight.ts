// ============================================
// Distance, line of sight and cover on the tactical board
//
// The conventions are the ones written down in docs/TACTICAL_MODE.md
// ("Where the rules meet the board"):
//
//   • Distance between two creatures is the squares between their nearest
//     edges, by the map's diagonal rule, or the difference in the height of
//     the ground they stand on if that is greater.
//   • A creature stands two height steps tall for each square of its size.
//     Four lines run from the top of the attacker to four heights on the
//     target. Ground that rises above a line blocks it.
//   • None blocked is no cover, one or two half cover, three three-quarters
//     cover, four total cover. Another creature in the way gives at least
//     half cover.
//
// Pure: no React, no canvas.
// ============================================

import { heightAt, type HeightGrid } from './heightGrid';
import type { Cell } from './projection';
import { feetPerStep, groundUnder } from './reach';

/** A creature on the board: where its footprint starts and how large it is. */
export interface Standing {
  readonly cell: Cell;
  readonly size: { readonly width: number; readonly height: number };
}

export type Cover = 'none' | 'half' | 'three-quarters' | 'total';

/** Height steps a creature stands tall, for each square of its size. */
export const BODY_STEPS_PER_SQUARE = 2;

/** Fractions of the target's height that the four sight lines aim at. */
const TARGET_HEIGHTS = [0.125, 0.375, 0.625, 0.875] as const;

/** How far apart samples along a sight line are, in squares. */
const SAMPLE_STEP = 0.1;

function bodySteps(creature: Standing): number {
  return BODY_STEPS_PER_SQUARE * Math.max(creature.size.width, creature.size.height);
}

function centre(creature: Standing): { x: number; y: number } {
  return {
    x: creature.cell.x + creature.size.width / 2,
    y: creature.cell.y + creature.size.height / 2,
  };
}

function covers(creature: Standing, x: number, y: number): boolean {
  return (
    x >= creature.cell.x &&
    x < creature.cell.x + creature.size.width &&
    y >= creature.cell.y &&
    y < creature.cell.y + creature.size.height
  );
}

/** Squares between the nearest edges of two footprints along one axis. 0 when they overlap or touch. */
function gap(aStart: number, aLength: number, bStart: number, bLength: number): number {
  return Math.max(0, bStart - (aStart + aLength - 1), aStart - (bStart + bLength - 1));
}

/**
 * Feet between two creatures. Neighbours are one square apart; creatures
 * sharing a square are 0 apart.
 */
export function distanceFeet(
  a: Standing,
  b: Standing,
  board: { heights: HeightGrid | null; feetPerSquare: number; diagonalRule: 'flat' | 'alternating' }
): number {
  const dx = gap(a.cell.x, a.size.width, b.cell.x, b.size.width);
  const dy = gap(a.cell.y, a.size.height, b.cell.y, b.size.height);
  const diagonals = Math.min(dx, dy);
  const squares =
    Math.max(dx, dy) + (board.diagonalRule === 'alternating' ? Math.floor(diagonals / 2) : 0);
  const rise = Math.abs(
    groundUnder(a.cell, a.size, board.heights) - groundUnder(b.cell, b.size, board.heights)
  );
  return Math.max(squares * board.feetPerSquare, rise * feetPerStep(board.feetPerSquare));
}

/**
 * The cover a target has from an attacker: what the ground between them
 * hides of it, and whether another creature stands in the way. `others` are
 * the creatures that can give cover; the attacker and the target are ignored
 * if they are among them.
 */
export function coverBetween(
  attacker: Standing,
  target: Standing,
  board: { heights: HeightGrid | null; others: readonly Standing[] }
): Cover {
  const from = centre(attacker);
  const to = centre(target);
  const eye = groundUnder(attacker.cell, attacker.size, board.heights) + bodySteps(attacker);
  const targetGround = groundUnder(target.cell, target.size, board.heights);
  const targetBody = bodySteps(target);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = Math.max(1, Math.ceil(length / SAMPLE_STEP));
  const others = board.others.filter((other) => other !== attacker && other !== target);

  let blocked = 0;
  let creatureInTheWay = false;
  for (const fraction of TARGET_HEIGHTS) {
    const aim = targetGround + targetBody * fraction;
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      // The ground the two stand on is theirs, not an obstacle between them.
      if (covers(attacker, cellX, cellY) || covers(target, cellX, cellY)) continue;
      if (others.some((other) => covers(other, cellX, cellY))) creatureInTheWay = true;
      if (heightAt(board.heights, cellX, cellY) > eye + (aim - eye) * t) {
        blocked++;
        break;
      }
    }
  }

  if (blocked >= 4) return 'total';
  if (blocked === 3) return 'three-quarters';
  if (blocked >= 1 || creatureInTheWay) return 'half';
  return 'none';
}

/** Cover as the hint words it, with the bonus the rules give to Armor Class. */
export function coverLabel(cover: Cover): string {
  switch (cover) {
    case 'none':
      return 'no cover';
    case 'half':
      return 'half cover (+2 AC)';
    case 'three-quarters':
      return 'three-quarters cover (+5 AC)';
    case 'total':
      return 'total cover, cannot be targeted';
  }
}
