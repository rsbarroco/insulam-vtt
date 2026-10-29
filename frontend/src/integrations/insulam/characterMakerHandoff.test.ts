import { afterEach, describe, expect, it, vi } from 'vitest';
import { HANDOFF_TIMEOUT_MS, HANDOFF_TYPE, handoffOrigin, requestCharacterMakerSnapshot, type HandoffHost } from './characterMakerHandoff';

const ORIGIN = 'https://characters.example.test';
const STATE = 'a'.repeat(64);
const character = { schemaVersion: 1, readOnly: true, characterId: 'synthetic', displayName: 'Example adventurer' };

function fixture() {
  let clock = 0;
  const listeners = new Set<Parameters<HandoffHost['listen']>[0]>();
  const timers = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  let next = 0;
  const popup = { closed: false, close: vi.fn(), focus: vi.fn() };
  const host: HandoffHost = {
    origin: 'https://table.example.test', nonce: () => STATE, now: () => clock,
    open: vi.fn(() => popup), listen: (handler) => { listeners.add(handler); },
    unlisten: (handler) => { listeners.delete(handler); },
    later: (handler) => { timers.set(++next, handler); return next; },
    every: (handler) => { intervals.set(++next, handler); return next; },
    clearLater: (id) => { timers.delete(id); }, clearEvery: (id) => { intervals.delete(id); },
  };
  return {
    host, popup, listeners, timers, intervals,
    time: (value: number) => { clock = value; },
    receive: (data: unknown, origin = ORIGIN, source: unknown = popup) => {
      for (const listener of listeners) listener({ data: JSON.stringify(data), origin, source });
    },
    raw: (data: unknown) => {
      for (const listener of listeners) listener({ data, origin: ORIGIN, source: popup });
    },
    envelope: (overrides: Record<string, unknown> = {}) => ({ type: HANDOFF_TYPE, version: 1, state: STATE, character, ...overrides }),
  };
}
afterEach(() => { vi.restoreAllMocks(); });

describe('handoff origins', () => {
  it.each(['https://characters.example.test', 'https://characters.example.test/', 'http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001'])(
    'accepts a web origin %s', (origin) => expect(handoffOrigin(origin)).toBe(new URL(origin).origin),
  );
  it.each(['', 'null', '/relative', '*', 'https://*.example.test', 'javascript:alert(1)', 'http://example.test', 'http://localhost.evil.test', 'https://name:secret@example.test', 'https://example.test/characters', 'https://example.test/?secret=x', 'https://example.test/#fragment', 'https://example.test/?', 'https://example.test/#', 'https://example.test/a/..', 'http://2130706433:3001', 'https://@example.test', 'https://%2a.example.test', 'https://%2A.example.test'])(
    'rejects %s', (origin) => expect(handoffOrigin(origin)).toBeNull(),
  );
});

