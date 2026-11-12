/**
 * Isometric projection tests.
 *
 * The tactical view draws the same cells as the top-down view, so these pin
 * the things that would put a tile, a token or a click in the wrong place:
 * the diamond's shape, each camera turn, the draw order, and that picking is
 * the inverse of projecting, on flat ground and on raised tiles.
 */

import { describe, it, expect } from 'vitest';
import {
  cellDepth,
  cellDiamond,
  drawOrder,
  footprintCentre,
  isoBoardSize,
  isoMetrics,
  pickCell,
  projectPoint,
  turnCamera,
  unprojectPoint,
  type IsoView,
  type QuarterTurn,
} from '../iso/projection';
import {
  clampHeight,
  createHeightGrid,
  heightAt,
  isHeightGrid,
  MAX_TILE_HEIGHT,
  tallestHeight,
  withHeight,
} from '../iso/heightGrid';

const TURNS: QuarterTurn[] = [0, 1, 2, 3];

function view(rotation: QuarterTurn = 0, cols = 6, rows = 4): IsoView {
  return { cols, rows, gridSize: 50, rotation };
}

describe('height grid', () => {
  it('starts flat and reads 0 outside the board or without a grid', () => {
    const grid = createHeightGrid(3, 2);
    expect(grid.heights).toHaveLength(6);
    expect(heightAt(grid, 1, 1)).toBe(0);
    expect(heightAt(grid, 3, 0)).toBe(0);
    expect(heightAt(grid, 0, -1)).toBe(0);
    expect(heightAt(null, 0, 0)).toBe(0);
  });

  it('stores heights row-major from the bottom-left cell', () => {
    const grid = withHeight(createHeightGrid(3, 2), 2, 1, 5);
    expect(grid.heights[1 * 3 + 2]).toBe(5);
    expect(heightAt(grid, 2, 1)).toBe(5);
  });

  it('does not change the grid it was given', () => {
    const flat = createHeightGrid(2, 2);
    const raised = withHeight(flat, 0, 0, 3);
    expect(flat.heights[0]).toBe(0);
    expect(raised).not.toBe(flat);
  });

  it('returns the same grid when nothing changes', () => {
    const grid = withHeight(createHeightGrid(2, 2), 1, 1, 4);
    expect(withHeight(grid, 1, 1, 4)).toBe(grid);
    expect(withHeight(grid, 5, 5, 4)).toBe(grid);
  });

  it('clamps and rounds heights', () => {
    expect(clampHeight(-2)).toBe(0);
    expect(clampHeight(2.6)).toBe(3);
    expect(clampHeight(999)).toBe(MAX_TILE_HEIGHT);
    expect(clampHeight(Number.NaN)).toBe(0);
  });

  it('finds the tallest cell', () => {
    expect(tallestHeight(null)).toBe(0);
    expect(tallestHeight(withHeight(withHeight(createHeightGrid(2, 2), 0, 0, 2), 1, 1, 7))).toBe(7);
  });

  it('recognises a usable grid', () => {
    expect(isHeightGrid(createHeightGrid(2, 3))).toBe(true);
    expect(isHeightGrid(null)).toBe(false);
    expect(isHeightGrid({ cols: 2, rows: 2, heights: [0, 0, 0] })).toBe(false);
    expect(isHeightGrid({ cols: 1, rows: 1, heights: [MAX_TILE_HEIGHT + 1] })).toBe(false);
    expect(isHeightGrid({ cols: 1, rows: 1, heights: [1.5] })).toBe(false);
    expect(isHeightGrid({ cols: 0, rows: 1, heights: [] })).toBe(false);
  });
});

describe('diamond shape', () => {
  it('draws a cell twice as wide as it is tall', () => {
    const { top, right, bottom, left } = cellDiamond({ x: 2, y: 1 }, 0, view());
    expect(right.x - left.x).toBeCloseTo(2 * (bottom.y - top.y));
    expect(top.x).toBeCloseTo(bottom.x);
    expect(left.y).toBeCloseTo(right.y);
  });

  it('lifts a raised cell straight up by one step per height', () => {
    const { stepH } = isoMetrics(50);
    const ground = cellDiamond({ x: 2, y: 1 }, 0, view());
    const raised = cellDiamond({ x: 2, y: 1 }, 3, view());
    expect(raised.top.x).toBeCloseTo(ground.top.x);
    expect(ground.top.y - raised.top.y).toBeCloseTo(3 * stepH);
  });

  it.each(TURNS)('keeps the whole board inside its box at turn %i', (rotation) => {
    const v = view(rotation);
    const box = isoBoardSize(v);
    for (const [x, y] of [
      [0, 0],
      [v.cols, 0],
      [0, v.rows],
      [v.cols, v.rows],
    ]) {
      for (const height of [0, MAX_TILE_HEIGHT]) {
        const point = projectPoint(x, y, height, v);
        expect(point.x).toBeGreaterThanOrEqual(-1e-9);
        expect(point.x).toBeLessThanOrEqual(box.w + 1e-9);
        expect(point.y).toBeGreaterThanOrEqual(-1e-9);
        expect(point.y).toBeLessThanOrEqual(box.h + 1e-9);
      }
    }
  });
});

