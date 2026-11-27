/**
 * Editing heights from the tactical view: the board answers the brush at
 * once, a stroke is saved when it ends, saves never overtake each other, and
 * a stroke can be undone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({ setMapHeights: vi.fn() }));
vi.mock('@/services/api', () => ({ default: { setMapHeights: h.setMapHeights } }));

import { useHeightBrush } from '../iso/useHeightBrush';
import { createHeightGrid, heightAt, withHeight, type HeightGrid } from '../iso/heightGrid';

const COLS = 3;
const ROWS = 2;
const flat = () => new Array<number>(COLS * ROWS).fill(0);
/** What a save sends beside the heights when nothing is marked and there is no cliff. */
const bare = () => ({ difficult: flat(), blocked: flat(), cliff: 0 });

/** A save the test resolves by hand. */
function pendingSave() {
  let finish!: () => void;
  let fail!: (error: unknown) => void;
  h.setMapHeights.mockImplementationOnce(
    (_campaign: string, _map: string, heights: number[]) =>
      new Promise((resolve, reject) => {
        finish = () => resolve({ tileHeights: { cols: COLS, rows: ROWS, heights } });
        fail = reject;
      })
  );
  return {
    finish: () => act(async () => finish()),
    fail: (error: unknown) => act(async () => fail(error)),
  };
}

function setup(stored: HeightGrid | null = null) {
  const onError = vi.fn();
  const onSaved = vi.fn();
  const view = renderHook(
    (props: { stored: HeightGrid | null; mapId: string }) =>
      useHeightBrush({
        campaignId: 'camp',
        mapId: props.mapId,
        cols: COLS,
        rows: ROWS,
        stored: props.stored,
        onError,
        onSaved,
      }),
    { initialProps: { stored, mapId: 'map' } }
  );
  return { ...view, onError, onSaved };
}

beforeEach(() => {
  h.setMapHeights.mockReset();
  h.setMapHeights.mockImplementation(
    async (_campaign: string, _map: string, heights: number[]) => ({
      tileHeights: heights.every((height) => height === 0)
        ? null
        : { cols: COLS, rows: ROWS, heights },
    })
  );
});

describe('painting', () => {
  it('does nothing until a brush is chosen', () => {
    const { result } = setup();

    act(() => result.current.paint({ x: 0, y: 0 }));

    expect(result.current.heights).toBeNull();
  });

  it('shows the change at once and saves when the stroke ends', async () => {
    const { result, onSaved } = setup();
    act(() => result.current.setMode('raise'));

    act(() => {
      result.current.paint({ x: 1, y: 0 });
      result.current.paint({ x: 1, y: 0 });
      result.current.paint({ x: 2, y: 1 });
    });
    expect(heightAt(result.current.heights, 1, 0)).toBe(1);
    expect(h.setMapHeights).not.toHaveBeenCalled();

    await act(async () => result.current.endStroke());

    const expected = flat();
    expected[0 * COLS + 1] = 1;
    expected[1 * COLS + 2] = 1;
    expect(h.setMapHeights).toHaveBeenCalledExactlyOnceWith('camp', 'map', expected, bare());
    expect(onSaved).toHaveBeenCalledWith('map', { cols: COLS, rows: ROWS, heights: expected });
  });

  it('saves nothing for a stroke that changed nothing', async () => {
    const { result } = setup();
    act(() => result.current.setMode('lower'));

    act(() => result.current.paint({ x: 0, y: 0 }));
    await act(async () => result.current.endStroke());

    expect(h.setMapHeights).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(false);
  });

  it('sets the chosen height with the level brush', () => {
    const { result } = setup();
    act(() => {
      result.current.setMode('level');
      result.current.setLevel(7);
    });

    act(() => result.current.paint({ x: 0, y: 1 }));

    expect(heightAt(result.current.heights, 0, 1)).toBe(7);
  });

  it('builds on the heights the map already has', () => {
    const { result } = setup(withHeight(createHeightGrid(COLS, ROWS), 0, 0, 5));
    act(() => result.current.setMode('raise'));

    act(() => result.current.paint({ x: 0, y: 0 }));

    expect(heightAt(result.current.heights, 0, 0)).toBe(6);
  });
});

