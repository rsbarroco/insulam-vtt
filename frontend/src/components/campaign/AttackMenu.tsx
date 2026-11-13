// ============================================
// The attack menu of the tactical view
//
// Opens on a target while a token is held. Lists the held token's attacks,
// as the server reads them from its sheet or stat block, and has the server
// make the one chosen. The server decides everything; this only asks.
// ============================================

import { useEffect, useState } from 'react';
import type { AttackMode, CombatActionSummary, CombatExtraAttack } from '@/types';
import type socketService from '@/services/socket';
import Button from '@/components/ui/Button';

interface AttackMenuProps {
  socket: typeof socketService;
  attacker: { id: string; name: string };
  target: { id: string; name: string };
  /** Distance and cover as the board shows them, for the heading. */
  situation: string | null;
  style: React.CSSProperties;
  /** The creatures standing in an area aimed from the attacker at the target. */
  caughtBy: (area: Area) => Array<{ id: string; name: string }>;
  /** Show an area on the board while its action is pointed at, or clear it with null. */
  onAim: (area: Area | null) => void;
  /** The outcome in one line, and whether it went the acting creature's way. */
  onResolved: (
    answer: { ok: true; summary: string; landed: boolean } | { ok: false; error: string }
  ) => void;
  onClose: () => void;
}

type Area = NonNullable<NonNullable<CombatActionSummary['save']>['area']>;

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

const EXTRA_LABELS: Record<CombatExtraAttack, { label: string; title: string }> = {
  cleave: {
    label: 'Cleave',
    title:
      'After a hit with this weapon this turn: attack a creature within 5 feet of the first, without your ability modifier to the damage. Once a turn.',
  },
  light: {
    label: 'Light extra attack',
    title:
      'After the Attack action with another Light weapon: one more attack, without your ability modifier to the damage. A Bonus Action, or part of the action with Nick.',
  },
};

