import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS, useLongPress } from '../useLongPress';

describe('useLongPress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires where the finger went down once it has rested long enough, and says the press was used', () => {
    const onLongPress = vi.fn();
    const used = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));
    act(() => result.current.start({ clientX: 10, clientY: 20 }, used));
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 1));
    expect(onLongPress).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(used).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledWith({ clientX: 10, clientY: 20 });
  });

  it('does nothing when the finger lifts or moves first', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));
    act(() => result.current.start({ clientX: 0, clientY: 0 }));
    act(() => result.current.cancel());
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('stops when the component goes', () => {
    const onLongPress = vi.fn();
    const { result, unmount } = renderHook(() => useLongPress(onLongPress));
    act(() => result.current.start({ clientX: 0, clientY: 0 }));
    unmount();
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
