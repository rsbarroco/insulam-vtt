/**
 * Which view of the map a viewer gets, and that tile heights sent by the
 * server reach the map whichever view is on screen.
 *
 * The two canvases are replaced by labels; what is checked is which one is
 * mounted and when the switch is offered. The tactical view draws no fog and
 * no dynamic lighting, so a player must never be given it on a map with
 * either.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { CampaignMap } from '@/types';

const h = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const handlers = new Map<string, Set<(data: never) => void>>();
  const state = { userRole: 'DM' as string, currentMap: null as unknown };
  let version = 0;
  const raw = {
    on(event: string, fn: (data: never) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off(event: string, fn: (data: never) => void) {
      handlers.get(event)?.delete(fn);
    },
  };
  const notify = () => {
    version++;
    listeners.forEach((l) => l());
  };
  return {
    state,
    handlers,
    raw,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    snapshot: () => version,
    set(patch: Partial<typeof state>) {
      Object.assign(state, patch);
      notify();
    },
    setCurrentMap(next: unknown) {
      state.currentMap =
        typeof next === 'function' ? (next as (m: unknown) => unknown)(state.currentMap) : next;
      notify();
    },
    deliver(event: string, data: unknown) {
      handlers.get(event)?.forEach((fn) => fn(data as never));
    },
    socket: { getSocket: () => raw },
  };
});

vi.mock('@/contexts/CampaignContext', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useCampaign: () => {
      useSyncExternalStore(h.subscribe, h.snapshot);
      return {
        currentMap: h.state.currentMap,
        setCurrentMap: h.setCurrentMap,
        userRole: h.state.userRole,
      };
    },
  };
});
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ socket: h.socket }) }));
vi.mock('@/components/campaign/MapCanvas', () => ({ default: () => <div>top-down canvas</div> }));
vi.mock('@/components/campaign/TacticalMapCanvas', () => ({
  default: () => <div>tactical canvas</div>,
}));
vi.mock('@/components/campaign/TurnBar', () => ({ default: () => null }));

import MapView, { tacticalViewAllowed } from '../MapView';

const map = (over: Partial<CampaignMap> = {}): CampaignMap =>
  ({
    id: 'map-1',
    name: 'Keep',
    width: 2,
    height: 2,
    gridSize: 50,
    fogEnabled: false,
    lightingEnabled: false,
    tokens: [],
    ...over,
  }) as CampaignMap;

async function renderView() {
  render(<MapView />);
  await screen.findByText('top-down canvas');
}

const switchTo = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  h.handlers.clear();
  h.set({ userRole: 'DM', currentMap: map() });
});

describe('tacticalViewAllowed', () => {
  it('always lets the DM switch', () => {
    expect(tacticalViewAllowed(map({ fogEnabled: true, lightingEnabled: true }), 'DM')).toBe(true);
  });

  it('lets a player switch only on a map with no fog and no dynamic lighting', () => {
    expect(tacticalViewAllowed(map(), 'PLAYER')).toBe(true);
    expect(tacticalViewAllowed(map({ fogEnabled: true }), 'PLAYER')).toBe(false);
    expect(tacticalViewAllowed(map({ lightingEnabled: true }), 'PLAYER')).toBe(false);
  });

  it('treats a map that does not say as fogged', () => {
    expect(tacticalViewAllowed(map({ fogEnabled: undefined }), 'PLAYER')).toBe(false);
  });

  it('refuses when there is no map', () => {
    expect(tacticalViewAllowed(null, 'DM')).toBe(false);
  });
});

describe('MapView', () => {
  it('starts in the top-down view and switches both ways', async () => {
    await renderView();

    switchTo('Tactical view');
    expect(await screen.findByText('tactical canvas')).toBeInTheDocument();
    expect(screen.queryByText('top-down canvas')).not.toBeInTheDocument();

    switchTo('Top-down view');
    expect(await screen.findByText('top-down canvas')).toBeInTheDocument();
  });

  it('offers a player no switch on a fogged map', async () => {
    h.set({ userRole: 'PLAYER', currentMap: map({ fogEnabled: true }) });

    await renderView();

    expect(screen.queryByRole('button', { name: 'Tactical view' })).not.toBeInTheDocument();
  });

  it('puts a player back in the top-down view when fog is switched on', async () => {
    h.set({ userRole: 'PLAYER' });
    await renderView();
    switchTo('Tactical view');
    await screen.findByText('tactical canvas');

    act(() => h.setCurrentMap(map({ fogEnabled: true })));

    expect(await screen.findByText('top-down canvas')).toBeInTheDocument();
    expect(screen.queryByText('tactical canvas')).not.toBeInTheDocument();
  });

  it('puts a player back in the top-down view when dynamic lighting is switched on', async () => {
    h.set({ userRole: 'PLAYER' });
    await renderView();
    switchTo('Tactical view');
    await screen.findByText('tactical canvas');

    act(() => h.setCurrentMap(map({ lightingEnabled: true })));

    expect(await screen.findByText('top-down canvas')).toBeInTheDocument();
  });

  it('keeps the DM in the tactical view when fog is switched on', async () => {
    await renderView();
    switchTo('Tactical view');
    await screen.findByText('tactical canvas');

    act(() => h.setCurrentMap(map({ fogEnabled: true })));

    expect(screen.getByText('tactical canvas')).toBeInTheDocument();
  });

  it('takes in tile heights the server sends for this map', async () => {
    await renderView();
    const tileHeights = { cols: 2, rows: 2, heights: [0, 1, 2, 3] };

    act(() => h.deliver('heights:replaced', { mapId: 'map-1', tileHeights }));

    expect((h.state.currentMap as CampaignMap).tileHeights).toEqual(tileHeights);
  });

  it('makes the board flat when the server sends no heights', async () => {
    h.set({ currentMap: map({ tileHeights: { cols: 2, rows: 2, heights: [0, 1, 2, 3] } }) });
    await renderView();

    act(() => h.deliver('heights:replaced', { mapId: 'map-1', tileHeights: null }));

    expect((h.state.currentMap as CampaignMap).tileHeights).toBeNull();
  });

  it('ignores heights for another map, and heights it cannot read', async () => {
    await renderView();

    act(() =>
      h.deliver('heights:replaced', {
        mapId: 'other',
        tileHeights: { cols: 2, rows: 2, heights: [9, 9, 9, 9] },
      })
    );
    expect((h.state.currentMap as CampaignMap).tileHeights).toBeUndefined();

    act(() =>
      h.deliver('heights:replaced', {
        mapId: 'map-1',
        tileHeights: { cols: 2, rows: 2, heights: [1] },
      })
    );
    expect((h.state.currentMap as CampaignMap).tileHeights).toBeNull();
  });
});