describe('camera turns', () => {
  it('cycles through four views in both directions', () => {
    expect(turnCamera(0, 1)).toBe(1);
    expect(turnCamera(3, 1)).toBe(0);
    expect(turnCamera(0, -1)).toBe(3);
  });

  it('puts the north-west corner farthest away in the default view', () => {
    const v = view(0);
    const northWest = cellDepth({ x: 0, y: v.rows - 1 }, v);
    const southEast = cellDepth({ x: v.cols - 1, y: 0 }, v);
    expect(northWest).toBeLessThan(southEast);
  });

  it('brings a different corner to the front with each turn', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 3 },
      { x: 0, y: 3 },
    ];
    const nearest = TURNS.map((rotation) => {
      const v = view(rotation);
      return corners.reduce((best, corner) =>
        cellDepth(corner, v) > cellDepth(best, v) ? corner : best
      );
    });
    expect(new Set(nearest.map((c) => `${c.x},${c.y}`)).size).toBe(4);
  });

  it('moves the viewer from the south-east to the north-east on the first turn', () => {
    const v = view(1);
    const corners = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 3 },
      { x: 0, y: 3 },
    ];
    const nearest = corners.reduce((best, corner) =>
      cellDepth(corner, v) > cellDepth(best, v) ? corner : best
    );
    expect(nearest).toEqual({ x: 5, y: 3 });
  });
});

describe('draw order', () => {
  it.each(TURNS)('lists every cell once, farthest first, at turn %i', (rotation) => {
    const v = view(rotation);
    const order = drawOrder(v);
    expect(order).toHaveLength(v.cols * v.rows);
    expect(new Set(order.map((c) => `${c.x},${c.y}`)).size).toBe(v.cols * v.rows);
    for (let i = 1; i < order.length; i++) {
      expect(cellDepth(order[i], v)).toBeGreaterThanOrEqual(cellDepth(order[i - 1], v));
    }
  });
});

describe('projecting and picking', () => {
  it.each(TURNS)('unprojects what it projects at turn %i', (rotation) => {
    const v = view(rotation);
    for (const height of [0, 2, 7]) {
      const iso = projectPoint(2.25, 1.75, height, v);
      const back = unprojectPoint(iso.x, iso.y, height, v);
      expect(back.x).toBeCloseTo(2.25);
      expect(back.y).toBeCloseTo(1.75);
    }
  });

  it.each(TURNS)('picks every cell of a flat board from its centre at turn %i', (rotation) => {
    const v = view(rotation);
    for (const cell of drawOrder(v)) {
      const centre = footprintCentre(cell, { width: 1, height: 1 }, 0, v);
      expect(pickCell(centre.x, centre.y, v, null)).toEqual(cell);
    }
  });

  it.each(TURNS)('picks a raised cell from the centre of its top at turn %i', (rotation) => {
    const v = view(rotation);
    const raised = { x: 3, y: 2 };
    const heights = withHeight(createHeightGrid(v.cols, v.rows), raised.x, raised.y, 6);
    const centre = footprintCentre(raised, { width: 1, height: 1 }, 6, v);
    expect(pickCell(centre.x, centre.y, v, heights)).toEqual(raised);
  });

  it('picks a tall cell through its side, not the ground behind the pixel', () => {
    const v = view(0);
    const tower = { x: 2, y: 2 };
    const heights = withHeight(createHeightGrid(v.cols, v.rows), tower.x, tower.y, 8);
    // Halfway up the front corner of the tower.
    const { bottom } = cellDiamond(tower, 4, v);
    expect(pickCell(bottom.x, bottom.y - 1, v, heights)).toEqual(tower);
  });

  it('picks the ground that a low cell leaves visible behind it', () => {
    const v = view(0);
    const heights = withHeight(createHeightGrid(v.cols, v.rows), 3, 1, 1);
    const behind = { x: 2, y: 3 };
    const centre = footprintCentre(behind, { width: 1, height: 1 }, 0, v);
    expect(pickCell(centre.x, centre.y, v, heights)).toEqual(behind);
  });

  it('picks nothing outside the board', () => {
    expect(pickCell(-500, -500, view(), null)).toBeNull();
    const box = isoBoardSize(view());
    expect(pickCell(box.w + 500, box.h + 500, view(), null)).toBeNull();
  });

  it('centres a large footprint on the middle of its cells', () => {
    const v = view();
    const centre = footprintCentre({ x: 1, y: 1 }, { width: 2, height: 2 }, 0, v);
    const middle = projectPoint(2, 2, 0, v);
    expect(centre.x).toBeCloseTo(middle.x);
    expect(centre.y).toBeCloseTo(middle.y);
  });
});
