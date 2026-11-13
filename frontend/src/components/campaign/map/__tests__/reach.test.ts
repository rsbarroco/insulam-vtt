/**
 * Where a creature can move by the D&D rules on a board with heights: its
 * speed in feet, diagonals under each map rule, slopes, climbs and falls,
 * who it walks through and round, where it may stop, large creatures, and
 * the way from where it stands to a stop.
 */

import { describe, it, expect } from 'vitest';
import {
  cellKey,
  computeReach,
  fallDamageDice,
  groundUnder,
  heightCost,
  pathTo,
  type ReachBoard,
  type ReachUnit,
} from '../iso/reach';
import { createHeightGrid, withHeight, type HeightGrid } from '../iso/heightGrid';
import type { Cell } from '../iso/projection';

const COLS = 9;
const ROWS = 9;
const none = () => false;

const board = (over: Partial<ReachBoard> = {}): ReachBoard => ({
  cols: COLS,
  rows: ROWS,
  heights: null,
  feetPerSquare: 5,
  diagonalRule: 'flat',
  blocked: none,
  occupied: none,
  ...over,
});

const unit = (over: Partial<ReachUnit> = {}): ReachUnit => ({
  cell: { x: 4, y: 4 },
  size: { width: 1, height: 1 },
  speed: 10,
  ...over,
});

const at = (cells: Cell[]) => (origin: Cell) =>
  cells.some((cell) => cell.x === origin.x && cell.y === origin.y);
const raise = (grid: HeightGrid, cells: Array<[number, number, number]>) =>
  cells.reduce((g, [x, y, h]) => withHeight(g, x, y, h), grid);
const feetTo = (reach: ReturnType<typeof computeReach>, x: number, y: number) =>
  reach.stops.get(`${x},${y}`)?.feet;

describe('speed on open ground', () => {
  it('spends 5 feet a square and reaches nothing beyond its speed', () => {
    const reach = computeReach(unit({ speed: 10 }), board());

    expect(feetTo(reach, 4, 4)).toBe(0);
    expect(feetTo(reach, 6, 4)).toBe(10);
    expect(feetTo(reach, 7, 4)).toBeUndefined();
  });

  it('moves diagonally for one square each under the flat rule', () => {
    const reach = computeReach(unit({ speed: 10 }), board({ diagonalRule: 'flat' }));

    expect(feetTo(reach, 6, 6)).toBe(10);
    // Every cell within two squares in any direction: a 5 by 5 block.
    expect(reach.stops.size).toBe(25);
  });

  it('charges every second diagonal double under the alternating rule', () => {
    const reach = computeReach(unit({ speed: 15 }), board({ diagonalRule: 'alternating' }));

    expect(feetTo(reach, 5, 5)).toBe(5);
    expect(feetTo(reach, 6, 6)).toBe(15);
    expect(feetTo(reach, 7, 7)).toBeUndefined();
    // One diagonal then one straight is still two squares.
    expect(feetTo(reach, 6, 5)).toBe(10);
  });

  it('uses the scale of the map', () => {
    const reach = computeReach(unit({ speed: 30 }), board({ feetPerSquare: 10 }));

    expect(feetTo(reach, 7, 4)).toBe(30);
    expect(feetTo(reach, 8, 4)).toBeUndefined();
  });

  it('stays where it is with no speed', () => {
    const reach = computeReach(unit({ speed: 0 }), board());
    expect([...reach.stops.keys()]).toEqual(['4,4']);
  });

  it('stops at the edge of the board', () => {
    const reach = computeReach(unit({ cell: { x: 0, y: 0 }, speed: 10 }), board());
    expect(reach.stops.size).toBe(9);
  });
});

