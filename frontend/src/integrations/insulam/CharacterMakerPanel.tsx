import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { useServerConfigQuery } from '@/hooks/queries';
import { requestCharacterMakerSnapshot, type SnapshotRequest, type SnapshotResult } from './characterMakerHandoff';
import type { CharacterProjection } from './characterProjection';

type FailureReason = Extract<SnapshotResult, { ok: false }>['reason'];

const FAILURE_MESSAGES: Record<FailureReason, string> = {
  'invalid-configuration': 'CharacterMaker is not configured correctly for this instance.',
  'crypto-unavailable': 'A secure browser context is required to request a CharacterMaker snapshot.',
  'popup-blocked': 'Your browser blocked the CharacterMaker window. Allow popups for this page and try again.',
  'popup-closed': 'The CharacterMaker window was closed before a snapshot was received. You can try again.',
  expired: 'The request expired. If sign-in was interrupted, finish signing in to CharacterMaker and start a new request.',
  cancelled: 'Request cancelled. No snapshot was kept.',
  'invalid-payload': 'The CharacterMaker response was not accepted. No snapshot was kept.',
};

/** Runtime opt-in only. A new origin remounts the preview and discards all state. */
export default function CharacterMakerPanel() {
  const config = useServerConfigQuery();
  const origin = config.data?.characterMaker?.origin;
  if (!origin) return null;
  return <SnapshotPreview key={origin} origin={origin} />;
}

/** A private, in-memory preview: deliberately no persistence or campaign mutation. */
function SnapshotPreview({ origin }: { origin: string }) {
  const activeRequest = useRef<SnapshotRequest | null>(null);
  const mounted = useRef(false);
  const [pending, setPending] = useState(false);
  const [snapshot, setSnapshot] = useState<CharacterProjection | null>(null);
  const [failure, setFailure] = useState<FailureReason | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const request = activeRequest.current;
      activeRequest.current = null;
      request?.cancel();
    };
  }, []);

  const startRequest = () => {
    // A ref guards the same render's repeated clicks before disabled updates.
    if (activeRequest.current) {
      activeRequest.current.focus();
      return;
    }
    setSnapshot(null);
    setFailure(null);
    let request: SnapshotRequest;
    try {
      // Open synchronously in this user event, not in an effect/after an await.
      request = requestCharacterMakerSnapshot(origin);
    } catch {
      setFailure('invalid-configuration');
      return;
    }
    activeRequest.current = request;
    setPending(true);
    void request.result.then((result) => {
      if (!mounted.current || activeRequest.current !== request) return;
      activeRequest.current = null;
      setPending(false);
      if (result.ok) setSnapshot(result.character);
      else setFailure(result.reason);
    }, () => {
      // Do not log a rejected response or expose its potentially private details.
      if (!mounted.current || activeRequest.current !== request) return;
      activeRequest.current = null;
      setPending(false);
      setFailure('invalid-payload');
    });
  };

  const cancelRequest = () => {
    const request = activeRequest.current;
    activeRequest.current = null;
    request?.cancel();
    setPending(false);
    setFailure('cancelled');
  };

  return (
    <section aria-labelledby="character-maker-preview-heading" className="card-cozy space-y-4">
      <div>
        <h2 id="character-maker-preview-heading" className="text-xl font-semibold text-brand-ink font-heading">
          CharacterMaker — read-only snapshot preview
        </h2>
        <p className="mt-2 text-sm text-stone-gray">
          Choose one of your own characters in CharacterMaker and explicitly approve a read-only copy.
          This preview is not saved or shared with your table. It is not live sync and does not create a playable token.
        </p>
        <p className="mt-1 text-xs text-warm-gray break-all">Configured CharacterMaker: {origin}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onClick={startRequest} disabled={pending} aria-busy={pending}>
          {snapshot ? 'Request new snapshot' : 'Open CharacterMaker'}
        </Button>
        {pending && (
          <>
            <Button variant="secondary" onClick={() => activeRequest.current?.focus()}>Focus CharacterMaker window</Button>
            <Button variant="secondary" onClick={cancelRequest}>Cancel request</Button>
          </>
        )}
        {snapshot && (
          <Button variant="secondary" onClick={() => { setSnapshot(null); setFailure(null); }}>Remove snapshot</Button>
        )}
      </div>

      {pending && (
        <p role="status" className="text-sm text-stone-gray">
          Waiting for your approval in CharacterMaker. Sign in there if needed. Your CharacterMaker login credentials are not sent to the VTT.
        </p>
      )}
      {failure && (
        <p role={failure === 'cancelled' ? 'status' : 'alert'} className="text-sm text-stone-gray">
          {FAILURE_MESSAGES[failure]}
        </p>
      )}
      {snapshot && (
        <div role="region" aria-label="CharacterMaker snapshot" className="rounded-lg border border-moss-green/20 p-4 space-y-3">
          <h3 className="font-semibold text-brand-ink break-words">{snapshot.displayName}</h3>
          <p className="text-xs text-warm-gray">Read-only copy for this page only. It disappears when you leave or sign out.</p>
          <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-ink">
            {snapshot.hp !== undefined && <div><dt className="text-warm-gray">HP</dt><dd>{snapshot.hp.current} / {snapshot.hp.max}</dd></div>}
            {snapshot.defense !== undefined && <div><dt className="text-warm-gray">Defense</dt><dd>{snapshot.defense}</dd></div>}
            {snapshot.initiative !== undefined && <div><dt className="text-warm-gray">Initiative</dt><dd>{snapshot.initiative}</dd></div>}
            {snapshot.sourceUpdatedAt && <div><dt className="text-warm-gray">Source updated</dt><dd><time dateTime={snapshot.sourceUpdatedAt}>{snapshot.sourceUpdatedAt}</time></dd></div>}
          </dl>
          {snapshot.hp === undefined && snapshot.defense === undefined && snapshot.initiative === undefined && (
            <p className="text-sm text-stone-gray">No computed stats were supplied. Missing values are not zero.</p>
          )}
          <p className="text-xs text-warm-gray">Request a new snapshot for updated values; changes in CharacterMaker do not update this copy automatically.</p>
        </div>
      )}
    </section>
  );
}
