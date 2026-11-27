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
  /** Difficult Terrain: a 0 or 1 for each square, in the same order. Absent when no square is marked. */
  difficult?: number[];
  /** Impassable squares (a tree, a boulder, a pillar): a 0 or 1 for each square. Absent when none is. */
  blocked?: number[];
  /**
   * The rise, in height steps, from which a climb is a wall nobody walks up:
   * a rise this tall or taller between neighbouring squares cannot be crossed.
   * Absent when every rise can be climbed.
   */
  cliff?: number;
}

/** Request-body schema for a map's cliff height: 0 for none, else a rise in height steps. */
export const CliffSchema = z
  .number({ error: 'cliff must be a number' })
  .int('cliff must be a whole number')
  .min(0, 'cliff cannot be below 0')
  .max(MAX_TILE_HEIGHT, `cliff cannot be above ${MAX_TILE_HEIGHT}`);

/** The per-square marks stored beside the heights, each a 0 or 1 for every square. */
export const CELL_MARKS = ['difficult', 'blocked'] as const;
export type CellMark = (typeof CELL_MARKS)[number];

function readMarks(value: unknown, cells: number): number[] | null {
  return Array.isArray(value) && value.length === cells && value.every((mark) => mark === 0 || mark === 1) && value.includes(1)
    ? (value as number[])
    : null;
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
  const read: TileHeights = { cols, rows, heights: heights as number[] };
  for (const name of CELL_MARKS) {
    const marks = readMarks((stored as Record<string, unknown>)[name], cols * rows);
    if (marks) read[name] = marks;
  }
  const { cliff } = stored as Record<string, unknown>;
  if (CliffSchema.safeParse(cliff).success && (cliff as number) > 0) read.cliff = cliff as number;
  return read;
}

/** Request-body schema for one of a map's square marks (Difficult Terrain, impassable): a 0 or 1 for each square. */
export function marksSchemaFor(map: { width: number; height: number }, name: CellMark = 'difficult') {
  const cells = map.width * map.height;
  return z
    .array(z.union([z.literal(0), z.literal(1)], { error: 'Each square is marked with 0 or 1' }), {
      error: `${name} must be an array of 0s and 1s`,
    })
    .length(cells, `${name} must have one mark for each of the map's ${cells} squares`);
}

/** Request-body schema for a map's Difficult Terrain. */
export function difficultSchemaFor(map: { width: number; height: number }) {
  return marksSchemaFor(map, 'difficult');
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
  const marks = Object.fromEntries(CELL_MARKS.map((name) => [name, new Array<number>(cols * rows).fill(0)])) as Record<
    CellMark,
    number[]
  >;
  for (let y = 0; y < Math.min(rows, current.rows); y++) {
    for (let x = 0; x < Math.min(cols, current.cols); x++) {
      heights[y * cols + x] = current.heights[y * current.cols + x];
      for (const name of CELL_MARKS) marks[name][y * cols + x] = current[name]?.[y * current.cols + x] ?? 0;
    }
  }
  const resized: TileHeights = { cols, rows, heights };
  for (const name of CELL_MARKS) if (marks[name].includes(1)) resized[name] = marks[name];
  if (current.cliff) resized.cliff = current.cliff;
  return resized;
}
