// ============================================
// Where a creature can walk on the tactical board
//
// Movement by the D&D rules, on a grid with heights. A creature spends its
// speed, in feet, a square at a time in eight directions. The conventions
// that turn the rules into squares and height steps are the ones written
// down in docs/TACTICAL_MODE.md ("Where the rules meet the board"):
//
//   • A square is `feetPerSquare` feet. A diagonal costs one square, or
//     alternately one and two, as the map's diagonal rule says.
//   • A height step is half a square. A rise or drop of one step between
//     neighbouring squares is a slope and costs nothing extra.
//   • A larger rise is a climb: each foot climbed costs a foot more.
//   • A larger drop is climbed down at the same price, unless it is 10 feet
//     or more: that one is jumped, costs nothing extra, and is a fall.
//
// A Prone creature crawls: each foot of the way costs a foot more.
//
// A creature walks through others on its own side and round the rest, and
// stops on no occupied square. One larger than a square moves as a block
// and stands on the tallest ground it covers.
//
// Pure: no React, no canvas.
// ============================================

import { heightAt, type HeightGrid } from './heightGrid';
import type { Cell } from './projection';

/** A drop of at least this many feet is a fall. */
export const FALL_FEET = 10;

export interface ReachUnit {
  /** Bottom-left cell of the footprint, where the creature stands now. */
  readonly cell: Cell;
  readonly size: { readonly width: number; readonly height: number };
  /** Feet it can move. */
  readonly speed: number;
  /** It is Prone and crawls: every foot of movement costs a foot more. */
  readonly crawling?: boolean;
}

export interface ReachBoard {
  readonly cols: number;
  readonly rows: number;
  readonly heights: HeightGrid | null;
  /** Feet across one square. */
  readonly feetPerSquare: number;
  /** `flat`: every diagonal is one square. `alternating`: one, then two, and so on. */
  readonly diagonalRule: 'flat' | 'alternating';
  /** Whether the creature, with its footprint at this cell, would overlap someone it cannot walk through. */
  readonly blocked: (origin: Cell) => boolean;
  /** Whether the creature, with its footprint at this cell, would overlap anyone at all. */
  readonly occupied: (origin: Cell) => boolean;
}

/** One cell the creature can stop on. */
export interface ReachStop {
  /** Feet of movement spent to get there. */
  readonly feet: number;
  /** Feet fallen on the way, each fall of 10 feet or more added up. */
  readonly fallFeet: number;
}

