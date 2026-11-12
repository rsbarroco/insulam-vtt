// ============================================
// Resolving an effect that calls for a saving throw, by the D&D rules
//
// A dragon's breath or a Fireball: the damage is rolled once, each target
// makes the saving throw against the DC with what its own conditions give,
// and takes the damage, half of it or none. A target behind cover from where
// the effect comes adds the cover to a Dexterity save.
//
// Pure, like resolveAttack: the caller loads the creatures and the board and
// stores what comes back.
// ============================================

import { coverBetween, distanceFeet, type Cover } from '../../utils/boardSight';
import type { CombatAction } from './actions';
import { canAct, readConditions, saveModifiers, type Ability } from './conditions';
import { coverBonus, rollDie, savingThrow, type RollDie, type SaveOutcome } from './d20';
import { adjustedDamage, applyDamage, halfDamage, rollDamage, type DamageType, type HitPoints, type RolledDamage } from './damage';
import type { AttackRefusal, AttackRequest, Combatant } from './resolveAttack';

export interface SaveTarget extends Combatant {
  /** What the creature adds to a save with the action's ability. Null when nothing gives one. */
  saveBonus: number | null;
}

export interface SaveRequest {
  source: Combatant;
  targets: readonly SaveTarget[];
  action: CombatAction;
  board: AttackRequest['board'];
}

export interface TargetSaveResult {
  name: string;
  outcome: SaveOutcome;
  /** Damage after the save and the target's defences. */
  dealt: number;
  /** The target's hit points afterwards, or null when it tracks none. */
  hp: HitPoints | null;
  dropped: boolean;
  instantDeath: boolean;
}

export interface SaveResult {
  ok: true;
  ability: Ability;
  dc: number;
  /** The damage as rolled once for every target; empty when the effect deals none. */
  damage: Array<{ type: DamageType | null; rolled: RolledDamage }>;
  /** One entry per target, in the order asked. */
  targets: TargetSaveResult[];
  /** One line for the log. */
  summary: string;
}

const ABILITY_LABELS: Readonly<Record<Ability, string>> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

const refuse = (reason: string): AttackRefusal => ({ ok: false, reason });

export function resolveSave(request: SaveRequest, roll: RollDie = rollDie): SaveResult | AttackRefusal {
  const { source, targets, action, board } = request;
  const profile = action.save;
  if (!profile) return refuse(`${action.name} calls for no saving throw the VTT can make`);
  if (targets.length === 0) return refuse(`${action.name} needs at least one target`);
  if (!canAct(readConditions(source.conditions, source.exhaustion))) {
    return refuse(`${source.name} is Incapacitated and cannot act`);
  }

  // How far a target may be: the action's range, and for an area what the
  // area adds beyond the point it starts from. An action that gives no range
  // (a stat block's sentence) is not checked.
  const farthest =
    action.rangeFeet === undefined ? null : action.rangeFeet + (action.area ? action.area.sizeFeet * (action.area.shape === 'sphere' || action.area.shape === 'cylinder' ? 2 : 1) : 0);

  const covers: Cover[] = [];
  for (const target of targets) {
    if (target.saveBonus === null) return refuse(`${target.name} has no ${ABILITY_LABELS[profile.ability]} save to roll`);
    const distance = distanceFeet(source.standing, target.standing, board);
    if (farthest !== null && farthest > 0 && distance > farthest) {
      return refuse(`${target.name} is ${distance} ft away, beyond what ${action.name} can reach (${farthest} ft)`);
    }
    const cover = coverBetween(source.standing, target.standing, board);
    // An area goes round corners or not by its own rules, which are the
    // table's to judge; a single target behind total cover cannot be chosen.
    if (cover === 'total' && !action.area) return refuse(`${target.name} is behind total cover`);
    covers.push(cover);
  }

  const damage = profile.damage.map((component) => ({ type: component.type, rolled: rollDamage(component.roll, false, roll) }));

  const results = targets.map((target, index): TargetSaveResult => {
    const modifiers = saveModifiers(readConditions(target.conditions, target.exhaustion), profile.ability);
    const cover = profile.ability === 'dex' && covers[index] !== 'total' ? coverBonus(covers[index]) : 0;
    const outcome = savingThrow(
      { bonus: target.saveBonus! + modifiers.penalty + cover, dc: profile.dc, mode: modifiers.mode, autoFail: modifiers.autoFail },
      roll
    );
    const dealt = damage.reduce((sum, entry) => {
      const amount = outcome.success ? (profile.halfOnSuccess ? halfDamage(entry.rolled.total) : 0) : entry.rolled.total;
      return sum + (entry.type === null ? amount : adjustedDamage({ amount, type: entry.type }, target.defences ?? {}));
    }, 0);
    let hp = target.hp;
    let dropped = false;
    let instantDeath = false;
    if (target.hp && dealt > 0) {
      // Already adjusted, so applied as it stands.
      const applied = applyDamage(target.hp, [{ amount: dealt, type: 'force' }]);
      hp = applied.hp;
      dropped = applied.dropped;
      instantDeath = applied.instantDeath;
    }
    return { name: target.name, outcome, dealt, hp, dropped, instantDeath };
  });

  const rolled = damage.map((entry) => `${entry.rolled.total}${entry.type ? ` ${entry.type}` : ''}`).join(' + ');
  const each = results.map((result) => {
    const rolledSave = result.outcome.roll ? ` (${result.outcome.roll.total})` : ' (no roll)';
    const verdict = result.outcome.success ? 'saves' : 'fails';
    const harm = damage.length > 0 ? `, ${result.dealt} damage` : '';
    const fate = result.instantDeath ? ', killed outright' : result.dropped ? ', drops to 0' : '';
    return `${result.name} ${verdict}${rolledSave}${harm}${fate}`;
  });
  const head = `${action.name} (DC ${profile.dc} ${ABILITY_LABELS[profile.ability]}${rolled ? `, ${rolled}` : ''})`;

  return { ok: true, ability: profile.ability, dc: profile.dc, damage, targets: results, summary: `${head}: ${each.join('; ')}` };
}