describe('heightCost', () => {
  it('charges nothing for a slope of one step either way', () => {
    expect(heightCost(1, 5)).toEqual({ extraFeet: 0, fallFeet: 0 });
    expect(heightCost(-1, 5)).toEqual({ extraFeet: 0, fallFeet: 0 });
    expect(heightCost(0, 5)).toEqual({ extraFeet: 0, fallFeet: 0 });
  });

  it('charges a foot more for each foot climbed, at half a square a step', () => {
    expect(heightCost(2, 5)).toEqual({ extraFeet: 5, fallFeet: 0 });
    expect(heightCost(6, 5)).toEqual({ extraFeet: 15, fallFeet: 0 });
  });

  it('climbs down a short drop and falls a drop of 10 feet or more', () => {
    expect(heightCost(-3, 5)).toEqual({ extraFeet: 7.5, fallFeet: 0 });
    expect(heightCost(-4, 5)).toEqual({ extraFeet: 0, fallFeet: 10 });
    expect(heightCost(-12, 5)).toEqual({ extraFeet: 0, fallFeet: 30 });
  });
});

describe('height on the board', () => {
  it('walks up a stair at no extra cost', () => {
    const heights = raise(createHeightGrid(COLS, ROWS), [
      [5, 4, 1],
      [6, 4, 2],
      [7, 4, 3],
    ]);

    const reach = computeReach(unit({ speed: 15 }), board({ heights }));

    expect(feetTo(reach, 7, 4)).toBe(15);
  });

  it('pays for a climb onto a ledge', () => {
    // A ledge four steps (10 feet) up: 5 feet across and 10 more to climb.
    const heights = raise(createHeightGrid(COLS, ROWS), [[5, 4, 4]]);

    expect(feetTo(computeReach(unit({ speed: 10 }), board({ heights })), 5, 4)).toBeUndefined();
    expect(feetTo(computeReach(unit({ speed: 15 }), board({ heights })), 5, 4)).toBe(15);
  });

  it('jumps off a ledge of 10 feet for the price of the square, and records the fall', () => {
    const heights = raise(createHeightGrid(COLS, ROWS), [[4, 4, 4]]);

    const reach = computeReach(unit({ speed: 5 }), board({ heights }));

    expect(reach.stops.get('5,4')).toEqual({ feet: 5, fallFeet: 10 });
  });

  it('goes round a wall too tall to climb with the speed it has', () => {
    // A wall across x = 5 with a gap in the top row.
    const wall: Array<[number, number, number]> = [];
    for (let y = 0; y < ROWS - 1; y++) wall.push([5, y, 32]);
    const heights = raise(createHeightGrid(COLS, ROWS), wall);

    const reach = computeReach(unit({ speed: 60 }), board({ heights }));

    // Up four rows to the gap, through it, and back down: ten squares with diagonals.
    const feet = feetTo(reach, 6, 4)!;
    expect(feet).toBeGreaterThan(10);
    expect(feet).toBeLessThanOrEqual(60);
    expect(reach.stops.get('6,4')?.fallFeet).toBe(0);
  });
});

describe('other creatures', () => {
  it('walks through its own side but does not stop on it', () => {
    const ally = [{ x: 5, y: 4 }];

    const reach = computeReach(unit({ speed: 10 }), board({ occupied: at(ally) }));

    expect(reach.stops.has('5,4')).toBe(false);
    expect(feetTo(reach, 6, 4)).toBe(10);
  });

  it('does not walk through the other side', () => {
    // Enemies fill the column to the east.
    const enemies: Cell[] = [];
    for (let y = 0; y < ROWS; y++) enemies.push({ x: 5, y });

    const reach = computeReach(
      unit({ speed: 30 }),
      board({ blocked: at(enemies), occupied: at(enemies) })
    );

    for (const key of reach.stops.keys()) expect(Number(key.split(',')[0])).toBeLessThan(5);
  });

  it('may always stay where it stands', () => {
    const reach = computeReach(unit({ speed: 5 }), board({ occupied: () => true }));
    expect([...reach.stops.keys()]).toEqual(['4,4']);
  });
});

