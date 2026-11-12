// ============================================
// Tile heights for the tactical (isometric) view
//
// One whole number per map cell, stored on `Map.tileHeights` as
// `{ cols, rows, heights }`. Cells use the token convention: x grows to the
// east and y to the north from the bottom-left cell, and the array is
// row-major from that origin (`heights[y * cols + x]`). The frontend reads the
// same shape in `components/campaign/map/iso/heightGrid.ts`.
//
// A map with no height data is a flat board, stored as NULL.
// ============================================

import { z } from 'zod';

/** The tallest a cell can be, in height steps. Same number as the frontend's. */
export const MAX_TILE_HEIGHT = 32;

export interface TileHeights {
  cols: number;
  rows: number;
  heights: number[];
}

const HeightSchema = z
  .number({ error: 'Each height must be a number' })
  .int('Each height must be a whole number')
  .min(0, 'A height cannot be below 0')
  .max(MAX_TILE_HEIGHT, `A height cannot be above ${MAX_TILE_HEIGHT}`);

/** The `heights` array of a request, for a map of the given size. */
export function heightsSchemaFor(map: { width: number; height: number }) {
  const cells = map.width * map.height;
  return z
    .array(HeightSchema, { error: 'heights must be an array of numbers' })
    .length(cells, `heights must have one number for each of the map's ${cells} squares`);
}

/** Stored heights as read back, or null when there are none or they cannot be read. */
export function readTileHeights(stored: unknown): TileHeights | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const { cols, rows, heights } = stored as Record<string, unknown>;
  if (typeof cols !== 'number' || typeof rows !== 'number') return null;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return null;
  if (!Array.isArray(heights) || heights.length !== cols * rows) return null;
  if (!z.array(HeightSchema).safeParse(heights).success) return null;
  return { cols, rows, heights: heights as number[] };
}

/** Whether every cell is at height 0, which is stored as no heights at all. */
export function isFlat(heights: readonly number[]): boolean {
  return heights.every((height) => height === 0);
}

/**
 * Heights for a map whose size changed. The bottom-left cell stays where it
 * is, as tokens do: cells that still exist keep their height, cells cut off
 * are dropped, and new cells start at 0.
 */
export function resizeTileHeights(current: TileHeights, cols: number, rows: number): TileHeights {
  const heights = new Array<number>(cols * rows).fill(0);
  for (let y = 0; y < Math.min(rows, current.rows); y++) {
    for (let x = 0; x < Math.min(cols, current.cols); x++) {
      heights[y * cols + x] = current.heights[y * current.cols + x];
    }
  }
  return { cols, rows, heights };
}
