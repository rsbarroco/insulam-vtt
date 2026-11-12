/**
 * Drawing the tactical view.
 *
 * The picture itself is checked by eye; these pin what decides it: which
 * tile a token is drawn after (so nearer tiles can hide it), the ground a
 * large token stands on, that tokens off to the side are not culled with
 * their tile, and which disc a click lands on.
 */

import { describe, it, expect } from 'vitest';
import {
  drawIsoScene,
  footprintHeight,
  nearestFootprintCell,
  pickTokenDisc,
  tokenDiscCentre,
  tokenRadius,
  type IsoScene,
  type IsoToken,
} from '../iso/drawIsoScene';
import { createHeightGrid, withHeight } from '../iso/heightGrid';
import { cellDepth, type IsoView, type QuarterTurn } from '../iso/projection';

const view = (rotation: QuarterTurn = 0): IsoView => ({ cols: 6, rows: 4, gridSize: 50, rotation });

const token = (id: string, x: number, y: number, size = 1): IsoToken => ({
  id,
  cell: { x, y },
  size: { width: size, height: size },
  image: undefined,
  colour: '#888888',
  alpha: 1,
});

/** A 2D context that records the order of what is drawn. */
function recordingContext() {
  const calls: string[] = [];
  let fillStyle = '';
  const noop = () => {};
  const ctx = {
    save: noop,
    restore: noop,
    setTransform: noop,
    transform: noop,
    clearRect: () => calls.push('clear'),
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    clip: noop,
    stroke: noop,
    setLineDash: noop,
    drawImage: () => calls.push('image'),
    ellipse: noop,
    arc: (x: number, y: number) => calls.push(`arc:${Math.round(x)},${Math.round(y)}`),
    fill: () => calls.push(`fill:${fillStyle}`),
    lineWidth: 1,
    strokeStyle: '',
    globalAlpha: 1,
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string) {
      fillStyle = value;
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const scene = (over: Partial<IsoScene> = {}): IsoScene => ({
  view: view(),
  heights: null,
  mapImage: null,
  showGrid: false,
  tokens: [],
  hoverCell: null,
  drop: null,
  ...over,
});

const CAMERA = { zoom: 1, pan: { x: 0, y: 0 } };
const HUGE = { width: 5000, height: 5000 };

describe('where a token stands', () => {
  it('is drawn after the cell of its footprint nearest the viewer', () => {
    for (const rotation of [0, 1, 2, 3] as QuarterTurn[]) {
      const v = view(rotation);
      const nearest = nearestFootprintCell({ x: 2, y: 1 }, { width: 2, height: 2 }, v);
      for (const other of [
        { x: 2, y: 1 },
        { x: 3, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ]) {
        expect(cellDepth(nearest, v)).toBeGreaterThanOrEqual(cellDepth(other, v));
      }
    }
  });

  it('stands on the tallest ground under a large footprint', () => {
    const heights = withHeight(createHeightGrid(6, 4), 3, 2, 5);
    expect(footprintHeight({ x: 2, y: 1 }, { width: 2, height: 2 }, heights)).toBe(5);
    expect(footprintHeight({ x: 0, y: 0 }, { width: 1, height: 1 }, heights)).toBe(0);
    expect(footprintHeight({ x: 0, y: 0 }, { width: 1, height: 1 }, null)).toBe(0);
  });

  it('is lifted with its tile', () => {
    const flat = tokenDiscCentre({ x: 2, y: 2 }, { width: 1, height: 1 }, null, view());
    const raised = tokenDiscCentre(
      { x: 2, y: 2 },
      { width: 1, height: 1 },
      withHeight(createHeightGrid(6, 4), 2, 2, 4),
      view()
    );
    expect(raised.x).toBeCloseTo(flat.x);
    expect(raised.y).toBeLessThan(flat.y);
  });

  it('grows with the footprint', () => {
    expect(tokenRadius({ width: 2, height: 2 }, view())).toBeCloseTo(
      2 * tokenRadius({ width: 1, height: 1 }, view())
    );
  });
});

describe('drawIsoScene', () => {
  it('clears the canvas and draws every tile of a board that fits', () => {
    const { ctx, calls } = recordingContext();

    drawIsoScene(ctx, scene(), CAMERA, HUGE);

    expect(calls[0]).toBe('clear');
    expect(calls.filter((call) => call.startsWith('fill:'))).toHaveLength(6 * 4);
  });

  it('skips tiles that are off the canvas', () => {
    const { ctx, calls } = recordingContext();

    drawIsoScene(ctx, scene(), CAMERA, { width: 40, height: 40 });

    expect(calls.filter((call) => call.startsWith('fill:')).length).toBeLessThan(6 * 4);
  });

  it('draws a token whose tile is off the canvas, since the disc stands above it', () => {
    const { ctx, calls } = recordingContext();

    drawIsoScene(ctx, scene({ tokens: [token('far', 5, 0)] }), CAMERA, { width: 40, height: 40 });

    expect(calls.some((call) => call.startsWith('arc:'))).toBe(true);
  });

  it('draws the token behind before the token in front', () => {
    const v = view();
    const behind = token('behind', 1, 3);
    const front = token('front', 4, 0);
    const { ctx, calls } = recordingContext();

    // Listed front first, to show the order comes from the board.
    drawIsoScene(ctx, scene({ tokens: [front, behind] }), CAMERA, HUGE);

    const arcOf = (t: IsoToken) => {
      const centre = tokenDiscCentre(t.cell, t.size, null, v);
      return calls.indexOf(`arc:${Math.round(centre.x)},${Math.round(centre.y)}`);
    };
    expect(arcOf(behind)).toBeGreaterThan(-1);
    expect(arcOf(behind)).toBeLessThan(arcOf(front));
  });

  it('draws two faces for a raised tile and none for a flat one', () => {
    const flat = recordingContext();
    drawIsoScene(flat.ctx, scene(), CAMERA, HUGE);
    const raised = recordingContext();
    drawIsoScene(
      raised.ctx,
      scene({ heights: withHeight(createHeightGrid(6, 4), 2, 2, 3) }),
      CAMERA,
      HUGE
    );

    const fills = (calls: string[]) => calls.filter((call) => call.startsWith('fill:')).length;
    expect(fills(raised.calls)).toBe(fills(flat.calls) + 2);
  });

  it('lays the map picture over each tile when there is one', () => {
    const { ctx, calls } = recordingContext();
    const mapImage = { naturalWidth: 600, naturalHeight: 400 } as HTMLImageElement;

    drawIsoScene(ctx, scene({ mapImage }), CAMERA, HUGE);

    expect(calls.filter((call) => call === 'image')).toHaveLength(6 * 4);
  });

  it('draws a ghost of the held token where it would be put down', () => {
    const held = token('held', 0, 0);
    const { ctx, calls } = recordingContext();

    drawIsoScene(
      ctx,
      scene({ tokens: [held], drop: { token: held, cell: { x: 3, y: 2 }, blocked: false } }),
      CAMERA,
      HUGE
    );

    const ghost = tokenDiscCentre({ x: 3, y: 2 }, held.size, null, view());
    expect(calls).toContain(`arc:${Math.round(ghost.x)},${Math.round(ghost.y)}`);
  });
});

describe('pickTokenDisc', () => {
  it('finds the token whose disc is under the point', () => {
    const tokens = [token('a', 1, 1), token('b', 4, 2)];
    const centre = tokenDiscCentre({ x: 4, y: 2 }, { width: 1, height: 1 }, null, view());

    expect(pickTokenDisc(centre.x, centre.y, tokens, null, view())?.id).toBe('b');
  });

  it('finds nothing away from every disc', () => {
    expect(pickTokenDisc(-100, -100, [token('a', 1, 1)], null, view())).toBeNull();
  });

  it('prefers the token nearer the viewer where two discs overlap', () => {
    const v = view();
    // (2,2) is one step behind (3,1) on screen; a point between their
    // centres is inside both discs.
    const behind = token('behind', 2, 2);
    const front = token('front', 3, 1);
    const a = tokenDiscCentre(behind.cell, behind.size, null, v);
    const b = tokenDiscCentre(front.cell, front.size, null, v);

    const picked = pickTokenDisc((a.x + b.x) / 2, (a.y + b.y) / 2, [front, behind], null, v);

    expect(picked?.id).toBe('front');
  });

  it('follows a token up onto a raised tile', () => {
    const heights = withHeight(createHeightGrid(6, 4), 2, 2, 6);
    const centre = tokenDiscCentre({ x: 2, y: 2 }, { width: 1, height: 1 }, heights, view());

    expect(pickTokenDisc(centre.x, centre.y, [token('up', 2, 2)], heights, view())?.id).toBe('up');
  });
});