describe('CharacterMaker popup snapshot lifecycle', () => {
  it('opens synchronously at the fixed route with receiver origin and cryptographic state only', () => {
    const f = fixture(); const req = requestCharacterMakerSnapshot(ORIGIN, f.host);
    const [href, name] = vi.mocked(f.host.open).mock.calls[0];
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/vtt/connect`);
    expect([...url.searchParams.keys()]).toEqual(['origin', 'state']);
    expect(url.searchParams.get('origin')).toBe(f.host.origin);
    expect(url.searchParams.get('state')).toBe(STATE);
    expect(name).toContain(STATE);
    req.focus(); expect(f.popup.focus).toHaveBeenCalledOnce(); req.cancel();
  });
  it('accepts only the exact origin, opened window and current nonce', async () => {
    const f = fixture(); const req = requestCharacterMakerSnapshot(ORIGIN, f.host);
    const settled = vi.fn(); void req.result.then(settled);
    f.receive(f.envelope(), 'https://other.example.test');
    f.receive(f.envelope(), ORIGIN, {});
    f.receive(f.envelope({ state: 'b'.repeat(64) }));
    f.receive(f.envelope({ type: 'unrelated' }));
    await Promise.resolve(); expect(settled).not.toHaveBeenCalled();
    f.receive(f.envelope({ character: { ...character, ownerEmail: 'synthetic@example.invalid' } }));
    expect(await req.result).toEqual({ ok: true, character });
    expect(f.listeners.size + f.timers.size + f.intervals.size).toBe(0);
    expect(f.popup.close).toHaveBeenCalledOnce();
  });
  it('rejects an expired nonce even before the delayed timeout callback fires', async () => {
    const f = fixture(); const req = requestCharacterMakerSnapshot(ORIGIN, f.host);
    f.time(HANDOFF_TIMEOUT_MS); f.receive(f.envelope());
    expect(await req.result).toEqual({ ok: false, reason: 'expired' });
  });
  it('times out a login interruption without receiving any character', async () => {
    const f = fixture(); const req = requestCharacterMakerSnapshot(ORIGIN, f.host);
    for (const callback of f.timers.values()) callback();
    expect(await req.result).toEqual({ ok: false, reason: 'expired' });
    expect(f.listeners.size + f.timers.size + f.intervals.size).toBe(0);
  });
  it('handles a blocked or refused popup and removes the listener', async () => {
    const f = fixture(); f.host.open = () => null;
    expect(await requestCharacterMakerSnapshot(ORIGIN, f.host).result).toEqual({ ok: false, reason: 'popup-blocked' });
    expect(f.listeners.size + f.timers.size + f.intervals.size).toBe(0);
  });
  it('handles user closing the popup while waiting', async () => {
    const f = fixture(); const req = requestCharacterMakerSnapshot(ORIGIN, f.host);
    f.popup.closed = true; for (const callback of f.intervals.values()) callback();
    expect(await req.result).toEqual({ ok: false, reason: 'popup-closed' });
  });
  it('cancel is idempotent and ignores late or replayed messages', async () => {
    const f = fixture(); const req = requestCharacterMakerSnapshot(ORIGIN, f.host);
    const stale = [...f.listeners][0]; req.cancel(); req.cancel();
    stale({ data: JSON.stringify(f.envelope()), origin: ORIGIN, source: f.popup });
    expect(await req.result).toEqual({ ok: false, reason: 'cancelled' });
    expect(f.popup.close).toHaveBeenCalledOnce();
    expect(f.listeners.size + f.timers.size + f.intervals.size).toBe(0);
  });
  it.each([
    { version: 2 }, { character: null }, { character: { ...character, readOnly: false } },
    { extra: 'x'.repeat(16 * 1024) }, { extra: '😀'.repeat(5000) },
  ])('refuses an invalid or oversized matching envelope %j', async (override) => {
    const f = fixture(); const req = requestCharacterMakerSnapshot(ORIGIN, f.host);
    f.receive(f.envelope(override));
    expect(await req.result).toEqual({ ok: false, reason: 'invalid-payload' });
  });
  it('refuses a cyclic structured-clone payload without throwing or logging it', async () => {
    const f = fixture(); const req = requestCharacterMakerSnapshot(ORIGIN, f.host);
    const data: Record<string, unknown> = f.envelope(); data.self = data; f.raw(data);
    expect(await req.result).toEqual({ ok: false, reason: 'invalid-payload' });
  });
  it.each([new ArrayBuffer(1024 * 1024), new Map([['payload', 'x'.repeat(20000)]]), new Blob(['x'.repeat(20000)])])(
    'rejects non-string wire payloads even with a valid envelope', async (extra) => {
      const f = fixture(); const req = requestCharacterMakerSnapshot(ORIGIN, f.host);
      f.raw(f.envelope({ extra }));
      expect(await req.result).toEqual({ ok: false, reason: 'invalid-payload' });
    },
  );
  it('accepts exactly the byte cap and rejects one byte more before parsing', async () => {
    for (const extraByte of [0, 1]) {
      const f = fixture(); const req = requestCharacterMakerSnapshot(ORIGIN, f.host);
      const base = JSON.stringify(f.envelope());
      f.raw(base + ' '.repeat(16 * 1024 - base.length + extraByte));
      expect(await req.result).toEqual(extraByte ? { ok: false, reason: 'invalid-payload' } : { ok: true, character });
    }
  });
  it('never opens for invalid receiver/source configuration', async () => {
    const f = fixture(); f.host.origin = 'null';
    expect(await requestCharacterMakerSnapshot(ORIGIN, f.host).result).toEqual({ ok: false, reason: 'invalid-configuration' });
    expect(f.host.open).not.toHaveBeenCalled();
  });
  it('never falls back to a weak or missing nonce', async () => {
    const f = fixture(); f.host.nonce = () => 'weak';
    expect(await requestCharacterMakerSnapshot(ORIGIN, f.host).result).toEqual({ ok: false, reason: 'crypto-unavailable' });
    expect(f.host.open).not.toHaveBeenCalled();
  });
  it('contains popup access failures during focus/close', async () => {
    const f = fixture(); f.popup.focus.mockImplementation(() => { throw new Error('closed'); });
    f.popup.close.mockImplementation(() => { throw new Error('closed'); });
    const req = requestCharacterMakerSnapshot(ORIGIN, f.host); req.focus(); req.cancel();
    expect(await req.result).toEqual({ ok: false, reason: 'cancelled' });
  });
});
