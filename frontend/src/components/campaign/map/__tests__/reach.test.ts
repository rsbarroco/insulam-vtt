/**
 * Where a unit can walk: the move budget, the jump limit on height, who it
 * walks through and round, where it may stop, large units, and the way back
 * from a stop to where it started.
 */

import { describe, it, expect } from 'vitest';
import {
  cellKey,
  computeReach,
  groundUnder,
  pathTo,
  type ReachBoard,
  type ReachUnit,
} from '../iso/reach';
import { createHeightGrid, withHeight, type HeightGrid } from '../iso/heightGrid';
import type { Cell } from '../iso/projection';

const COLS = 7;
const ROWS = 7;
const none = () => false;

const board = (over: Partial<ReachBoard> = {}): ReachBoard => ({
  cols: COLS,
  rows: ROWS,
  heights: null,
  blocked: none,
  occupied: none,
  ...over,
});

const unit = (over: Partial<ReachUnit> = {}): ReachUnit => ({
  cell: { x: 3, y: 3 },
  size: { width: 1, height: 1 },
  move: 2,
  jump: 1,
  ...over,
});

const at = (cells: Cell[]) => (origin: Cell) =>
  cells.some((cell) => cell.x === origin.x && cell.y === origin.y);
const raise = (grid: HeightGrid, cells: Array<[number, number, number]>) =>
  cells.reduce((g, [x, y, h]) => withHeight(g, x, y, h), grid);

describe('the move budget', () => {
  it('reaches a diamond of cells on open ground', () => {
    const reach = computeReach(unit({ move: 2 }), board());

    // 1 + 4 + 8 cells within two orthogonal steps.
    expect(reach.stops.size).toBe(13);
    expect(reach.stops.get('3,3')).toBe(0);
    expect(reach.stops.get('5,3')).toBe(2);
    expect(reach.stops.get('4,4')).toBe(2);
    expect(reach.stops.has('5,4')).toBe(false);
  });

  it('stays where it is with no move', () => {
    const reach = computeReach(unit({ move: 0 }), board());
    expect([...reach.stops.keys()]).toEqual(['3,3']);
  });

  it('stops at the edge of the board', () => {
    const reach = computeReach(unit({ cell: { x: 0, y: 0 }, move: 3 }), board());
    for (const key of reach.stops.keys()) {
      const [x, y] = key.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
    }
    expect(reach.stops.size).toBe(10);
  });
});

describe('height', () => {
  it('climbs a step within its jump and not one above it', () => {
    const heights = raise(createHeightGrid(COLS, ROWS), [
      [4, 3, 1],
      [3, 4, 2],
    ]);

    const reach = computeReach(unit({ move: 1, jump: 1 }), board({ heights }));

    expect(reach.stops.has('4,3')).toBe(true);
    expect(reach.stops.has('3,4')).toBe(false);
  });

  it('will not drop further than its jump either', () => {
    const heights = raise(createHeightGrid(COLS, ROWS), [[3, 3, 3]]);

    const reach = computeReach(unit({ move: 2, jump: 2 }), board({ heights }));

    expect([...reach.stops.keys()]).toEqual(['3,3']);
  });

  it('walks up a staircase one step at a time', () => {
    const heights = raise(createHeightGrid(COLS, ROWS), [
      [4, 3, 1],
      [5, 3, 2],
      [6, 3, 3],
    ]);

    const reach = computeReach(unit({ move: 3, jump: 1 }), board({ heights }));

    expect(reach.stops.get('6,3')).toBe(3);
  });

  it('goes round a wall it cannot climb when it has the move for it', () => {
    // A wall across x = 4 with a gap at the top row.
    const wall: Array<[number, number, number]> = [];
    for (let y = 0; y < ROWS - 1; y++) wall.push([4, y, 9]);
    const heights = raise(createHeightGrid(COLS, ROWS), wall);

    const short = computeReach(unit({ move: 4 }), board({ heights }));
    const long = computeReach(unit({ move: 8 }), board({ heights }));

    expect(short.stops.has('5,3')).toBe(false);
    // Up three, across two, down three.
    expect(long.stops.get('5,3')).toBe(8);
  });
});

