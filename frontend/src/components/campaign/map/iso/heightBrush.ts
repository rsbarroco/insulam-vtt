// ============================================
// The DM's height brush for the tactical view
//
// What one touch of the brush does to one cell, and a stroke that touches
// each cell at most once however long the pointer rests on it.
//
// Pure: no React, no canvas.
// ============================================

import {
  clampHeight,
  createHeightGrid,
  heightAt,
  isDifficult,
  withDifficult,
  withHeight,
  type HeightGrid,
} from './heightGrid';
import type { Cell } from './projection';

/** Raise or lower by one step, or set to a chosen height. */
/** `difficult` marks squares as Difficult Terrain, or clears them when the stroke starts on a marked one. */
export type BrushMode = 'raise' | 'lower' | 'level' | 'difficult';

/** The height a cell has after one touch of the brush. */
export function brushedHeight(current: number, mode: BrushMode, level: number): number {
  if (mode === 'difficult') return current;
  if (mode === 'raise') return clampHeight(current + 1);
  if (mode === 'lower') return clampHeight(current - 1);
  return clampHeight(level);
}

/** A grid with one cell touched by the brush. The same grid when nothing changes. */
export function applyBrush(
  grid: HeightGrid,
  cell: Cell,
  mode: BrushMode,
  level: number
): HeightGrid {
  return withHeight(
    grid,
    cell.x,
    cell.y,
    brushedHeight(heightAt(grid, cell.x, cell.y), mode, level)
  );
}

/** One press-drag-release of the brush. */
export interface BrushStroke {
  /** The grid as it was when the stroke began, for undo. */
  readonly before: HeightGrid;
  readonly touched: ReadonlySet<string>;
  /** For the Difficult Terrain brush: whether this stroke marks or clears, set by its first square. */
  readonly marking?: boolean;
}

export function beginStroke(before: HeightGrid): BrushStroke {
  return { before, touched: new Set() };
}

/**
 * Touch a cell during a stroke. A cell already touched in this stroke is left
 * alone, so dragging across a cell raises it one step, not one per frame.
 */
export function strokeCell(
  stroke: BrushStroke,
  grid: HeightGrid,
  cell: Cell,
  mode: BrushMode,
  level: number
): { stroke: BrushStroke; grid: HeightGrid } {
  const key = `${cell.x},${cell.y}`;
  if (stroke.touched.has(key)) return { stroke, grid };
  const touched = new Set(stroke.touched);
  touched.add(key);
  if (mode === 'difficult') {
    const marking = stroke.marking ?? !isDifficult(grid, cell.x, cell.y);
    return {
      stroke: { before: stroke.before, touched, marking },
      grid: withDifficult(grid, cell.x, cell.y, marking),
    };
  }
  return { stroke: { ...stroke, touched }, grid: applyBrush(grid, cell, mode, level) };
}

/** The grid to edit for a board: its stored heights, or a flat one of its size. */
export function editableGrid(stored: HeightGrid | null, cols: number, rows: number): HeightGrid {
  return stored && stored.cols === cols && stored.rows === rows
    ? stored
    : createHeightGrid(cols, rows);
}

/** Whether two grids hold the same heights. */
export function sameHeights(a: HeightGrid, b: HeightGrid): boolean {
  if (a === b) return true;
  if (a.cols !== b.cols || a.rows !== b.rows) return false;
  if (!a.heights.every((height, index) => height === b.heights[index])) return false;
  return a.heights.every((_, index) => (a.difficult?.[index] ?? 0) === (b.difficult?.[index] ?? 0));
}
