/**
 * The height brush: what a touch does to a cell, and that a stroke touches
 * each cell once however long the pointer stays on it.
 */

import { describe, it, expect } from 'vitest';
import {
  applyBrush,
  beginStroke,
  brushedHeight,
  editableGrid,
  sameHeights,
  strokeCell,
} from '../iso/heightBrush';
import { createHeightGrid, heightAt, MAX_TILE_HEIGHT, withHeight } from '../iso/heightGrid';

describe('brushedHeight', () => {
  it('raises and lowers by one step', () => {
    expect(brushedHeight(3, 'raise', 0)).toBe(4);
    expect(brushedHeight(3, 'lower', 0)).toBe(2);
  });

  it('stops at the ground and at the ceiling', () => {
    expect(brushedHeight(0, 'lower', 0)).toBe(0);
    expect(brushedHeight(MAX_TILE_HEIGHT, 'raise', 0)).toBe(MAX_TILE_HEIGHT);
  });

  it('sets the chosen height with the level brush', () => {
    expect(brushedHeight(9, 'level', 4)).toBe(4);
    expect(brushedHeight(1, 'level', 99)).toBe(MAX_TILE_HEIGHT);
  });
});

describe('applyBrush', () => {
  it('changes only the touched cell', () => {
    const grid = applyBrush(createHeightGrid(3, 2), { x: 1, y: 1 }, 'raise', 0);
    expect(heightAt(grid, 1, 1)).toBe(1);
    expect(grid.heights.filter((height) => height !== 0)).toHaveLength(1);
  });

  it('returns the same grid when nothing changes', () => {
    const flat = createHeightGrid(2, 2);
    expect(applyBrush(flat, { x: 0, y: 0 }, 'lower', 0)).toBe(flat);
    expect(applyBrush(flat, { x: 5, y: 5 }, 'raise', 0)).toBe(flat);
  });
});

describe('a stroke', () => {
  it('raises a cell once however often it is touched', () => {
    let grid = createHeightGrid(3, 3);
    let stroke = beginStroke(grid);
    for (let i = 0; i < 5; i++) {
      ({ stroke, grid } = strokeCell(stroke, grid, { x: 1, y: 1 }, 'raise', 0));
    }
    expect(heightAt(grid, 1, 1)).toBe(1);
  });

  it('raises each cell it crosses', () => {
    let grid = createHeightGrid(3, 3);
    let stroke = beginStroke(grid);
    for (const x of [0, 1, 2, 1, 0]) {
      ({ stroke, grid } = strokeCell(stroke, grid, { x, y: 0 }, 'raise', 0));
    }
    expect([heightAt(grid, 0, 0), heightAt(grid, 1, 0), heightAt(grid, 2, 0)]).toEqual([1, 1, 1]);
  });

  it('remembers the grid it started from', () => {
    const before = withHeight(createHeightGrid(2, 2), 0, 0, 4);
    const { stroke } = strokeCell(beginStroke(before), before, { x: 0, y: 0 }, 'raise', 0);
    expect(stroke.before).toBe(before);
  });
});

describe('editableGrid', () => {
  it('uses the stored heights when they fit the board', () => {
    const stored = withHeight(createHeightGrid(4, 3), 1, 1, 2);
    expect(editableGrid(stored, 4, 3)).toBe(stored);
  });

  it('starts flat without heights, or with heights for another size', () => {
    expect(editableGrid(null, 4, 3)).toEqual(createHeightGrid(4, 3));
    expect(editableGrid(createHeightGrid(2, 2), 4, 3)).toEqual(createHeightGrid(4, 3));
  });
});

describe('sameHeights', () => {
  it('compares by value', () => {
    const a = withHeight(createHeightGrid(2, 2), 0, 1, 3);
    const b = withHeight(createHeightGrid(2, 2), 0, 1, 3);
    expect(sameHeights(a, b)).toBe(true);
    expect(sameHeights(a, createHeightGrid(2, 2))).toBe(false);
    expect(sameHeights(a, createHeightGrid(4, 1))).toBe(false);
  });
});