describe('other units', () => {
  it('walks through its own side but does not stop on it', () => {
    const ally = [{ x: 4, y: 3 }];

    const reach = computeReach(unit({ move: 2 }), board({ occupied: at(ally) }));

    expect(reach.stops.has('4,3')).toBe(false);
    expect(reach.steps.get('4,3')).toBe(1);
    expect(reach.stops.get('5,3')).toBe(2);
  });

  it('does not walk through the other side', () => {
    const enemy = [{ x: 4, y: 3 }];

    const reach = computeReach(
      unit({ move: 2 }),
      board({ blocked: at(enemy), occupied: at(enemy) })
    );

    expect(reach.steps.has('4,3')).toBe(false);
    expect(reach.stops.has('5,3')).toBe(false);
  });

  it('may always stay where it stands', () => {
    const reach = computeReach(unit({ move: 1 }), board({ occupied: () => true }));
    expect([...reach.stops.keys()]).toEqual(['3,3']);
  });
});

describe('a large unit', () => {
  const big = { width: 2, height: 2 };

  it('keeps its whole footprint on the board', () => {
    const reach = computeReach(unit({ cell: { x: 5, y: 5 }, size: big, move: 2 }), board());

    for (const key of reach.stops.keys()) {
      const [x, y] = key.split(',').map(Number);
      expect(x + 2).toBeLessThanOrEqual(COLS);
      expect(y + 2).toBeLessThanOrEqual(ROWS);
    }
    expect(reach.stops.has('5,5')).toBe(true);
    expect(reach.stops.has('6,5')).toBe(false);
  });

  it('stands on the tallest ground under it', () => {
    const heights = raise(createHeightGrid(COLS, ROWS), [[5, 4, 4]]);
    expect(groundUnder({ x: 4, y: 3 }, big, heights)).toBe(4);
    expect(groundUnder({ x: 0, y: 0 }, big, heights)).toBe(0);
  });

  it('is stopped by one tall cell under its next footprint', () => {
    // Moving east from (3,3) would cover (5,3) and (5,4).
    const heights = raise(createHeightGrid(COLS, ROWS), [[5, 4, 4]]);

    const reach = computeReach(unit({ size: big, move: 1, jump: 1 }), board({ heights }));

    expect(reach.stops.has('4,3')).toBe(false);
    expect(reach.stops.has('2,3')).toBe(true);
  });
});

describe('pathTo', () => {
  it('lists the cells walked, ending on the stop', () => {
    const reach = computeReach(unit({ move: 3 }), board());

    const path = pathTo(reach, { x: 6, y: 3 });

    expect(path).toEqual([
      { x: 4, y: 3 },
      { x: 5, y: 3 },
      { x: 6, y: 3 },
    ]);
  });

  it('is as long as the cost of the stop, each step next to the last', () => {
    const heights = raise(createHeightGrid(COLS, ROWS), [
      [4, 3, 9],
      [4, 2, 9],
      [4, 4, 9],
    ]);
    const reach = computeReach(unit({ move: 6 }), board({ heights }));
    const target = { x: 5, y: 3 };

    const path = pathTo(reach, target)!;

    expect(path).toHaveLength(reach.stops.get(cellKey(target))!);
    let previous = { x: 3, y: 3 };
    for (const step of path) {
      expect(Math.abs(step.x - previous.x) + Math.abs(step.y - previous.y)).toBe(1);
      previous = step;
    }
  });

  it('is empty for the cell the unit stands on', () => {
    expect(pathTo(computeReach(unit(), board()), { x: 3, y: 3 })).toEqual([]);
  });

  it('is null for a cell out of reach, and for one it can only pass through', () => {
    const ally = [{ x: 4, y: 3 }];
    const reach = computeReach(unit({ move: 2 }), board({ occupied: at(ally) }));

    expect(pathTo(reach, { x: 6, y: 6 })).toBeNull();
    expect(pathTo(reach, { x: 4, y: 3 })).toBeNull();
  });
});
