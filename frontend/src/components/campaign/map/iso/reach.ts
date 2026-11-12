// ============================================
// Where a unit can walk on the tactical board
//
// The genre's movement rule: a unit walks up to `move` cells, one orthogonal
// step at a time, and between neighbouring cells it can climb or drop at most
// `jump` height steps. It can pass through units on its own side but not
// through others, and it cannot stop on a cell someone is standing on.
//
// A unit larger than one cell moves as a block: every cell under it must be
// on the board, and it stands on the tallest ground it covers.
//
// Pure: no React, no canvas. The numbers come from the caller; this module
// knows no game system.
// ============================================

import { heightAt, type HeightGrid } from './heightGrid';
import type { Cell } from './projection';

export interface ReachUnit {
  /** Bottom-left cell of the footprint, where the unit stands now. */
  readonly cell: Cell;
  readonly size: { readonly width: number; readonly height: number };
  /** Cells it can walk this move. */
  readonly move: number;
  /** Height steps it can climb or drop between neighbouring cells. */
  readonly jump: number;
}

export interface ReachBoard {
  readonly cols: number;
  readonly rows: number;
  readonly heights: HeightGrid | null;
  /** Whether the unit, standing with its footprint at this cell, would overlap someone it cannot walk through. */
  readonly blocked: (origin: Cell) => boolean;
  /** Whether the unit, standing with its footprint at this cell, would overlap anyone at all. */
  readonly occupied: (origin: Cell) => boolean;
}

export interface Reach {
  /** Cells the unit can stop on, by `cellKey`, with the steps each takes. */
  readonly stops: ReadonlyMap<string, number>;
  /** Every cell it can walk onto, including ones it can only pass through. */
  readonly steps: ReadonlyMap<string, number>;
  /** For each walked cell, the cell it was reached from. */
  readonly cameFrom: ReadonlyMap<string, Cell>;
}

export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

/** The ground a footprint stands on: the tallest cell under it. */
export function groundUnder(
  origin: Cell,
  size: { width: number; height: number },
  heights: HeightGrid | null
): number {
  let tallest = 0;
  for (let dy = 0; dy < size.height; dy++) {
    for (let dx = 0; dx < size.width; dx++) {
      tallest = Math.max(tallest, heightAt(heights, origin.x + dx, origin.y + dy));
    }
  }
  return tallest;
}

const NEIGHBOURS: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * Everywhere the unit can walk this move. Every step costs one, so a
 * breadth-first walk from where it stands finds the shortest way to each
 * cell. The cell it stands on is always a stop, at no cost.
 */
export function computeReach(unit: ReachUnit, board: ReachBoard): Reach {
  const stops = new Map<string, number>();
  const steps = new Map<string, number>();
  const cameFrom = new Map<string, Cell>();
  const fits = (origin: Cell) =>
    origin.x >= 0 &&
    origin.y >= 0 &&
    origin.x + unit.size.width <= board.cols &&
    origin.y + unit.size.height <= board.rows;

  const start = unit.cell;
  steps.set(cellKey(start), 0);
  stops.set(cellKey(start), 0);
  const move = Math.max(0, Math.floor(unit.move));
  const jump = Math.max(0, unit.jump);

  let frontier: Cell[] = [start];
  for (let cost = 1; cost <= move && frontier.length > 0; cost++) {
    const next: Cell[] = [];
    for (const from of frontier) {
      const fromGround = groundUnder(from, unit.size, board.heights);
      for (const step of NEIGHBOURS) {
        const to = { x: from.x + step.x, y: from.y + step.y };
        const key = cellKey(to);
        if (steps.has(key) || !fits(to)) continue;
        if (Math.abs(groundUnder(to, unit.size, board.heights) - fromGround) > jump) continue;
        if (board.blocked(to)) continue;
        steps.set(key, cost);
        cameFrom.set(key, from);
        if (!board.occupied(to)) stops.set(key, cost);
        next.push(to);
      }
    }
    frontier = next;
  }
  return { stops, steps, cameFrom };
}

/**
 * The cells walked to reach a stop, from the first step to the stop itself.
 * Empty for the cell the unit stands on, null for a cell it cannot stop on.
 */
export function pathTo(reach: Reach, target: Cell): Cell[] | null {
  if (!reach.stops.has(cellKey(target))) return null;
  const path: Cell[] = [];
  let at: Cell | undefined = target;
  while (at && reach.cameFrom.has(cellKey(at))) {
    path.push(at);
    at = reach.cameFrom.get(cellKey(at));
  }
  return path.reverse();
}
