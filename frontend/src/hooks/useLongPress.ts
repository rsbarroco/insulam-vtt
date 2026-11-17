import { useEffect, useRef } from 'react';

/** How long a finger rests on the screen before it counts as a long press. */
export const LONG_PRESS_MS = 500;

/**
 * A long press, for touch screens that have no right click: `start` when the
 * finger goes down, `cancel` when it lifts or moves away. If neither comes in
 * time, `onLongPress` is called with where the finger went down, and `start`'s
 * caller should treat the press as used (the lift that follows is no click).
 */
export function useLongPress(
  onLongPress: (at: { clientX: number; clientY: number }) => void,
  ms = LONG_PRESS_MS
) {
  const callback = useRef(onLongPress);
  callback.current = onLongPress;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => cancel, []);

  return {
    start: (at: { clientX: number; clientY: number }, onFired?: () => void) => {
      cancel();
      const point = { clientX: at.clientX, clientY: at.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        onFired?.();
        callback.current(point);
      }, ms);
    },
    cancel,
  };
}