describe('a large creature', () => {
  const big = { width: 2, height: 2 };

  it('keeps its whole footprint on the board', () => {
    const reach = computeReach(unit({ cell: { x: 7, y: 7 }, size: big, speed: 10 }), board());

    for (const key of reach.stops.keys()) {
      const [x, y] = key.split(',').map(Number);
      expect(x + 2).toBeLessThanOrEqual(COLS);
      expect(y + 2).toBeLessThanOrEqual(ROWS);
    }
    expect(reach.stops.has('7,7')).toBe(true);
    expect(reach.stops.has('8,7')).toBe(false);
  });

  it('stands on the tallest ground under it', () => {
    const heights = raise(createHeightGrid(COLS, ROWS), [[5, 5, 4]]);
    expect(groundUnder({ x: 4, y: 4 }, big, heights)).toBe(4);
    expect(groundUnder({ x: 0, y: 0 }, big, heights)).toBe(0);
  });

  it('pays to climb when one cell under its next footprint is tall', () => {
    // Moving east from (4,4) would cover (6,4) and (6,5).
    const heights = raise(createHeightGrid(COLS, ROWS), [[6, 5, 4]]);

    const reach = computeReach(unit({ size: big, speed: 5 }), board({ heights }));

    expect(reach.stops.has('5,4')).toBe(false);
    expect(reach.stops.has('3,4')).toBe(true);
  });
});

describe('pathTo', () => {
  it('lists the cells walked, ending on the stop', () => {
    const reach = computeReach(unit({ speed: 15 }), board());

    expect(pathTo(reach, { x: 7, y: 4 })).toEqual([
      { x: 5, y: 4 },
      { x: 6, y: 4 },
      { x: 7, y: 4 },
    ]);
  });

  it('moves one square at a time, in any of eight directions', () => {
    const reach = computeReach(unit({ speed: 30 }), board({ diagonalRule: 'alternating' }));
    const target = { x: 8, y: 7 };

    const path = pathTo(reach, target)!;

    let previous = { x: 4, y: 4 };
    for (const step of path) {
      expect(Math.max(Math.abs(step.x - previous.x), Math.abs(step.y - previous.y))).toBe(1);
      previous = step;
    }
    expect(previous).toEqual(target);
    expect(reach.stops.has(cellKey(target))).toBe(true);
  });

  it('is empty for the cell the creature stands on', () => {
    expect(pathTo(computeReach(unit(), board()), { x: 4, y: 4 })).toEqual([]);
  });

  it('is null for a cell out of reach, and for one it can only pass through', () => {
    const ally = [{ x: 5, y: 4 }];
    const reach = computeReach(unit({ speed: 10 }), board({ occupied: at(ally) }));

    expect(pathTo(reach, { x: 8, y: 8 })).toBeNull();
    expect(pathTo(reach, { x: 5, y: 4 })).toBeNull();
  });
});

describe('fallDamageDice', () => {
  it('is one d6 for each whole 10 feet, to at most twenty', () => {
    expect(fallDamageDice(0)).toBe(0);
    expect(fallDamageDice(10)).toBe(1);
    expect(fallDamageDice(35)).toBe(3);
    expect(fallDamageDice(900)).toBe(20);
  });
});

describe('a Prone creature', () => {
  it('crawls: every foot costs a foot more', () => {
    const reach = computeReach(unit({ speed: 20, crawling: true }), board());
    expect(reach.stops.get(cellKey({ x: 5, y: 4 }))?.feet).toBe(10);
    expect(reach.stops.get(cellKey({ x: 6, y: 4 }))?.feet).toBe(20);
    expect(reach.stops.has(cellKey({ x: 7, y: 4 }))).toBe(false);
  });

  it('gets half as far as one on its feet', () => {
    const walking = computeReach(unit({ speed: 30 }), board());
    const crawling = computeReach(unit({ speed: 30, crawling: true }), board());
    expect(walking.stops.has(cellKey({ x: 8, y: 4 }))).toBe(true);
    expect(crawling.stops.has(cellKey({ x: 7, y: 4 }))).toBe(true);
    expect(crawling.stops.has(cellKey({ x: 8, y: 4 }))).toBe(false);
  });
});