/** The extra attacks a weapon gives, under its row; the server says whether the turn allows one. */
function ExtraAttacks({
  action,
  busy,
  onMake,
}: {
  action: CombatActionSummary;
  busy: boolean;
  onMake: (extra: CombatExtraAttack) => void;
}) {
  if (!action.extras || action.extras.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1 px-2 pb-1">
      {action.extras.map((extra) => (
        <Button
          key={extra}
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          title={EXTRA_LABELS[extra].title}
          aria-label={`${action.name}: ${EXTRA_LABELS[extra].label}`}
          onClick={() => onMake(extra)}
        >
          {EXTRA_LABELS[extra].label}
        </Button>
      ))}
    </span>
  );
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
  catches,
  onMake,
}: {
  action: CombatActionSummary;
  busy: boolean;
  /** For an effect with an area, the names of the creatures in it. */
  catches: string[] | null;
  onMake: (slotLevel?: number) => void;
}) {
  const what = action.attack
    ? attackText(action.attack)
    : action.heal
      ? `heals ${action.heal.dice} · ${action.heal.rangeFeet <= 5 ? 'touch' : `range ${action.heal.rangeFeet} ft`}`
      : saveText(action.save!);
  const caught = catches
    ? `${what} · ${catches.length > 0 ? `catches ${catches.join(', ')}` : 'catches nobody'}`
    : what;
  // A spent "(Recharge 5–6)" waits for its d6 at the start of the creature's turn.
  const spent = action.recharge !== undefined && !action.recharge.ready;
  const legendary = action.legendary ? ` · Legendary, ${action.legendary.max - action.legendary.used}/${action.legendary.max} left` : '';
  const detail = `${spent ? `${caught} · not recharged` : caught}${legendary}`;
  const levelled = action.spell !== null && action.spell.level > 0;
  if (!levelled) {
    return (
      <button type="button" disabled={busy || spent} onClick={() => onMake()} className={ROW}>
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
  caughtBy,
  onAim,
  onResolved,
  onClose,
}: AttackMenuProps) {
  const [actions, setActions] = useState<CombatActionSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mode, setMode] = useState<AttackMode>('normal');
  const [busy, setBusy] = useState(false);
  const [trigger, setTrigger] = useState('');

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
    (action) => action.attack !== null || action.save !== null || action.heal !== undefined
  );
  const anyAttackRoll = attacks.some((action) => action.attack !== null);
  const multiattacks = (actions ?? []).filter((action) => (action.multiattack ?? []).length > 0);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const nameOf = (index: number) => actions?.find((action) => action.index === index)?.name ?? `#${index}`;

  /** A Multiattack: each of its attacks against this target, one after another, until one is refused. */
  const makeAll = async (multi: CombatActionSummary) => {
    setBusy(true);
    const lines: string[] = [];
    let landed = false;
    // A Legendary Action's attacks spend one use, with the first of them.
    let legendaryFor = multi.cost === 'legendary' ? multi.index : undefined;
    for (const [step, { count, choices }] of (multi.multiattack ?? []).entries()) {
      const index = picks[`${multi.index}:${step}`] ?? choices[0];
      for (let made = 0; made < count; made += 1) {
        const answer = await socket.resolveAttack({
          attackerId: attacker.id,
          targetId: target.id,
          action: index,
          ...(mode !== 'normal' ? { mode } : {}),
          ...(legendaryFor !== undefined ? { legendary: legendaryFor } : {}),
        });
        legendaryFor = undefined;
        if (!answer.ok) {
          setBusy(false);
          onResolved(lines.length > 0 ? { ok: true, summary: [...lines, answer.error].join(' · '), landed } : answer);
          return;
        }
        lines.push(answer.summary);
        landed = landed || answer.hit;
      }
    }
    setBusy(false);
    onResolved({ ok: true, summary: lines.join(' · '), landed });
  };

  /** Who a save effect is rolled for: everyone its area catches, or the creature aimed at. */
  const targetsOf = (action: CombatActionSummary): string[] => {
    const area = action.save?.area;
    const caught = area ? caughtBy(area).map((creature) => creature.id) : [];
    return caught.length > 0 ? caught : [target.id];
  };

  /** Make the attack or call for the save. `slotLevel` is the spell slot a levelled spell is cast with. */
  const make = async (
    action: CombatActionSummary,
    slotLevel?: number,
    extra?: CombatExtraAttack
  ) => {
    const slot = slotLevel === undefined ? {} : { slotLevel };
    setBusy(true);
    if (action.heal) {
      const answer = await socket.heal({ casterId: attacker.id, targetId: target.id, action: action.index, ...slot });
      setBusy(false);
      onResolved(answer.ok ? { ok: true, summary: answer.summary, landed: true } : answer);
      return;
    }
    if (action.attack) {
      const answer = await socket.resolveAttack({
        attackerId: attacker.id,
        targetId: target.id,
        action: action.index,
        ...(mode !== 'normal' ? { mode } : {}),
        ...slot,
        ...(extra ? { extra } : {}),
      });
      setBusy(false);
      onResolved(answer.ok ? { ok: true, summary: answer.summary, landed: answer.hit } : answer);
      return;
    }
    const answer = await socket.resolveSave({
      sourceId: attacker.id,
      targetIds: targetsOf(action),
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

  /** The Ready action: hold this attack for the trigger, to make it later with the reaction. */
  const readyAttack = async (action: CombatActionSummary) => {
    setBusy(true);
    const answer = await socket.ready(attacker.id, target.id, action.index, trigger.trim() || 'when the trigger comes');
    setBusy(false);
    onResolved(answer.ok ? { ok: true, summary: answer.summary, landed: true } : answer);
  };

  /** The Help action: distract the target, so an ally's next attack on it has Advantage. */
  const help = async () => {
    setBusy(true);
    const answer = await socket.help(attacker.id, target.id);
    setBusy(false);
    onResolved(answer.ok ? { ok: true, summary: answer.summary, landed: true } : answer);
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

      {multiattacks.map((multi) => (
        <div key={`multi:${multi.index}`} className="px-2 py-1.5 space-y-1" aria-label={`${multi.name} against ${target.name}`}>
          <span className="block text-sm font-medium text-ink">
            {multi.name}
            {multi.legendary && (
              <span className="text-xs font-normal text-ink-muted">
                {' '}
                · Legendary, {multi.legendary.max - multi.legendary.used}/{multi.legendary.max} left
              </span>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-1 text-xs text-ink-muted">
            {(multi.multiattack ?? []).map(({ count, choices }, step) => (
              <span key={step} className="flex items-center gap-1">
                {count}×
                {choices.length > 1 ? (
                  <select
                    aria-label={`${multi.name}: attack ${step + 1}`}
                    className="input-cozy text-xs py-0.5"
                    value={picks[`${multi.index}:${step}`] ?? choices[0]}
                    onChange={(event) => setPicks((now) => ({ ...now, [`${multi.index}:${step}`]: Number(event.target.value) }))}
                  >
                    {choices.map((choice) => (
                      <option key={choice} value={choice}>
                        {nameOf(choice)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>{nameOf(choices[0])}</span>
                )}
              </span>
            ))}
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void makeAll(multi)}>
              Make them all
            </Button>
          </span>
        </div>
      ))}

      {attacks.length > 0 && (
        <>
          <ul className="space-y-1">
            {attacks.map((action) => (
              <li key={action.index}>
                <div
                  onPointerEnter={() => onAim(action.save?.area ?? null)}
                  onPointerLeave={() => onAim(null)}
                  onFocus={() => onAim(action.save?.area ?? null)}
                  onBlur={() => onAim(null)}
                >
                  <ActionRow
                    action={action}
                    busy={busy}
                    catches={
                      action.save?.area ? caughtBy(action.save.area).map((c) => c.name) : null
                    }
                    onMake={(slot) => void make(action, slot)}
                  />
                  <ExtraAttacks
                    action={action}
                    busy={busy}
                    onMake={(extra) => void make(action, undefined, extra)}
                  />
                  {action.attack && action.spell === null && (
                    <span className="flex px-2 pb-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={`Ready ${action.name}`}
                        title="The Ready action: hold this attack for the trigger below, and make it later with your reaction."
                        onClick={() => void readyAttack(action)}
                      >
                        Ready
                      </Button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {anyAttackRoll && (
            <label className="flex items-center justify-between gap-2 text-sm text-ink">
              Readied for
              <input
                type="text"
                value={trigger}
                maxLength={200}
                placeholder="when it comes into reach"
                onChange={(event) => setTrigger(event.target.value)}
                className="input-cozy text-sm py-1 w-40"
              />
            </label>
          )}
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

      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          title={`The Help action: distract ${target.name} (within 5 feet) so an ally's next attack roll against it has Advantage, until your next turn.`}
          onClick={() => void help()}
        >
          Help against it
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
