// ============================================
// The attack menu of the tactical view
//
// Opens on a target while a token is held. Lists the held token's attacks,
// as the server reads them from its sheet or stat block, and has the server
// make the one chosen. The server decides everything; this only asks.
// ============================================

import { useEffect, useState } from 'react';
import type { AttackMode, CombatActionSummary } from '@/types';
import type socketService from '@/services/socket';
import Button from '@/components/ui/Button';

interface AttackMenuProps {
  socket: typeof socketService;
  attacker: { id: string; name: string };
  target: { id: string; name: string };
  /** Distance and cover as the board shows them, for the heading. */
  situation: string | null;
  style: React.CSSProperties;
  /** The outcome in one line, and whether it went the acting creature's way. */
  onResolved: (
    answer: { ok: true; summary: string; landed: boolean } | { ok: false; error: string }
  ) => void;
  onClose: () => void;
}

const signed = (bonus: number) => (bonus >= 0 ? `+${bonus}` : String(bonus));

function rangeText(attack: NonNullable<CombatActionSummary['attack']>): string {
  if (attack.kind === 'melee') return `reach ${attack.reachFeet ?? 5} ft`;
  const range = attack.rangeFeet;
  if (!range) return 'ranged';
  return range.long ? `range ${range.normal}/${range.long} ft` : `range ${range.normal} ft`;
}

function attackText(attack: NonNullable<CombatActionSummary['attack']>): string {
  return `${signed(attack.bonus)} to hit · ${rangeText(attack)}${attack.damage ? ` · ${attack.damage}` : ''}`;
}

const ABILITY_LABELS = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
} as const;

function saveText(save: NonNullable<CombatActionSummary['save']>): string {
  const parts = [`DC ${save.dc} ${ABILITY_LABELS[save.ability]} save`];
  if (save.damage) parts.push(save.halfOnSuccess ? `${save.damage}, half on a save` : save.damage);
  if (save.area) parts.push(`${save.area.sizeFeet} ft ${save.area.shape}`);
  return parts.join(' · ');
}

const ROW =
  'w-full text-left rounded-md px-2 py-1.5 hover:bg-ink/10 focus-visible:bg-ink/10 disabled:opacity-50';

/**
 * One action of the menu. A levelled spell is cast by choosing the slot: one
 * button for each level the caster has a slot left at.
 */
function ActionRow({
  action,
  busy,
  onMake,
}: {
  action: CombatActionSummary;
  busy: boolean;
  onMake: (slotLevel?: number) => void;
}) {
  const detail = action.attack ? attackText(action.attack) : saveText(action.save!);
  const levelled = action.spell !== null && action.spell.level > 0;
  if (!levelled) {
    return (
      <button type="button" disabled={busy} onClick={() => onMake()} className={ROW}>
        <span className="block text-sm font-medium text-ink">{action.name}</span>
        <span className="block text-xs text-ink-muted">{detail}</span>
      </button>
    );
  }
  const slots = action.spell!.slotLevels;
  return (
    <div className="px-2 py-1.5">
      <span className="block text-sm font-medium text-ink">{action.name}</span>
      <span className="block text-xs text-ink-muted">{detail}</span>
      {slots.length === 0 ? (
        <span className="block text-xs text-danger-ink">No spell slot left</span>
      ) : (
        <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-ink-muted">
          Cast with a slot of level
          {slots.map((level) => (
            <Button
              key={level}
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={`Cast ${action.name} with a level ${level} slot`}
              onClick={() => onMake(level)}
            >
              {level}
            </Button>
          ))}
        </span>
      )}
    </div>
  );
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

  const attacks = (actions ?? []).filter(
    (action) => action.attack !== null || action.save !== null
  );
  const anyAttackRoll = attacks.some((action) => action.attack !== null);

  /** Make the attack or call for the save. `slotLevel` is the spell slot a levelled spell is cast with. */
  const make = async (action: CombatActionSummary, slotLevel?: number) => {
    const slot = slotLevel === undefined ? {} : { slotLevel };
    setBusy(true);
    if (action.attack) {
      const answer = await socket.resolveAttack({
        attackerId: attacker.id,
        targetId: target.id,
        action: action.index,
        ...(mode !== 'normal' ? { mode } : {}),
        ...slot,
      });
      setBusy(false);
      onResolved(answer.ok ? { ok: true, summary: answer.summary, landed: answer.hit } : answer);
      return;
    }
    const answer = await socket.resolveSave({
      sourceId: attacker.id,
      targetIds: [target.id],
      action: action.index,
      ...slot,
    });
    setBusy(false);
    onResolved(
      answer.ok
        ? { ok: true, summary: answer.summary, landed: answer.targets.some((t) => !t.saved) }
        : answer
    );
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
          {attacker.name} has no attack or saving-throw effect the VTT can roll. Add attacks to its
          character sheet, or actions to its stat block.
        </p>
      )}

      {attacks.length > 0 && (
        <>
          <ul className="space-y-1">
            {attacks.map((action) => (
              <li key={action.index}>
                <ActionRow action={action} busy={busy} onMake={(slot) => void make(action, slot)} />
              </li>
            ))}
          </ul>
          {anyAttackRoll && (
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
          )}
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
