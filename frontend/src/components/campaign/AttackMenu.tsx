// ============================================
// The attack menu of the tactical view
//
// Opens on a target while a token is held. Lists the held token's attacks,
// as the server reads them from its sheet or stat block, and has the server
// make the one chosen. The server decides everything; this only asks.
// ============================================

import { useEffect, useState } from 'react';
import type { AttackMode, CombatActionSummary, CombatAttackAck } from '@/types';
import type socketService from '@/services/socket';
import Button from '@/components/ui/Button';

interface AttackMenuProps {
  socket: typeof socketService;
  attacker: { id: string; name: string };
  target: { id: string; name: string };
  /** Distance and cover as the board shows them, for the heading. */
  situation: string | null;
  style: React.CSSProperties;
  onResolved: (answer: CombatAttackAck) => void;
  onClose: () => void;
}

const signed = (bonus: number) => (bonus >= 0 ? `+${bonus}` : String(bonus));

function rangeText(attack: NonNullable<CombatActionSummary['attack']>): string {
  if (attack.kind === 'melee') return `reach ${attack.reachFeet ?? 5} ft`;
  const range = attack.rangeFeet;
  if (!range) return 'ranged';
  return range.long ? `range ${range.normal}/${range.long} ft` : `range ${range.normal} ft`;
}

export default function AttackMenu({
  socket,
  attacker,
  target,
  situation,
  style,
  onResolved,
  onClose,
}: AttackMenuProps) {
  const [actions, setActions] = useState<CombatActionSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mode, setMode] = useState<AttackMode>('normal');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void socket.listCombatActions(attacker.id).then((answer) => {
      if (!current) return;
      if (answer.ok) setActions(answer.actions);
      else setProblem(answer.error);
    });
    return () => {
      current = false;
    };
  }, [socket, attacker.id]);

  const attacks = (actions ?? []).filter((action) => action.attack !== null);

  const make = async (action: CombatActionSummary) => {
    setBusy(true);
    const answer = await socket.resolveAttack({
      attackerId: attacker.id,
      targetId: target.id,
      action: action.index,
      ...(mode !== 'normal' ? { mode } : {}),
    });
    setBusy(false);
    onResolved(answer);
  };

  return (
    <div
      role="dialog"
      aria-label={`${attacker.name} attacks ${target.name}`}
      className="absolute z-30 glass-panel p-3 space-y-2 w-72 bg-parchment/95 backdrop-blur-xs shadow-lg"
      style={style}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div>
        <p className="text-sm font-medium text-ink truncate">
          {attacker.name} attacks {target.name}
        </p>
        {situation && <p className="text-xs text-ink-muted">{situation}</p>}
      </div>

      {problem && <p className="text-sm text-danger-ink">{problem}</p>}
      {!problem && actions === null && <p className="text-sm text-ink-muted">Loading attacks…</p>}
      {actions !== null && attacks.length === 0 && (
        <p className="text-sm text-ink-muted">
          {attacker.name} has no attack the VTT can roll. Add attacks to its character sheet, or
          actions to its stat block.
        </p>
      )}

      {attacks.length > 0 && (
        <>
          <ul className="space-y-1">
            {attacks.map((action) => (
              <li key={action.index}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void make(action)}
                  className="w-full text-left rounded-md px-2 py-1.5 hover:bg-ink/10 focus-visible:bg-ink/10 disabled:opacity-50"
                >
                  <span className="block text-sm font-medium text-ink">{action.name}</span>
                  <span className="block text-xs text-ink-muted">
                    {signed(action.attack!.bonus)} to hit · {rangeText(action.attack!)}
                    {action.attack!.damage ? ` · ${action.attack!.damage}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <label className="flex items-center justify-between gap-2 text-sm text-ink">
            Roll with
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as AttackMode)}
              className="input-cozy text-sm py-1"
            >
              <option value="normal">What the rules give</option>
              <option value="advantage">Advantage</option>
              <option value="disadvantage">Disadvantage</option>
            </select>
          </label>
        </>
      )}

      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
