// ============================================
// Drawing the tactical (isometric) view
//
// One pass over the board, farthest cell first: each cell is drawn as a
// raised tile with the map picture on its top face, then the tokens standing
// on it. A nearer tile is drawn later, so a tall one hides what is behind it
// with no further bookkeeping.
//
// Pure: `(ctx, scene, camera) => void`, no React, like the top-down layers.
// ============================================

import { heightAt, type HeightGrid } from './heightGrid';
import {
  cellDepth,
  cellDiamond,
  drawOrder,
  footprintCentre,
  isoMetrics,
  projectPoint,
  type Cell,
  type Diamond,
  type IsoView,
  type Point,
} from './projection';

/** Zoom and pan of the iso scene on the canvas. */
export interface IsoCamera {
  readonly zoom: number;
  readonly pan: Point;
}

/** A token as the scene draws it. */
export interface IsoToken {
  readonly id: string;
  /** Bottom-left cell of the footprint. */
  readonly cell: Cell;
  readonly size: { readonly width: number; readonly height: number };
  readonly image: HTMLImageElement | undefined;
  /** Fill behind the picture, and the whole disc when there is none. */
  readonly colour: string;
  /** Ring round the disc: whose turn it is, or the token being pointed at. */
  readonly ring?: string;
  /** 1 is solid. A held or downed token is drawn fainter. */
  readonly alpha: number;
}

export interface IsoScene {
  readonly view: IsoView;
  readonly heights: HeightGrid | null;
  /** The map picture, laid over the tile tops. Null draws plain tiles. */
  readonly mapImage: HTMLImageElement | null;
  readonly showGrid: boolean;
  readonly tokens: readonly IsoToken[];
  /** The cell under the pointer. */
  readonly hoverCell: Cell | null;
  /** Where a held token would be put down, and whether it may be. */
  readonly drop: {
    readonly token: IsoToken;
    readonly cell: Cell;
    readonly blocked: boolean;
    /** The token has a reach and this cell is outside it. The move is still allowed. */
    readonly outOfReach?: boolean;
  } | null;
  /** Cells a token can walk to this move, and the way to the pointed one. */
  readonly reach?: {
    /** Bottom-left cells the token can stop on, as `x,y`. */
    readonly stops: ReadonlySet<string>;
    readonly size: { readonly width: number; readonly height: number };
    /** Bottom-left cells walked to reach the pointed cell, in order. */
    readonly path: readonly Cell[];
  } | null;
}

export const ISO_COLOURS = {
  tileTop: '#7c8a6b',
  sideLeft: '#6f5b47',
  sideRight: '#54432f',
  grid: 'rgba(0, 0, 0, 0.28)',
  hover: 'rgba(255, 255, 255, 0.28)',
  dropAllowed: 'rgba(96, 200, 120, 0.45)',
  dropBlocked: 'rgba(220, 80, 70, 0.5)',
  dropOutOfReach: 'rgba(235, 170, 60, 0.5)',
  reach: 'rgba(80, 150, 255, 0.3)',
  path: 'rgba(80, 150, 255, 0.6)',
  shadow: 'rgba(0, 0, 0, 0.35)',
  tokenEdge: 'rgba(0, 0, 0, 0.75)',
} as const;

/** How much of a cell's width a token's disc takes. */
const TOKEN_DISC_SHARE = 0.55;

/** The cell of a footprint nearest the viewer, which decides when it is drawn. */
export function nearestFootprintCell(
  cell: Cell,
  size: { width: number; height: number },
  view: IsoView
): Cell {
  let nearest = cell;
  let depth = -Infinity;
  for (let dy = 0; dy < size.height; dy++) {
    for (let dx = 0; dx < size.width; dx++) {
      const candidate = { x: cell.x + dx, y: cell.y + dy };
      const candidateDepth = cellDepth(candidate, view);
      if (candidateDepth > depth) {
        depth = candidateDepth;
        nearest = candidate;
      }
    }
  }
  return nearest;
}

/** The tallest cell under a footprint: a large token stands on the highest ground it covers. */
export function footprintHeight(
  cell: Cell,
  size: { width: number; height: number },
  heights: HeightGrid | null
): number {
  let tallest = 0;
  for (let dy = 0; dy < size.height; dy++) {
    for (let dx = 0; dx < size.width; dx++) {
      tallest = Math.max(tallest, heightAt(heights, cell.x + dx, cell.y + dy));
    }
  }
  return tallest;
}

/** Radius of a token's disc in iso pixels. */
export function tokenRadius(size: { width: number; height: number }, view: IsoView): number {
  return isoMetrics(view.gridSize).halfW * TOKEN_DISC_SHARE * Math.max(size.width, size.height);
}

/** Centre of a token's upright disc in iso pixels. */
export function tokenDiscCentre(
  cell: Cell,
  size: { width: number; height: number },
  heights: HeightGrid | null,
  view: IsoView
): Point {
  const foot = footprintCentre(cell, size, footprintHeight(cell, size, heights), view);
  return { x: foot.x, y: foot.y - tokenRadius(size, view) };
}

