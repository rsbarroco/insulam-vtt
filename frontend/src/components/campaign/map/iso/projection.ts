// ============================================
// Isometric projection for the tactical view
//
// Turns a map cell and a height into a point on a 2:1 diamond grid, and a
// point on the screen back into the cell under it. The camera has four fixed
// views a quarter turn apart.
//
// Three spaces are involved:
//
//   • CELL space: the token convention, x east and y north from the
//     bottom-left cell (see ../coords.ts). Points are continuous, so the cell
//     (3, 2) covers x 3..4 and y 2..3.
//
//   • BOARD space: the same board seen from above with y growing downwards,
//     then turned by the camera. (u, v) = (0, 0) is the corner farthest from
//     the viewer, and u + v grows towards the viewer.
//
//   • ISO space: pixels before zoom and pan. (0, 0) is the top-left of the
//     box that holds the whole board at any height.
//
// Pure: no React, no canvas.
// ============================================

import { heightAt, inBounds, MAX_TILE_HEIGHT, type HeightGrid } from './heightGrid';

/**
 * Camera turn in quarter turns. The default view looks from the south-east;
 * each turn moves the viewer a quarter of the way anticlockwise round the
 * board, seen from above: north-east, north-west, then south-west.
 */
export type QuarterTurn = 0 | 1 | 2 | 3;

