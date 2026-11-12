/**
 * The tactical view's camera fit and where a token is put down.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/contexts/CampaignContext', () => ({ useCampaign: () => ({}) }));
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({}) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({}) }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({}) }));

import { fitCamera, footprintOriginAt } from '../TacticalMapCanvas';
import { projectPoint, type IsoView } from '../map/iso/projection';

const view: IsoView = { cols: 20, rows: 12, gridSize: 50, rotation: 0 };
const BOARD = { cols: 20, rows: 12 };

describe('footprintOriginAt', () => {
  it('puts a one-square token on the pointed square', () => {
    expect(footprintOriginAt({ x: 5, y: 4 }, { width: 1, height: 1 }, BOARD)).toEqual({
      x: 5,
      y: 4,
    });
  });

  it('centres a larger token on the pointed square', () => {
    expect(footprintOriginAt({ x: 5, y: 4 }, { width: 3, height: 3 }, BOARD)).toEqual({
      x: 4,
      y: 3,
    });
    expect(footprintOriginAt({ x: 5, y: 4 }, { width: 2, height: 2 }, BOARD)).toEqual({
      x: 5,
      y: 4,
    });
  });

  it('keeps the whole footprint on the board', () => {
    expect(footprintOriginAt({ x: 0, y: 0 }, { width: 3, height: 3 }, BOARD)).toEqual({
      x: 0,
      y: 0,
    });
    expect(footprintOriginAt({ x: 19, y: 11 }, { width: 3, height: 3 }, BOARD)).toEqual({
      x: 17,
      y: 9,
    });
  });
});

describe('fitCamera', () => {
  const canvas = { width: 800, height: 600 };

  it.each([0, 8, 32])('shows every corner of the board, with tiles up to height %i', (tallest) => {
    const camera = fitCamera(view, canvas, tallest);
    for (const [x, y] of [
      [0, 0],
      [view.cols, 0],
      [0, view.rows],
      [view.cols, view.rows],
    ]) {
      for (const height of [0, tallest]) {
        const iso = projectPoint(x, y, height, view);
        const screenX = iso.x * camera.zoom + camera.pan.x;
        const screenY = iso.y * camera.zoom + camera.pan.y;
        expect(screenX).toBeGreaterThanOrEqual(0);
        expect(screenX).toBeLessThanOrEqual(canvas.width);
        expect(screenY).toBeGreaterThanOrEqual(0);
        expect(screenY).toBeLessThanOrEqual(canvas.height);
      }
    }
  });

  it('zooms a flat board in further than a tall one', () => {
    expect(fitCamera(view, { width: 4000, height: 600 }, 0).zoom).toBeGreaterThan(
      fitCamera(view, { width: 4000, height: 600 }, 32).zoom
    );
  });
});