function tracePolygon(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

function traceDiamond(ctx: CanvasRenderingContext2D, diamond: Diamond): void {
  tracePolygon(ctx, [diamond.top, diamond.right, diamond.bottom, diamond.left]);
}

/** Whether a tile's column, from its top face down to the ground, can be on the canvas. */
function onCanvas(
  diamond: Diamond,
  drop: number,
  camera: IsoCamera,
  canvas: { width: number; height: number }
): boolean {
  const left = diamond.left.x * camera.zoom + camera.pan.x;
  const right = diamond.right.x * camera.zoom + camera.pan.x;
  const top = diamond.top.y * camera.zoom + camera.pan.y;
  const bottom = (diamond.bottom.y + drop) * camera.zoom + camera.pan.y;
  return right >= 0 && left <= canvas.width && bottom >= 0 && top <= canvas.height;
}

/** Lay one cell of the map picture over a tile's top face. */
function drawTileTop(
  ctx: CanvasRenderingContext2D,
  cell: Cell,
  height: number,
  scene: IsoScene
): void {
  const { view, mapImage } = scene;
  if (!mapImage || mapImage.naturalWidth === 0) {
    traceDiamond(ctx, cellDiamond(cell, height, view));
    ctx.fillStyle = ISO_COLOURS.tileTop;
    ctx.fill();
    return;
  }
  // The picture's cell, seen from above, has its top-left corner at the
  // cell's north-west corner. Map the unit square onto the projected face.
  const origin = projectPoint(cell.x, cell.y + 1, height, view);
  const east = projectPoint(cell.x + 1, cell.y + 1, height, view);
  const south = projectPoint(cell.x, cell.y, height, view);
  const cellW = mapImage.naturalWidth / view.cols;
  const cellH = mapImage.naturalHeight / view.rows;
  ctx.save();
  ctx.transform(
    east.x - origin.x,
    east.y - origin.y,
    south.x - origin.x,
    south.y - origin.y,
    origin.x,
    origin.y
  );
  // A hair wider than the face, so neighbouring tiles leave no seam.
  ctx.drawImage(
    mapImage,
    cell.x * cellW,
    (view.rows - 1 - cell.y) * cellH,
    cellW,
    cellH,
    -0.01,
    -0.01,
    1.02,
    1.02
  );
  ctx.restore();
}

/** The two faces of a raised tile that look towards the viewer. */
function drawTileSides(ctx: CanvasRenderingContext2D, diamond: Diamond, drop: number): void {
  if (drop <= 0) return;
  const down = (point: Point): Point => ({ x: point.x, y: point.y + drop });
  tracePolygon(ctx, [diamond.left, diamond.bottom, down(diamond.bottom), down(diamond.left)]);
  ctx.fillStyle = ISO_COLOURS.sideLeft;
  ctx.fill();
  tracePolygon(ctx, [diamond.bottom, diamond.right, down(diamond.right), down(diamond.bottom)]);
  ctx.fillStyle = ISO_COLOURS.sideRight;
  ctx.fill();
}

function drawToken(
  ctx: CanvasRenderingContext2D,
  token: IsoToken,
  scene: IsoScene,
  alpha = token.alpha
): void {
  const { view, heights } = scene;
  const radius = tokenRadius(token.size, view);
  const centre = tokenDiscCentre(token.cell, token.size, heights, view);
  const foot = { x: centre.x, y: centre.y + radius };

  ctx.save();
  ctx.globalAlpha = alpha;

  // Shadow on the tile, so the disc reads as standing on it.
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y, radius * 0.8, radius * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = ISO_COLOURS.shadow;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = token.colour;
  ctx.fill();
  if (token.image && token.image.naturalWidth > 0) {
    ctx.save();
    ctx.clip();
    ctx.drawImage(token.image, centre.x - radius, centre.y - radius, radius * 2, radius * 2);
    ctx.restore();
  }
  ctx.lineWidth = Math.max(1.5, radius * 0.08);
  ctx.strokeStyle = ISO_COLOURS.tokenEdge;
  ctx.stroke();

  if (token.ring) {
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius + ctx.lineWidth * 1.5, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, radius * 0.12);
    ctx.strokeStyle = token.ring;
    ctx.stroke();
  }
  ctx.restore();
}

/** Tint the top faces of a footprint. */
function tintFootprint(
  ctx: CanvasRenderingContext2D,
  cell: Cell,
  size: { width: number; height: number },
  colour: string,
  scene: IsoScene
): void {
  ctx.fillStyle = colour;
  for (let dy = 0; dy < size.height; dy++) {
    for (let dx = 0; dx < size.width; dx++) {
      const target = { x: cell.x + dx, y: cell.y + dy };
      traceDiamond(
        ctx,
        cellDiamond(target, heightAt(scene.heights, target.x, target.y), scene.view)
      );
      ctx.fill();
    }
  }
}

