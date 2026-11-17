// ============================================
// The attack menu of the tactical view
//
// Opens on a target while a token is held. Lists the held token's attacks,
// as the server reads them from its sheet or stat block, and has the server
// make the one chosen. The server decides everything; this only asks.
// ============================================

import { useEffect, useState } from 'react';
import type {
  AttackMode,
  CastingMetamagic,
  CombatActionSummary,
  CombatExtraAttack,
  CunningEffect,
  TransmutedType,
  PactDamageType,
} from '@/types';
import type socketService from '@/services/socket';
import Button from '@/components/ui/Button';
import LandsAidPicker from './LandsAidPicker';

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
  /** An empty square the area is aimed at, rather than a creature: only area effects are offered. */
  point?: { x: number; y: number };
}

type Area = NonNullable<NonNullable<CombatActionSummary['save']>['area']>;

/** A Cunning Strike effect as the menu offers it, with the Sneak Attack dice it costs. */
const CUNNING_OPTIONS: Record<CunningEffect, string> = {
  poison: 'Poison (−1d6)',
  trip: 'Trip (−1d6)',
  withdraw: 'Withdraw (−1d6)',
  daze: 'Daze (−2d6)',
  knockOut: 'Knock Out (−6d6)',
  obscure: 'Obscure (−3d6)',
  stealth: 'Stealth Attack (−1d6)',
};

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
  flurry: {
    label: 'Flurry of Blows strike',
    title: 'One of the two Unarmed Strikes your Flurry of Blows gave this turn.',
  },
  horde: {
    label: 'Horde Breaker',
    title:
      'After an attack with this weapon this turn: attack a different creature within 5 feet of the first, in range, that you have not attacked this turn. Once on each of your turns.',
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

/** How many creatures Sculpt Spells can spare: 1 + the level of the highest slot the spell can be cast with. */
function sculptCap(action: CombatActionSummary): number {
  const spell = action.spell;
  if (!spell) return 1;
  return 1 + Math.max(spell.level, ...spell.slotLevels);
}

/** Sculpt Spells: the creatures an Evocation spell's area catches, to tick the ones it spares. */
function SculptPicks({
  action,
  caught,
  picked,
  onToggle,
}: {
  action: CombatActionSummary;
  caught: Array<{ id: string; name: string }>;
  picked: string[];
  onToggle: (id: string) => void;
}) {
  if (caught.length === 0) return null;
  const cap = sculptCap(action);
  const ticked = caught.filter((creature) => picked.includes(creature.id)).length;
  return (
    <span
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 pb-1 text-xs text-ink-muted"
      title="Sculpt Spells: 1 + the level of the slot of the other creatures you can see succeed on the save and take no damage."
    >
      Sculpt Spells spares up to {cap}
      {caught.map((creature) => (
        <label key={creature.id} className="flex items-center gap-1 text-ink">
          <input
            type="checkbox"
            checked={picked.includes(creature.id)}
            disabled={!picked.includes(creature.id) && ticked >= cap}
            aria-label={`${action.name}: Sculpt Spells spares ${creature.name}`}
            onChange={() => onToggle(creature.id)}
          />
          {creature.name}
        </label>
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
  sculpting = 0,
  onMake,
}: {
  action: CombatActionSummary;
  busy: boolean;
  /** For an effect with an area, the names of the creatures in it. */
  catches: string[] | null;
  /** The creatures Sculpt Spells is to spare: a slot below that count less 1 cannot spare them all. */
  sculpting?: number;
  onMake: (slotLevel?: number) => void;
}) {
  const what = action.attack
    ? attackText(action.attack)
    : action.heal
      ? `heals ${action.heal.dice} · ${action.heal.rangeFeet <= 5 ? 'touch' : `range ${action.heal.rangeFeet} ft`}`
      : action.darts
        ? `${action.darts.count} darts, ${action.darts.damage} each · no roll · range ${action.darts.rangeFeet} ft`
        : saveText(action.save!);
  const caught = catches
    ? `${what} · ${catches.length > 0 ? `catches ${catches.join(', ')}` : 'catches nobody'}`
    : what;
  // A spent "(Recharge 5–6)" waits for its d6 at the start of the creature's turn.
  const spent = action.recharge !== undefined && !action.recharge.ready;
  const legendary = action.legendary ? ` · Legendary, ${action.legendary.max - action.legendary.used}/${action.legendary.max} left` : '';
  const perDay = action.perDay ? ` · ${action.perDay.left}/${action.perDay.max} a day left` : '';
  const detail = `${spent ? `${caught} · not recharged` : caught}${legendary}${perDay}`;
  // A stat block's spell is cast with no slot, at the level its stat block writes.
  const levelled = action.spell !== null && action.spell.level > 0 && !action.spell.noSlot;
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
              disabled={busy || sculpting > 1 + level}
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
  point,
}: AttackMenuProps) {
  const [actions, setActions] = useState<CombatActionSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mode, setMode] = useState<AttackMode>('normal');
  const [busy, setBusy] = useState(false);
  const [trigger, setTrigger] = useState('');
  const [canReckless, setCanReckless] = useState(false);
  const [reckless, setReckless] = useState(false);
  const [canBrutal, setCanBrutal] = useState(false);
  const [metaOptions, setMetaOptions] = useState<CastingMetamagic[]>([]);
  const [meta, setMeta] = useState<'' | CastingMetamagic>('');
  const [transmuteTo, setTransmuteTo] = useState<TransmutedType>('fire');
  const [huntersMark, setHuntersMark] = useState<string | null>(null);
  const [cunningEffects, setCunningEffects] = useState<CunningEffect[]>([]);
  const [cunningLimit, setCunningLimit] = useState(1);
  const [cunning, setCunning] = useState<'' | CunningEffect>('');
  const [cunningSecond, setCunningSecond] = useState<'' | CunningEffect>('');
  const [brutal, setBrutal] = useState<'' | 'forceful' | 'hamstring'>('');
  // A Paladin's Sacred Weapon: the attack imbued now (null for none), whether to imbue with this attack, and Radiant damage.
  const [sacred, setSacred] = useState<{ imbued: string | null } | null>(null);
  const [imbue, setImbue] = useState(false);
  const [radiant, setRadiant] = useState(false);
  // The other creatures an action that chooses several (Abjure Foes) is also aimed at, by action index.
  const [alsoAt, setAlsoAt] = useState<Record<number, string[]>>({});
  // An Evoker's choices as a spell is cast: the creatures Sculpt Spells protects, and Overchannel.
  const [sculpted, setSculpted] = useState<string[]>([]);
  const [overchannel, setOverchannel] = useState(false);
  const [overchannelUses, setOverchannelUses] = useState(0);
  const [pactWeapons, setPactWeapons] = useState<number[]>([]);
  const [pactDamage, setPactDamage] = useState<'' | PactDamageType>('');

  useEffect(() => {
    let current = true;
    void socket.listCombatActions(attacker.id).then((answer) => {
      if (!current) return;
      if (answer.ok) {
        setActions(answer.actions);
        setCanReckless(answer.reckless === true);
        setCanBrutal(answer.brutalStrike === true);
        setMetaOptions(answer.metamagic ?? []);
        setHuntersMark((answer.concentrationSpells ?? []).find((spell) => /^hunter[’']?s mark$/i.test(spell)) ?? null);
        setCunningEffects(answer.cunningStrike ?? []);
        setCunningLimit(answer.cunningStrikeLimit ?? 1);
        setSacred(answer.sacredWeapon ?? null);
        setOverchannelUses((answer.resources ?? []).find((entry) => entry.name === 'Overchannel')?.used ?? 0);
        setPactWeapons(answer.warlock?.pactWeapons ?? []);
      } else setProblem(answer.error);
    });
    return () => {
      current = false;
    };
  }, [socket, attacker.id]);

  const attacks = (actions ?? []).filter((action) =>
    point
      ? action.save?.area !== undefined && action.save !== null
      : action.attack !== null || action.save !== null || action.heal !== undefined || action.darts !== undefined
  );
  const anyAttackRoll = attacks.some((action) => action.attack !== null);
  const multiattacks = point ? [] : (actions ?? []).filter((action) => (action.multiattack ?? []).length > 0);
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
          ...(reckless && lines.length === 0 ? { reckless: true as const } : {}),
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

  /** Every beam of a cantrip such as Eldritch Blast at the target, one attack roll after another. */
  const makeBeams = async (action: CombatActionSummary) => {
    setBusy(true);
    const lines: string[] = [];
    let landed = false;
    for (let beam = 0; beam < (action.beams ?? 1); beam += 1) {
      const answer = await socket.resolveAttack({
        attackerId: attacker.id,
        targetId: target.id,
        action: action.index,
        ...(mode !== 'normal' ? { mode } : {}),
      });
      if (!answer.ok) {
        setBusy(false);
        onResolved(lines.length > 0 ? { ok: true, summary: [...lines, answer.error].join(' · '), landed } : answer);
        return;
      }
      lines.push(answer.summary);
      landed = landed || answer.hit;
    }
    setBusy(false);
    onResolved({ ok: true, summary: lines.join(' · '), landed });
  };

  /** The other creatures within range of an action that chooses several: Abjure Foes takes as many as it says. */
  const othersInRange = (action: CombatActionSummary) =>
    (action.save?.maxTargets ?? 1) > 1 && action.save?.rangeFeet
      ? caughtBy({ shape: 'emanation', sizeFeet: action.save.rangeFeet }).filter(
          (creature) => creature.id !== attacker.id && creature.id !== target.id
        )
      : [];
  /** Whether this attack is, or is being made, a Sacred Weapon: a Melee weapon attack of the sheet's. */
  const sacredFor = (action: CombatActionSummary) =>
    sacred !== null && action.attack?.kind === 'melee' && !action.spell && (imbue || sacred.imbued === action.name);

  /** Who a save effect is rolled for: everyone its area catches, or the creature aimed at. */
  const targetsOf = (action: CombatActionSummary): string[] => {
    const area = action.save?.area;
    const caught = area ? caughtBy(area).map((creature) => creature.id) : [];
    if (caught.length > 0 || point) return caught;
    const others = new Set(othersInRange(action).map((creature) => creature.id));
    return [target.id, ...(alsoAt[action.index] ?? []).filter((id) => others.has(id))];
  };

  /** Make the attack or call for the save. `slotLevel` is the spell slot a levelled spell is cast with. */
  const make = async (
    action: CombatActionSummary,
    slotLevel?: number,
    extra?: CombatExtraAttack
  ) => {
    const slot = slotLevel === undefined ? {} : { slotLevel };
    // Overchannel changes a spell cast with a slot of level 1 to 5.
    const maximum =
      overchannel && action.overchannel && (slotLevel ?? action.spell?.level ?? 0) <= 5
        ? { overchannel: true as const }
        : {};
    setBusy(true);
    // Magic Missile: every dart at the creature the menu is on, one more for each slot level above the spell's.
    if (action.darts) {
      const count = action.darts.count + Math.max(0, (slotLevel ?? 0) - (action.spell?.level ?? 0));
      const answer = await socket.resolveSave({
        sourceId: attacker.id,
        targetIds: [target.id],
        action: action.index,
        ...slot,
        darts: [count],
        ...maximum,
        ...(meta === 'distant' || meta === 'quickened' ? { metamagic: { option: meta } } : {}),
      });
      setBusy(false);
      onResolved(answer.ok ? { ok: true, summary: answer.summary, landed: true } : answer);
      return;
    }
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
        ...(reckless ? { reckless: true as const } : {}),
        ...(brutal && !action.spell ? { brutal } : {}),
        ...(cunning && !action.spell
          ? { cunning: cunningSecond ? [cunning, cunningSecond] : cunning }
          : {}),
        ...(imbue && sacred && !extra && action.attack.kind === 'melee' && !action.spell ? { sacredWeapon: true as const } : {}),
        ...(radiant && sacredFor(action) ? { radiant: true as const } : {}),
        ...(pactDamage && pactWeapons.includes(action.index) ? { pactDamage } : {}),
        ...(action.spell && (meta === 'distant' || meta === 'quickened') ? { metamagic: { option: meta } } : {}),
        ...(action.spell && meta === 'transmuted' ? { metamagic: { option: meta, damageType: transmuteTo } } : {}),
        ...maximum,
      });
      setBusy(false);
      onResolved(answer.ok ? { ok: true, summary: answer.summary, landed: answer.hit } : answer);
      return;
    }
    const targetIds = targetsOf(action);
    if (targetIds.length === 0) {
      setBusy(false);
      onResolved({ ok: false, error: `Nobody stands in the ${action.name}` });
      return;
    }
    // Heightened Spell picks the creature the menu is on; Careful Spell protects the others the area catches.
    const metaPicks =
      meta === 'heightened'
        ? targetIds.filter((id) => id === target.id)
        : meta === 'careful'
          ? targetIds.filter((id) => id !== target.id)
          : undefined;
    // Sculpt Spells protects the creatures ticked under the spell, among those it catches.
    const sculptPicks = targetIds.filter((id) => sculpted.includes(id));
    const answer = await socket.resolveSave({
      sourceId: attacker.id,
      targetIds,
      action: action.index,
      ...slot,
      ...(point ? { point } : {}),
      ...(action.spell && meta
        ? { metamagic: { option: meta, ...(metaPicks ? { targetIds: metaPicks } : {}), ...(meta === 'transmuted' ? { damageType: transmuteTo } : {}) } }
        : {}),
      ...(action.sculpt && sculptPicks.length > 0 ? { sculpt: { targetIds: sculptPicks } } : {}),
      ...maximum,
    });
    setBusy(false);
    onResolved(
      answer.ok
        ? { ok: true, summary: answer.summary, landed: answer.targets.some((t) => !t.saved) }
        : answer
    );
  };

  /** The creatures Land's Aid can choose among: those its Sphere catches, or the creature aimed at. */
  const aidCreatures = (action: CombatActionSummary): Array<{ id: string; name: string }> => {
    const caught = action.save?.area ? caughtBy(action.save.area) : [];
    return caught.length > 0 || point ? caught : [{ id: target.id, name: target.name }];
  };

  /** Land's Aid: the saves of the creatures chosen, and the one that regains Hit Points. */
  const makeAid = async (
    action: CombatActionSummary,
    targetIds: string[],
    healId: string | undefined
  ) => {
    setBusy(true);
    const answer = await socket.resolveSave({
      sourceId: attacker.id,
      targetIds,
      action: action.index,
      ...(point ? { point } : {}),
      ...(healId ? { healId } : {}),
    });
    setBusy(false);
    onResolved(answer.ok ? { ok: true, summary: answer.summary, landed: true } : answer);
  };

  /** The Ready action: hold this attack for the trigger, to make it later with the reaction. */
  const readyAttack = async (action: CombatActionSummary) => {
    setBusy(true);
    const answer = await socket.ready(attacker.id, target.id, action.index, trigger.trim() || 'when the trigger comes');
    setBusy(false);
    onResolved(answer.ok ? { ok: true, summary: answer.summary, landed: true } : answer);
  };

  /** Hunter's Mark on the target: the attacker's hits on it add 1d6 Force while it concentrates. */
  const mark = async (spell: string) => {
    setBusy(true);
    const answer = await socket.concentrate(attacker.id, { spell, targetId: target.id });
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
      className="absolute z-30 glass-panel p-3 space-y-2 w-72 overflow-y-auto overscroll-contain bg-parchment/95 backdrop-blur-xs shadow-lg"
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
          {point
            ? `${attacker.name} has no area effect the VTT can aim at a square.`
            : `${attacker.name} has no attack or saving-throw effect the VTT can roll. Add attacks to its character sheet, or actions to its stat block.`}
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
                  {action.areaHeal && action.save ? (
                    <LandsAidPicker
                      name={action.name}
                      detail={saveText(action.save)}
                      dice={action.areaHeal}
                      creatures={aidCreatures(action)}
                      busy={busy}
                      onUse={(targetIds, healId) => void makeAid(action, targetIds, healId)}
                    />
                  ) : (
                    <ActionRow
                      action={action}
                      busy={busy}
                      catches={
                        action.save?.area ? caughtBy(action.save.area).map((c) => c.name) : null
                      }
                      sculpting={
                        action.sculpt && action.save?.area
                          ? caughtBy(action.save.area).filter((c) => sculpted.includes(c.id)).length
                          : 0
                      }
                      onMake={(slot) => void make(action, slot)}
                    />
                  )}
                  <ExtraAttacks
                    action={action}
                    busy={busy}
                    onMake={(extra) => void make(action, undefined, extra)}
                  />
                  {othersInRange(action).length > 0 && (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-1 text-xs text-ink-muted">
                      Also, up to {action.save!.maxTargets! - 1} more:
                      {othersInRange(action).map((creature) => {
                        const picked = alsoAt[action.index] ?? [];
                        const checked = picked.includes(creature.id);
                        return (
                          <label key={creature.id} className="flex items-center gap-1 text-ink">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!checked && picked.length >= action.save!.maxTargets! - 1}
                              onChange={() =>
                                setAlsoAt((all) => ({
                                  ...all,
                                  [action.index]: checked
                                    ? picked.filter((id) => id !== creature.id)
                                    : [...picked, creature.id],
                                }))
                              }
                            />
                            {creature.name}
                          </label>
                        );
                      })}
                    </span>
                  )}
                  {action.sculpt && action.save?.area && (
                    <SculptPicks
                      action={action}
                      caught={caughtBy(action.save.area).filter((c) => c.id !== attacker.id)}
                      picked={sculpted}
                      onToggle={(id) =>
                        setSculpted((now) =>
                          now.includes(id) ? now.filter((other) => other !== id) : [...now, id]
                        )
                      }
                    />
                  )}
                  {action.beams && action.beams > 1 && (
                    <span className="flex px-2 pb-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        title={`${action.name} makes ${action.beams} beams: a separate attack roll each. Fire them all at ${target.name}, or one at a time with the row above.`}
                        onClick={() => void makeBeams(action)}
                      >
                        All {action.beams} beams
                      </Button>
                    </span>
                  )}
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
          {anyAttackRoll && canReckless && (
            <label
              className="flex items-center gap-2 text-sm text-ink"
              title="Reckless Attack, with the first attack roll of your turn: Advantage on attack rolls using Strength, and attack rolls against you have Advantage, until your next turn."
            >
              <input
                type="checkbox"
                checked={reckless}
                onChange={(event) => setReckless(event.target.checked)}
              />
              Attack recklessly
            </label>
          )}
          {anyAttackRoll && sacred && (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink">
              <label
                className="flex items-center gap-2"
                title="Sacred Weapon, as you take the Attack action: a use of Channel Divinity imbues the Melee weapon you attack with for 10 minutes. Add your Charisma modifier (at least +1) to attack rolls with it."
              >
                <input
                  type="checkbox"
                  checked={imbue}
                  onChange={(event) => setImbue(event.target.checked)}
                />
                Sacred Weapon{sacred.imbued ? ` (now: ${sacred.imbued})` : ''}
              </label>
              {(imbue || sacred.imbued) && (
                <label
                  className="flex items-center gap-2"
                  title="A hit with the Sacred Weapon deals Radiant damage instead of the weapon's own type."
                >
                  <input
                    type="checkbox"
                    checked={radiant}
                    onChange={(event) => setRadiant(event.target.checked)}
                  />
                  Radiant damage
                </label>
              )}
            </span>
          )}
          {anyAttackRoll && cunningEffects.length > 0 && (
            <label
              className="flex items-center justify-between gap-2 text-sm text-ink"
              title="Cunning Strike: forgo dice of your Sneak Attack for an effect, if this attack deals Sneak Attack. Saves are against 8 + Dexterity modifier + Proficiency Bonus."
            >
              Cunning Strike
              <select
                value={cunning}
                onChange={(event) => {
                  setCunning(event.target.value as '' | CunningEffect);
                  setCunningSecond('');
                }}
                className="input-cozy text-sm py-1"
              >
                <option value="">No Cunning Strike</option>
                {cunningEffects.map((effect) => (
                  <option key={effect} value={effect}>
                    {CUNNING_OPTIONS[effect]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {anyAttackRoll && cunning && cunningLimit > 1 && cunningEffects.length > 1 && (
            <label
              className="flex items-center justify-between gap-2 text-sm text-ink"
              title="Improved Cunning Strike: a second effect on the same Sneak Attack, paying the dice of each."
            >
              Second effect
              <select
                value={cunningSecond}
                onChange={(event) => setCunningSecond(event.target.value as '' | CunningEffect)}
                className="input-cozy text-sm py-1"
              >
                <option value="">None</option>
                {cunningEffects
                  .filter((effect) => effect !== cunning)
                  .map((effect) => (
                    <option key={effect} value={effect}>
                      {CUNNING_OPTIONS[effect]}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {metaOptions.length > 0 && (
            <label
              className="flex items-center justify-between gap-2 text-sm text-ink"
              title="Metamagic, with Sorcery Points, for the spell you cast: Careful protects the other creatures the area catches, Heightened gives this creature Disadvantage on its save, Distant doubles the range, Quickened casts it as a Bonus Action, Transmuted changes its Acid, Cold, Fire, Lightning, Poison or Thunder damage to another of those types."
            >
              Metamagic
              <select
                value={meta}
                onChange={(event) => setMeta(event.target.value as '' | CastingMetamagic)}
                className="input-cozy text-sm py-1"
              >
                <option value="">None</option>
                {metaOptions.includes('careful') && <option value="careful">Careful Spell (1)</option>}
                {metaOptions.includes('distant') && <option value="distant">Distant Spell (1)</option>}
                {metaOptions.includes('heightened') && <option value="heightened">Heightened Spell (2)</option>}
                {metaOptions.includes('quickened') && <option value="quickened">Quickened Spell (2)</option>}
                {metaOptions.includes('transmuted') && <option value="transmuted">Transmuted Spell (1)</option>}
              </select>
            </label>
          )}
          {meta === 'transmuted' && (
            <label className="flex items-center justify-between gap-2 text-sm text-ink">
              Damage becomes
              <select
                value={transmuteTo}
                onChange={(event) => setTransmuteTo(event.target.value as TransmutedType)}
                className="input-cozy text-sm py-1"
              >
                {(['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder'] as const).map((type) => (
                  <option key={type} value={type}>
                    {type[0].toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {attacks.some((action) => action.overchannel) && (
            <label
              className="flex items-center gap-2 text-sm text-ink"
              title={`Overchannel: a Wizard spell cast with a slot of level 1 to 5 deals its maximum damage. ${
                overchannelUses === 0
                  ? 'Free this time; each later use before a Long Rest deals you Necrotic damage.'
                  : `Used ${overchannelUses} ${overchannelUses === 1 ? 'time' : 'times'} since the last Long Rest: this one deals you ${overchannelUses + 1}d12 Necrotic damage for each level of the slot, past Resistance and Immunity.`
              }`}
            >
              <input
                type="checkbox"
                checked={overchannel}
                onChange={(event) => setOverchannel(event.target.checked)}
              />
              Overchannel
              {overchannelUses > 0 && (
                <span className="text-xs text-ink-muted">
                  ({overchannelUses + 1}d12 Necrotic a slot level to you)
                </span>
              )}
            </label>
          )}
          {anyAttackRoll && canBrutal && (
            <label
              className="flex items-center justify-between gap-2 text-sm text-ink"
              title="Brutal Strike, once on a turn you attack recklessly: give up Advantage on this Strength attack (it must not have Disadvantage). A hit deals an extra 1d10 and the effect."
            >
              Brutal Strike
              <select
                value={brutal}
                onChange={(event) => setBrutal(event.target.value as '' | 'forceful' | 'hamstring')}
                className="input-cozy text-sm py-1"
              >
                <option value="">No Brutal Strike</option>
                <option value="forceful">Forceful Blow (push 15 ft)</option>
                <option value="hamstring">Hamstring Blow (−15 ft Speed)</option>
              </select>
            </label>
          )}
          {attacks.some((action) => pactWeapons.includes(action.index)) && (
            <label
              className="flex items-center justify-between gap-2 text-sm text-ink"
              title="Pact of the Blade: your pact weapon can deal Necrotic, Psychic or Radiant damage instead of its own type."
            >
              Pact weapon deals
              <select
                value={pactDamage}
                onChange={(event) => setPactDamage(event.target.value as '' | PactDamageType)}
                className="input-cozy text-sm py-1"
              >
                <option value="">Its own damage type</option>
                <option value="necrotic">Necrotic</option>
                <option value="psychic">Psychic</option>
                <option value="radiant">Radiant</option>
              </select>
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
        {!point && (
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
        )}
        {!point && huntersMark && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            title={`${huntersMark} (a Bonus Action, with Concentration): your attack hits on ${target.name} deal an extra 1d6 Force damage. Cast it with a slot, or a use of Favored Enemy.`}
            onClick={() => void mark(huntersMark)}
          >
            {huntersMark}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
