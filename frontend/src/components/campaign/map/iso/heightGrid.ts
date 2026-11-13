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
}

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

/** Whether a cell is Difficult Terrain. False without a grid and outside it. */
export function isDifficult(grid: HeightGrid | null | undefined, x: number, y: number): boolean {
  if (!grid?.difficult || !inBounds(grid, x, y)) return false;
  return grid.difficult[y * grid.cols + x] === 1;
}

/** A copy of the grid with one cell marked Difficult Terrain, or cleared. The same grid when nothing changes. */
export function withDifficult(grid: HeightGrid, x: number, y: number, on: boolean): HeightGrid {
  if (!inBounds(grid, x, y) || isDifficult(grid, x, y) === on) return grid;
  const difficult = grid.difficult ? grid.difficult.slice() : new Array<number>(grid.cols * grid.rows).fill(0);
  difficult[y * grid.cols + x] = on ? 1 : 0;
  return { ...grid, difficult };
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
  const { difficult } = value as Record<string, unknown>;
  if (difficult !== undefined) {
    if (!Array.isArray(difficult) || difficult.length !== cols * rows) return false;
    if (!difficult.every((mark) => mark === 0 || mark === 1)) return false;
  }
  return heights.every(
    (height) =>
      typeof height === 'number' &&
      Number.isInteger(height) &&
      height >= 0 &&
      height <= MAX_TILE_HEIGHT
  );
}
