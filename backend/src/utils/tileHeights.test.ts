/**
 * Tile heights: what counts as readable, and how they follow a resize.
 */

import { heightsSchemaFor, isFlat, MAX_TILE_HEIGHT, readTileHeights, resizeTileHeights } from './tileHeights';

describe('readTileHeights', () => {
  it('reads a stored grid', () => {
    expect(readTileHeights({ cols: 2, rows: 1, heights: [0, 3] })).toEqual({ cols: 2, rows: 1, heights: [0, 3] });
  });

  it.each<[string, unknown]>([
    ['nothing', null],
    ['a list', [1, 2]],
    ['a grid with too few heights', { cols: 2, rows: 2, heights: [0, 0, 0] }],
    ['a grid with no squares', { cols: 0, rows: 1, heights: [] }],
    ['a height above the ceiling', { cols: 1, rows: 1, heights: [MAX_TILE_HEIGHT + 1] }],
    ['a height that is not whole', { cols: 1, rows: 1, heights: [0.5] }],
    ['a size that is not a number', { cols: '2', rows: 1, heights: [0, 0] }],
  ])('answers null for %s', (_label, stored) => {
    expect(readTileHeights(stored)).toBeNull();
  });
});

describe('heightsSchemaFor', () => {
  it('wants one height for each square of the map', () => {
    const schema = heightsSchemaFor({ width: 2, height: 2 });
    expect(schema.safeParse([0, 1, 2, 3]).success).toBe(true);
    expect(schema.safeParse([0, 1, 2]).success).toBe(false);
  });
});

describe('isFlat', () => {
  it('is true only when every square is at 0', () => {
    expect(isFlat([0, 0, 0])).toBe(true);
    expect(isFlat([0, 1, 0])).toBe(false);
  });
});

describe('resizeTileHeights', () => {
  // 3 wide, 2 tall: the bottom row is 1 2 3, the row above it 4 5 6.
  const grid = { cols: 3, rows: 2, heights: [1, 2, 3, 4, 5, 6] };

  it('keeps the bottom-left square where it is when the map grows', () => {
    expect(resizeTileHeights(grid, 4, 3)).toEqual({
      cols: 4,
      rows: 3,
      heights: [1, 2, 3, 0, 4, 5, 6, 0, 0, 0, 0, 0],
    });
  });

  it('drops the squares cut off when the map shrinks', () => {
    expect(resizeTileHeights(grid, 2, 1)).toEqual({ cols: 2, rows: 1, heights: [1, 2] });
  });

  it('does not change the grid it was given', () => {
    resizeTileHeights(grid, 1, 1);
    expect(grid.heights).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