export interface Reach {
  /** Cells the creature can stop on, by `cellKey`. */
  readonly stops: ReadonlyMap<string, ReachStop>;
  /** Internal: how each walked state was reached, for `pathTo`. */
  readonly trail: ReadonlyMap<string, { from: string | null; cell: Cell }>;
  /** Internal: the cheapest state for each stop. */
  readonly best: ReadonlyMap<string, string>;
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

/** Feet in one height step: half a square. */
export function feetPerStep(feetPerSquare: number): number {
  return feetPerSquare / 2;
}

/**
 * What a change of height between neighbouring squares costs on top of the
 * square itself, and how far the creature falls. `rise` is in height steps,
 * negative for a drop.
 */
export function heightCost(
  rise: number,
  feetPerSquare: number
): { extraFeet: number; fallFeet: number } {
  const feet = Math.abs(rise) * feetPerStep(feetPerSquare);
  if (Math.abs(rise) <= 1) return { extraFeet: 0, fallFeet: 0 };
  if (rise < 0 && feet >= FALL_FEET) return { extraFeet: 0, fallFeet: feet };
  return { extraFeet: feet, fallFeet: 0 };
}

const STEPS: ReadonlyArray<Cell & { diagonal: boolean }> = [
  { x: 1, y: 0, diagonal: false },
  { x: -1, y: 0, diagonal: false },
  { x: 0, y: 1, diagonal: false },
  { x: 0, y: -1, diagonal: false },
  { x: 1, y: 1, diagonal: true },
  { x: 1, y: -1, diagonal: true },
  { x: -1, y: 1, diagonal: true },
  { x: -1, y: -1, diagonal: true },
];

interface State {
  cell: Cell;
  /** Diagonals taken so far, odd or even: decides the next one's cost under the alternating rule. */
  parity: 0 | 1;
  feet: number;
  fallFeet: number;
}

const stateKey = (cell: Cell, parity: 0 | 1) => `${cell.x},${cell.y},${parity}`;

/**
 * Everywhere the creature can move with its speed. Steps cost different
 * amounts, so this walks outwards cheapest first. The cell it stands on is
 * always a stop, at no cost.
 */
export function computeReach(unit: ReachUnit, board: ReachBoard): Reach {
  const stops = new Map<string, ReachStop>();
  const best = new Map<string, string>();
  const trail = new Map<string, { from: string | null; cell: Cell }>();
  const settled = new Map<string, number>();
  const square = board.feetPerSquare;
  const speed = Math.max(0, unit.speed);
  const fits = (origin: Cell) =>
    origin.x >= 0 &&
    origin.y >= 0 &&
    origin.x + unit.size.width <= board.cols &&
    origin.y + unit.size.height <= board.rows;

  const startKey = stateKey(unit.cell, 0);
  const queue: Array<State & { key: string; from: string | null }> = [
    { cell: unit.cell, parity: 0, feet: 0, fallFeet: 0, key: startKey, from: null },
  ];

  while (queue.length > 0) {
    // Cheapest first. The board is small, so a linear scan is enough.
    let index = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].feet < queue[index].feet) index = i;
    const [state] = queue.splice(index, 1);
    if (settled.has(state.key)) continue;
    settled.set(state.key, state.feet);
    trail.set(state.key, { from: state.from, cell: state.cell });

    const isStart = state.cell.x === unit.cell.x && state.cell.y === unit.cell.y;
    if (isStart || !board.occupied(state.cell)) {
      const key = cellKey(state.cell);
      const known = stops.get(key);
      if (!known || state.feet < known.feet) {
        stops.set(key, { feet: state.feet, fallFeet: state.fallFeet });
        best.set(key, state.key);
      }
    }

    const ground = groundUnder(state.cell, unit.size, board.heights);
    for (const step of STEPS) {
      const to = { x: state.cell.x + step.x, y: state.cell.y + step.y };
      if (!fits(to) || board.blocked(to)) continue;
      const parity: 0 | 1 = step.diagonal ? (state.parity === 0 ? 1 : 0) : state.parity;
      const key = stateKey(to, parity);
      if (settled.has(key)) continue;
      const across =
        step.diagonal && board.diagonalRule === 'alternating' && state.parity === 1
          ? 2 * square
          : square;
      const height = heightCost(groundUnder(to, unit.size, board.heights) - ground, square);
      const feet = state.feet + across * (unit.crawling ? 2 : 1) + height.extraFeet;
      if (feet > speed) continue;
      queue.push({
        cell: to,
        parity,
        feet,
        fallFeet: state.fallFeet + height.fallFeet,
        key,
        from: state.key,
      });
    }
  }
  return { stops, trail, best };
}

/**
 * The cells walked to reach a stop, from the first step to the stop itself.
 * Empty for the cell the creature stands on, null for a cell it cannot stop on.
 */
export function pathTo(reach: Reach, target: Cell): Cell[] | null {
  let key = reach.best.get(cellKey(target)) ?? null;
  if (key === null) return null;
  const path: Cell[] = [];
  while (key !== null) {
    const step = reach.trail.get(key);
    if (!step) break;
    if (step.from !== null) path.push(step.cell);
    key = step.from;
  }
  return path.reverse();
}

/** The falling damage the rules give for a fall: 1d6 for each 10 feet, at most 20d6. */
export function fallDamageDice(fallFeet: number): number {
  return Math.min(20, Math.floor(fallFeet / 10));
}