export interface IsoView {
  /** Map width in cells. */
  readonly cols: number;
  /** Map height in cells. */
  readonly rows: number;
  /** Pixels per cell in the top-down view. Sets the size of a diamond. */
  readonly gridSize: number;
  readonly rotation: QuarterTurn;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** Sizes of one tile in iso pixels. */
export interface IsoMetrics {
  /** Half the width of a diamond. */
  readonly halfW: number;
  /** Half the height of a diamond. Always halfW / 2. */
  readonly halfH: number;
  /** How far one height step lifts a tile. */
  readonly stepH: number;
}

/**
 * Tile sizes for a grid size. A diamond is as wide as the diagonal of the
 * top-down cell, so a map takes about the same room in either view.
 */
export function isoMetrics(gridSize: number): IsoMetrics {
  const halfW = gridSize * Math.SQRT1_2;
  return { halfW, halfH: halfW / 2, stepH: gridSize / 4 };
}

/** The next view (`+1`) or the one before (`-1`). */
export function turnCamera(rotation: QuarterTurn, direction: 1 | -1): QuarterTurn {
  return ((rotation + direction + 4) % 4) as QuarterTurn;
}

/** Board size in cells after the camera turn. */
function boardSize(view: IsoView): { w: number; h: number } {
  return view.rotation % 2 === 0 ? { w: view.cols, h: view.rows } : { w: view.rows, h: view.cols };
}

/** Cell space to board space. */
function toBoard(x: number, y: number, view: IsoView): { u: number; v: number } {
  const top = view.rows - y;
  switch (view.rotation) {
    case 0:
      return { u: x, v: top };
    case 1:
      return { u: view.rows - top, v: x };
    case 2:
      return { u: view.cols - x, v: view.rows - top };
    case 3:
      return { u: top, v: view.cols - x };
  }
}

/** Board space back to cell space. */
function fromBoard(u: number, v: number, view: IsoView): Point {
  switch (view.rotation) {
    case 0:
      return { x: u, y: view.rows - v };
    case 1:
      return { x: v, y: u };
    case 2:
      return { x: view.cols - u, y: v };
    case 3:
      return { x: view.cols - v, y: view.rows - u };
  }
}

/** Size in iso pixels of the box that holds the board at any height. */
export function isoBoardSize(view: IsoView): { w: number; h: number } {
  const { halfW, halfH, stepH } = isoMetrics(view.gridSize);
  const board = boardSize(view);
  return {
    w: (board.w + board.h) * halfW,
    h: (board.w + board.h) * halfH + MAX_TILE_HEIGHT * stepH,
  };
}

/** A continuous cell-space point at a height, in iso pixels. */
export function projectPoint(x: number, y: number, height: number, view: IsoView): Point {
  const { halfW, halfH, stepH } = isoMetrics(view.gridSize);
  const { u, v } = toBoard(x, y, view);
  return {
    x: (u - v + boardSize(view).h) * halfW,
    y: (u + v) * halfH + (MAX_TILE_HEIGHT - height) * stepH,
  };
}

/**
 * The continuous cell-space point that an iso pixel shows, for a surface at
 * the given height. The inverse of {@link projectPoint}.
 */
export function unprojectPoint(isoX: number, isoY: number, height: number, view: IsoView): Point {
  const { halfW, halfH, stepH } = isoMetrics(view.gridSize);
  const diff = isoX / halfW - boardSize(view).h;
  const sum = (isoY - (MAX_TILE_HEIGHT - height) * stepH) / halfH;
  return fromBoard((sum + diff) / 2, (sum - diff) / 2, view);
}

/** The four corners of a cell's top face, clockwise from the top of the screen. */
export interface Diamond {
  readonly top: Point;
  readonly right: Point;
  readonly bottom: Point;
  readonly left: Point;
}

/** The top face of a cell at a height, in iso pixels. */
export function cellDiamond(cell: Cell, height: number, view: IsoView): Diamond {
  const corners = [
    projectPoint(cell.x, cell.y, height, view),
    projectPoint(cell.x + 1, cell.y, height, view),
    projectPoint(cell.x + 1, cell.y + 1, height, view),
    projectPoint(cell.x, cell.y + 1, height, view),
  ];
  const byY = [...corners].sort((a, b) => a.y - b.y);
  const byX = [...corners].sort((a, b) => a.x - b.x);
  return { top: byY[0], bottom: byY[3], left: byX[0], right: byX[3] };
}

/** Where the centre of a footprint stands, on top of a surface at a height. */
export function footprintCentre(
  cell: Cell,
  size: { width: number; height: number },
  height: number,
  view: IsoView
): Point {
  return projectPoint(cell.x + size.width / 2, cell.y + size.height / 2, height, view);
}

/**
 * How near the viewer a cell is. Cells are drawn in ascending order, so a
 * nearer cell paints over the ones behind it.
 */
export function cellDepth(cell: Cell, view: IsoView): number {
  const { u, v } = toBoard(cell.x + 0.5, cell.y + 0.5, view);
  return u + v;
}

/** Every cell of the board, farthest from the viewer first. */
export function drawOrder(view: IsoView): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < view.rows; y++) {
    for (let x = 0; x < view.cols; x++) cells.push({ x, y });
  }
  const key = (cell: Cell) => toBoard(cell.x + 0.5, cell.y + 0.5, view);
  return cells.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka.u + ka.v - (kb.u + kb.v) || ka.u - kb.u;
  });
}

/** Samples per height step when walking a line of sight through the board. */
const PICK_SAMPLES_PER_STEP = 4;

/**
 * The cell drawn at an iso pixel, or null over empty space.
 *
 * A pixel is a line of sight that drops one height step for every
 * `stepH / halfH` it travels away from the viewer. Walking it from the
 * tallest possible height downwards meets the columns of the board nearest
 * first, so the first column that reaches the line is the one on screen,
 * whether the pixel shows its top or one of its sides.
 */
export function pickCell(
  isoX: number,
  isoY: number,
  view: IsoView,
  heights: HeightGrid | null | undefined
): Cell | null {
  const grid = { cols: view.cols, rows: view.rows };
  for (let sample = MAX_TILE_HEIGHT * PICK_SAMPLES_PER_STEP; sample >= 0; sample--) {
    const height = sample / PICK_SAMPLES_PER_STEP;
    const point = unprojectPoint(isoX, isoY, height, view);
    const cell = { x: Math.floor(point.x), y: Math.floor(point.y) };
    if (inBounds(grid, cell.x, cell.y) && heightAt(heights, cell.x, cell.y) >= height) return cell;
  }
  return null;
}
