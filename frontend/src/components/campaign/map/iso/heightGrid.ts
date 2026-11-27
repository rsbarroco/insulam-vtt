// ============================================
// Tile heights for the tactical (isometric) view
//
// One whole number per map cell. Cells use the TOKEN convention: x grows to
// the east and y grows to the north, with (0, 0) the bottom-left cell, the
// same as `token.position` (see ../coords.ts). The array is row-major from
// that origin: `heights[y * cols + x]`.
//
// A map with no height data is a flat board, so every reader here treats a
// missing grid, or a cell outside it, as height 0.
//
// Pure: no React, no canvas.
// ============================================

/** The tallest a cell can be, in height steps. */
export const MAX_TILE_HEIGHT = 32;

export interface HeightGrid {
  /** Map width in cells. */
  readonly cols: number;
  /** Map height in cells. */
  readonly rows: number;
  /** `cols * rows` whole numbers from 0 to MAX_TILE_HEIGHT. */
  readonly heights: readonly number[];
  /**
   * Difficult Terrain, one 0 or 1 per cell in the same order: every foot of
   * movement into a marked cell costs a foot more. Absent when no cell is.
   */
  readonly difficult?: readonly number[];
  /**
   * Impassable squares (a tree, a boulder, a pillar), one 0 or 1 per cell in
   * the same order: nobody walks into or through a marked cell. Absent when no
   * cell is.
   */
  readonly blocked?: readonly number[];
  /**
   * The rise, in height steps, that nobody can climb: a rise this tall or
   * taller between neighbouring cells is a wall. Absent when every rise can
   * be climbed.
   */
  readonly cliff?: number;
}

/** The per-cell marks stored beside the heights. */
export type CellMark = 'difficult' | 'blocked';

/** A flat board of the given size. */
export function createHeightGrid(cols: number, rows: number): HeightGrid {
  return { cols, rows, heights: new Array<number>(cols * rows).fill(0) };
}

/** Whether a cell lies on the board. */
export function inBounds(grid: Pick<HeightGrid, 'cols' | 'rows'>, x: number, y: number): boolean {
  return (
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < grid.cols && y < grid.rows
  );
}

/** Height of a cell. 0 without a grid and for a cell outside it. */
export function heightAt(grid: HeightGrid | null | undefined, x: number, y: number): number {
  if (!grid || !inBounds(grid, x, y)) return 0;
  return grid.heights[y * grid.cols + x] ?? 0;
}

/** Clamp any number to a storable height. */
export function clampHeight(height: number): number {
  if (!Number.isFinite(height)) return 0;
  return Math.min(MAX_TILE_HEIGHT, Math.max(0, Math.round(height)));
}

/**
 * A copy of the grid with one cell changed. A cell outside the board returns
 * the same grid, as does a height the cell already has, so callers can compare
 * by identity to see whether anything changed.
 */
export function withHeight(grid: HeightGrid, x: number, y: number, height: number): HeightGrid {
  if (!inBounds(grid, x, y)) return grid;
  const next = clampHeight(height);
  const index = y * grid.cols + x;
  if (grid.heights[index] === next) return grid;
  const heights = grid.heights.slice();
  heights[index] = next;
  return { ...grid, heights };
}

/** Whether a cell carries a mark. False without a grid and outside it. */
export function hasMark(grid: HeightGrid | null | undefined, mark: CellMark, x: number, y: number): boolean {
  const marks = grid?.[mark];
  if (!grid || !marks || !inBounds(grid, x, y)) return false;
  return marks[y * grid.cols + x] === 1;
}

/** A copy of the grid with one cell marked, or cleared. The same grid when nothing changes. */
export function withMark(grid: HeightGrid, mark: CellMark, x: number, y: number, on: boolean): HeightGrid {
  if (!inBounds(grid, x, y) || hasMark(grid, mark, x, y) === on) return grid;
  const current = grid[mark];
  const marks = current ? current.slice() : new Array<number>(grid.cols * grid.rows).fill(0);
  marks[y * grid.cols + x] = on ? 1 : 0;
  return { ...grid, [mark]: marks };
}

/** Whether a cell is Difficult Terrain. False without a grid and outside it. */
export function isDifficult(grid: HeightGrid | null | undefined, x: number, y: number): boolean {
  return hasMark(grid, 'difficult', x, y);
}

/** A copy of the grid with one cell marked Difficult Terrain, or cleared. The same grid when nothing changes. */
export function withDifficult(grid: HeightGrid, x: number, y: number, on: boolean): HeightGrid {
  return withMark(grid, 'difficult', x, y, on);
}

/** Whether a cell is impassable. False without a grid and outside it. */
export function isBlocked(grid: HeightGrid | null | undefined, x: number, y: number): boolean {
  return hasMark(grid, 'blocked', x, y);
}

/** A copy of the grid with one cell made impassable, or cleared. The same grid when nothing changes. */
export function withBlocked(grid: HeightGrid, x: number, y: number, on: boolean): HeightGrid {
  return withMark(grid, 'blocked', x, y, on);
}

/** A copy of the grid with a new cliff height; 0 or less means every rise can be climbed. */
export function withCliff(grid: HeightGrid, cliff: number): HeightGrid {
  const next = clampHeight(cliff);
  if ((grid.cliff ?? 0) === next) return grid;
  const { cliff: _old, ...rest } = grid;
  return next > 0 ? { ...rest, cliff: next } : rest;
}

/** The tallest cell on the board. 0 without a grid. */
export function tallestHeight(grid: HeightGrid | null | undefined): number {
  if (!grid) return 0;
  let tallest = 0;
  for (const height of grid.heights) {
    if (height > tallest) tallest = height;
  }
  return tallest;
}

/** Whether a value read from storage or the network is a usable grid. */
export function isHeightGrid(value: unknown): value is HeightGrid {
  if (typeof value !== 'object' || value === null) return false;
  const { cols, rows, heights } = value as Record<string, unknown>;
  if (typeof cols !== 'number' || typeof rows !== 'number') return false;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return false;
  if (!Array.isArray(heights) || heights.length !== cols * rows) return false;
  for (const name of ['difficult', 'blocked'] as const) {
    const marks = (value as Record<string, unknown>)[name];
    if (marks === undefined) continue;
    if (!Array.isArray(marks) || marks.length !== cols * rows) return false;
    if (!marks.every((mark) => mark === 0 || mark === 1)) return false;
  }
  const { cliff } = value as Record<string, unknown>;
  if (cliff !== undefined && (typeof cliff !== 'number' || !Number.isInteger(cliff) || cliff < 0 || cliff > MAX_TILE_HEIGHT)) {
    return false;
  }
  return heights.every(
    (height) =>
      typeof height === 'number' &&
      Number.isInteger(height) &&
      height >= 0 &&
      height <= MAX_TILE_HEIGHT
  );
}
