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
    expect(h.setMapHeights).toHaveBeenCalledExactlyOnceWith('camp', 'map', expected);
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

    expect(h.setMapHeights).toHaveBeenLastCalledWith('camp', 'map', flat());
    expect(result.current.canUndo).toBe(false);
  });

  it('undoes Flatten the whole map', async () => {
    const stored = withHeight(createHeightGrid(COLS, ROWS), 1, 1, 4);
    const { result } = setup(stored);

    await act(async () => result.current.flattenAll());
    expect(h.setMapHeights).toHaveBeenLastCalledWith('camp', 'map', flat());

    await act(async () => result.current.undo());
    expect(h.setMapHeights).toHaveBeenLastCalledWith('camp', 'map', [...stored.heights]);
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