describe('saving in order', () => {
  it('holds a second stroke until the first save answers, then sends the newest heights', async () => {
    const first = pendingSave();
    const { result } = setup();
    act(() => result.current.setMode('raise'));

    act(() => result.current.paint({ x: 0, y: 0 }));
    await act(async () => result.current.endStroke());
    act(() => result.current.paint({ x: 1, y: 0 }));
    await act(async () => result.current.endStroke());
    act(() => result.current.paint({ x: 2, y: 0 }));
    await act(async () => result.current.endStroke());
    expect(h.setMapHeights).toHaveBeenCalledTimes(1);

    await first.finish();

    // One more save, carrying all three strokes; the middle one is never sent.
    expect(h.setMapHeights).toHaveBeenCalledTimes(2);
    expect(h.setMapHeights.mock.calls[1][2].slice(0, 3)).toEqual([1, 1, 1]);
  });

  it('keeps showing the draft while a save is in flight', async () => {
    const save = pendingSave();
    const { result } = setup();
    act(() => result.current.setMode('raise'));
    act(() => result.current.paint({ x: 0, y: 0 }));
    await act(async () => result.current.endStroke());

    expect(heightAt(result.current.heights, 0, 0)).toBe(1);

    await save.finish();
  });

  it('reports a failed save and shows what is really stored', async () => {
    const save = pendingSave();
    const { result, onError, onSaved } = setup();
    act(() => result.current.setMode('raise'));
    act(() => result.current.paint({ x: 0, y: 0 }));
    await act(async () => result.current.endStroke());

    await save.fail(new Error('offline'));

    expect(onError).toHaveBeenCalledWith('The heights could not be saved');
    expect(onSaved).not.toHaveBeenCalled();
    expect(result.current.heights).toBeNull();
  });
});

describe('undo', () => {
  it('puts back the heights from before the last stroke and saves them', async () => {
    const { result } = setup();
    act(() => result.current.setMode('raise'));
    act(() => result.current.paint({ x: 0, y: 0 }));
    await act(async () => result.current.endStroke());
    expect(result.current.canUndo).toBe(true);

    await act(async () => result.current.undo());

    expect(h.setMapHeights).toHaveBeenLastCalledWith('camp', 'map', flat(), bare());
    expect(result.current.canUndo).toBe(false);
  });

  it('undoes Flatten the whole map', async () => {
    const stored = withHeight(createHeightGrid(COLS, ROWS), 1, 1, 4);
    const { result } = setup(stored);

    await act(async () => result.current.flattenAll());
    expect(h.setMapHeights).toHaveBeenLastCalledWith('camp', 'map', flat(), bare());

    await act(async () => result.current.undo());
    expect(h.setMapHeights).toHaveBeenLastCalledWith('camp', 'map', [...stored.heights], bare());
  });

  it('forgets its history on another map', async () => {
    const { result, rerender } = setup();
    act(() => result.current.setMode('raise'));
    act(() => result.current.paint({ x: 0, y: 0 }));
    await act(async () => result.current.endStroke());

    rerender({ stored: null, mapId: 'other' });

    expect(result.current.canUndo).toBe(false);
    expect(result.current.heights).toBeNull();
  });
});

describe('impassable squares and the cliff height', () => {
  // The server answers with everything it stored, and the map takes it, as in the app.
  beforeEach(() => {
    h.setMapHeights.mockImplementation(
      async (_c: string, _m: string, heights: number[], terrain: { blocked: number[]; cliff: number }) => ({
        tileHeights: {
          cols: COLS,
          rows: ROWS,
          heights,
          ...(terrain.blocked.includes(1) ? { blocked: terrain.blocked } : {}),
          ...(terrain.cliff ? { cliff: terrain.cliff } : {}),
        },
      })
    );
  });
  const settle = (view: ReturnType<typeof setup>) =>
    view.rerender({ stored: view.onSaved.mock.lastCall![1], mapId: 'map' });
  it('marks squares impassable, clears them when a stroke starts on one, and saves both', async () => {
    const view = setup();
    const { result } = view;
    act(() => result.current.setMode('blocked'));

    act(() => {
      result.current.paint({ x: 0, y: 0 });
      result.current.paint({ x: 2, y: 1 });
    });
    await act(async () => result.current.endStroke());

    const marked = flat();
    marked[0] = 1;
    marked[1 * COLS + 2] = 1;
    expect(h.setMapHeights).toHaveBeenLastCalledWith('camp', 'map', flat(), { ...bare(), blocked: marked });
    settle(view);

    act(() => result.current.paint({ x: 0, y: 0 }));
    await act(async () => result.current.endStroke());
    const left = flat();
    left[1 * COLS + 2] = 1;
    expect(h.setMapHeights).toHaveBeenLastCalledWith('camp', 'map', flat(), { ...bare(), blocked: left });
  });

  it('saves a cliff height, keeps it through Flatten, and undoes it', async () => {
    const view = setup(withHeight(createHeightGrid(COLS, ROWS), 0, 0, 3));
    const { result } = view;

    await act(async () => result.current.setCliff(4));
    settle(view);
    expect(result.current.cliff).toBe(4);
    expect(h.setMapHeights).toHaveBeenLastCalledWith('camp', 'map', [3, 0, 0, 0, 0, 0], { ...bare(), cliff: 4 });

    await act(async () => result.current.flattenAll());
    expect(h.setMapHeights).toHaveBeenLastCalledWith('camp', 'map', flat(), { ...bare(), cliff: 4 });

    await act(async () => result.current.undo());
    await act(async () => result.current.undo());
    expect(h.setMapHeights).toHaveBeenLastCalledWith('camp', 'map', [3, 0, 0, 0, 0, 0], bare());
  });
});
