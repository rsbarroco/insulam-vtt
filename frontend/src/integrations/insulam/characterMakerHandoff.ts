import { parseCharacterProjection, type CharacterProjection } from './characterProjection';

export const HANDOFF_TIMEOUT_MS = 5 * 60 * 1000;
export const MAX_HANDOFF_BYTES = 16 * 1024;
export const HANDOFF_TYPE = 'insulam.character.projection';

export type SnapshotFailure = 'invalid-configuration' | 'crypto-unavailable' | 'popup-blocked'
  | 'popup-closed' | 'expired' | 'cancelled' | 'invalid-payload';
export type SnapshotResult = { ok: true; character: CharacterProjection }
  | { ok: false; reason: SnapshotFailure };
export interface SnapshotRequest {
  result: Promise<SnapshotResult>;
  cancel: () => void;
  focus: () => void;
}

interface PopupHandle { readonly closed: boolean; close: () => void; focus: () => void }
interface IncomingMessage { origin: string; source: unknown; data: unknown }
/** Small browser seam: the tests exercise the complete lifecycle without a real account. */
export interface HandoffHost {
  origin: string;
  nonce: () => string;
  now: () => number;
  open: (url: string, name: string) => PopupHandle | null;
  listen: (handler: (event: IncomingMessage) => void) => void;
  unlisten: (handler: (event: IncomingMessage) => void) => void;
  later: (handler: () => void, ms: number) => number;
  every: (handler: () => void, ms: number) => number;
  clearLater: (id: number) => void;
  clearEvery: (id: number) => void;
}

/** Only exact web origins. HTTP is limited to local development hosts. */
export function handoffOrigin(value: string): string | null {
  const raw = value?.trim();
  if (!raw || raw.length > 2048 || /[\s\\@*]/.test(raw)) return null;
  const parts = /^(https?):\/\/([^/?#]+)\/?$/i.exec(raw);
  if (!parts) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.hostname.includes('*')) return null;
    const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(parts[2]);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
    return url.origin;
  } catch { return null; }
}

function browserHost(): HandoffHost {
  return {
    origin: window.location.origin,
    nonce: () => Array.from(window.crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join(''),
    now: () => performance.now(),
    // The trusted source needs opener for postMessage. No arbitrary player URL is accepted.
    open: (url, name) => window.open(url, name, 'popup,width=720,height=780'),
    listen: (handler) => window.addEventListener('message', handler),
    unlisten: (handler) => window.removeEventListener('message', handler),
    later: (handler, ms) => window.setTimeout(handler, ms),
    every: (handler, ms) => window.setInterval(handler, ms),
    clearLater: (id) => window.clearTimeout(id),
    clearEvery: (id) => window.clearInterval(id),
  };
}

/**
 * Explicit owner-consented snapshot only. Never sends a cookie/token, fetches
 * a sheet, writes storage or broadcasts a character. Call from a click handler
 * so window.open retains the browser's user activation. Cancel on unmount/logout.
 */
export function requestCharacterMakerSnapshot(sourceOrigin: string, host: HandoffHost = browserHost()): SnapshotRequest {
  let resolve!: (result: SnapshotResult) => void;
  const result = new Promise<SnapshotResult>((done) => { resolve = done; });
  let finished = false;
  let popup: PopupHandle | null = null;
  let expiry: number | undefined = undefined;
  let closedCheck: number | undefined = undefined;
  let listening = false;
  let nonce = '';
  const source = handoffOrigin(sourceOrigin);
  const receiver = handoffOrigin(host.origin);
  const deadline = host.now() + HANDOFF_TIMEOUT_MS;

  const finish = (value: SnapshotResult) => {
    if (finished) return;
    finished = true;
    if (listening) host.unlisten(onMessage);
    if (expiry !== undefined) host.clearLater(expiry);
    if (closedCheck !== undefined) host.clearEvery(closedCheck);
    try { popup?.close(); } catch { /* The receiver owns only this popup. */ }
    resolve(value);
  };

  function onMessage(event: IncomingMessage) {
    if (finished || !popup || event.origin !== source || event.source !== popup) return;
    if (host.now() >= deadline) { finish({ ok: false, reason: 'expired' }); return; }
    // A JSON-string wire protocol avoids structured-clone binary/Map/Blob
    // payloads hiding behind JSON.stringify. Bound bytes before parsing.
    if (typeof event.data !== 'string' || event.data.length > MAX_HANDOFF_BYTES
      || new TextEncoder().encode(event.data).byteLength > MAX_HANDOFF_BYTES) {
      finish({ ok: false, reason: 'invalid-payload' }); return;
    }
    try {
      const data: unknown = JSON.parse(event.data);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      const envelope = data as Record<string, unknown>;
      // Unrelated messages and stale requests cannot terminate a current request.
      if (envelope.type !== HANDOFF_TYPE || envelope.state !== nonce) return;
      const character = envelope.version === 1 ? parseCharacterProjection(envelope.character) : null;
      finish(character ? { ok: true, character } : { ok: false, reason: 'invalid-payload' });
    } catch { finish({ ok: false, reason: 'invalid-payload' }); }
  }

  const request: SnapshotRequest = {
    result,
    cancel: () => finish({ ok: false, reason: 'cancelled' }),
    focus: () => { if (!finished) { try { popup?.focus(); } catch { /* no-op */ } } },
  };
  if (!source || !receiver || (receiver.startsWith('https:') && source.startsWith('http:'))) { finish({ ok: false, reason: 'invalid-configuration' }); return request; }
  try { nonce = host.nonce(); } catch { finish({ ok: false, reason: 'crypto-unavailable' }); return request; }
  if (!/^[a-f0-9]{64}$/.test(nonce)) { finish({ ok: false, reason: 'crypto-unavailable' }); return request; }
  const url = new URL('/vtt/connect', source);
  url.searchParams.set('origin', receiver);
  url.searchParams.set('state', nonce);
  host.listen(onMessage);
  listening = true;
  try { popup = host.open(url.href, `insulam-character-${nonce}`); } catch { /* popup refused */ }
  if (!popup) { finish({ ok: false, reason: 'popup-blocked' }); return request; }
  expiry = host.later(() => finish({ ok: false, reason: 'expired' }), HANDOFF_TIMEOUT_MS);
  closedCheck = host.every(() => {
    try { if (popup?.closed) finish({ ok: false, reason: 'popup-closed' }); }
    catch { finish({ ok: false, reason: 'popup-closed' }); }
  }, 500);
  return request;
}