/**
 * Draw the whole scene. The canvas is cleared first; `canvas` is its size in
 * the same pixels the camera's pan is measured in.
 */
export function drawIsoScene(
  ctx: CanvasRenderingContext2D,
  scene: IsoScene,
  camera: IsoCamera,
  canvas: { width: number; height: number }
): void {
  const { view, heights } = scene;
  const { stepH } = isoMetrics(view.gridSize);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, camera.pan.x, camera.pan.y);

  // Which tokens are drawn straight after which cell.
  const standingOn = new Map<string, IsoToken[]>();
  const stand = (token: IsoToken) => {
    const anchor = nearestFootprintCell(token.cell, token.size, view);
    const key = `${anchor.x},${anchor.y}`;
    const list = standingOn.get(key);
    if (list) list.push(token);
    else standingOn.set(key, [token]);
  };
  for (const token of scene.tokens) stand(token);
  // The held token's ghost stands where it would be put down.
  const ghost = scene.drop ? { ...scene.drop.token, cell: scene.drop.cell, alpha: 0.6 } : null;
  if (ghost) stand(ghost);

  // The cells under every footprint the token could stop on, and under the
  // way to the pointed one.
  const reachCells = new Set<string>();
  const pathCells = new Set<string>();
  if (scene.reach) {
    const { size } = scene.reach;
    const cover = (into: Set<string>, origin: Cell) => {
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) into.add(`${origin.x + dx},${origin.y + dy}`);
      }
    };
    for (const stop of scene.reach.stops) {
      const [x, y] = stop.split(',').map(Number);
      cover(reachCells, { x, y });
    }
    for (const step of scene.reach.path) cover(pathCells, step);
  }

  const tinted = (cell: Cell, origin: Cell, size: { width: number; height: number }) =>
    cell.x >= origin.x &&
    cell.y >= origin.y &&
    cell.x < origin.x + size.width &&
    cell.y < origin.y + size.height;

  ctx.lineWidth = 1 / camera.zoom;
  for (const cell of drawOrder(view)) {
    const height = heightAt(heights, cell.x, cell.y);
    const diamond = cellDiamond(cell, height, view);
    const drop = height * stepH;
    const tokens = standingOn.get(`${cell.x},${cell.y}`);
    // A token stands above its tile, so the tile being off the canvas does
    // not mean the token is; draw those tiles anyway.
    if (!tokens && !onCanvas(diamond, drop, camera, canvas)) continue;

    drawTileSides(ctx, diamond, drop);
    drawTileTop(ctx, cell, height, scene);
    if (scene.showGrid) {
      traceDiamond(ctx, diamond);
      ctx.strokeStyle = ISO_COLOURS.grid;
      ctx.stroke();
    }
    const key = `${cell.x},${cell.y}`;
    if (pathCells.has(key))
      tintFootprint(ctx, cell, { width: 1, height: 1 }, ISO_COLOURS.path, scene);
    else if (reachCells.has(key))
      tintFootprint(ctx, cell, { width: 1, height: 1 }, ISO_COLOURS.reach, scene);
    if (scene.drop && tinted(cell, scene.drop.cell, scene.drop.token.size)) {
      tintFootprint(
        ctx,
        cell,
        { width: 1, height: 1 },
        scene.drop.blocked
          ? ISO_COLOURS.dropBlocked
          : scene.drop.outOfReach
            ? ISO_COLOURS.dropOutOfReach
            : ISO_COLOURS.dropAllowed,
        scene
      );
    } else if (scene.hoverCell && scene.hoverCell.x === cell.x && scene.hoverCell.y === cell.y) {
      tintFootprint(ctx, cell, { width: 1, height: 1 }, ISO_COLOURS.hover, scene);
    }
    if (tokens) {
      for (const token of tokens) drawToken(ctx, token, scene);
    }
  }
  ctx.restore();
}

/**
 * The token whose disc is under an iso pixel, nearest the viewer first, or
 * null. A disc stands above its cell, so it can cover cells behind it; this
 * is asked before the cell under the pointer.
 */
export function pickTokenDisc(
  isoX: number,
  isoY: number,
  tokens: readonly IsoToken[],
  heights: HeightGrid | null,
  view: IsoView
): IsoToken | null {
  let found: IsoToken | null = null;
  let foundDepth = -Infinity;
  for (const token of tokens) {
    const centre = tokenDiscCentre(token.cell, token.size, heights, view);
    const radius = tokenRadius(token.size, view);
    if (Math.hypot(isoX - centre.x, isoY - centre.y) > radius) continue;
    const depth = cellDepth(nearestFootprintCell(token.cell, token.size, view), view);
    if (depth >= foundDepth) {
      found = token;
      foundDepth = depth;
    }
  }
  return found;
}
