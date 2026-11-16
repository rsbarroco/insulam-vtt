// ============================================
// The Evoker's features and Magic Missile, by the D&D rules (SRD 5.2.1)
//
//   • Potent Cantrip (Evoker 3): a cantrip that misses with its attack roll,
//     or whose target succeeds on the save, still deals half its damage.
//   • Sculpt Spells (Evoker 6): casting an Evocation spell, 1 + the spell's
//     level of the other creatures it affects that the Wizard can see succeed
//     on their saves, and take no damage where they would take half.
//   • Empowered Evocation (Evoker 10): the Intelligence modifier added to one
//     damage roll of a Wizard spell of the Evocation school.
//   • Overchannel (Evoker 14): a Wizard spell cast with a slot of level 1–5
//     deals its maximum damage. The first use until a Long Rest is free; each
//     later one deals the Wizard 2d12 Necrotic damage for each level of the
//     slot, 1d12 more a level each time, past Resistance and Immunity.
//   • Magic Missile: three darts, one more for each slot level above 1, each
//     striking a creature the caster sees for 1d4 + 1 Force damage, no roll.
//
// A feature is read from the sheet: a Wizard that lists it has it. A "Wizard
// spell" is one on the Wizard spell list; which class a multiclass character
// prepared it with is not something the sheet says.
//
// Pure, like resolveSave: the caller loads the creatures and the board and
// stores what comes back.
// ============================================

import { coverBetween, distanceFeet } from '../../utils/boardSight';
import type { CombatAction, DamageComponent } from './actions';
import { canAct, readConditions } from './conditions';
import { rollDie, type RollDie } from './d20';
import { adjustedDamage, applyDamage, halfDamage, rollDamage, type DamageRoll, type HitPoints, type RolledDamage } from './damage';
import { hasFeature, readFeatures } from './featureEffects';
import type { AttackRefusal, AttackRequest, AttackResult, Combatant } from './resolveAttack';
import { abilityModifier, classLevel, resourcesOf } from './resources';
import { findSpell } from './spells';

type Sheet = Record<string, unknown>;

export type EvokerFeature = 'Potent Cantrip' | 'Sculpt Spells' | 'Empowered Evocation' | 'Overchannel';

/** Whether a sheet is a Wizard's that lists the Evoker feature. */
export function evokerHas(sheet: Sheet | null | undefined, feature: EvokerFeature): boolean {
  return !!sheet && classLevel(sheet, 'Wizard') > 0 && hasFeature(readFeatures(sheet), feature);
}

const spellOf = (action: CombatAction) => (action.source === 'spell' && action.spell ? findSpell(action.spell.id) : null);

/** A spell of the Evocation school. */
export function isEvocation(action: CombatAction): boolean {
  return spellOf(action)?.school === 'Evocation';
}

/** A spell on the Wizard spell list. */
export function isWizardSpell(action: CombatAction): boolean {
  return spellOf(action)?.classes.includes('Wizard') === true;
}

/** The damage an action deals, whichever way it deals it. */
function damageOf(action: CombatAction): readonly DamageComponent[] {
  return action.attack?.damage ?? action.save?.damage ?? (action.darts ? [action.darts.damage] : []);
}

// ---------- Potent Cantrip ----------

/** Whether Potent Cantrip changes this casting: a cantrip that deals damage, cast by a Wizard that lists the feature. */
export function potentCantripApplies(sheet: Sheet | null | undefined, action: CombatAction): boolean {
  return evokerHas(sheet, 'Potent Cantrip') && action.source === 'spell' && action.spell?.level === 0 && damageOf(action).length > 0;
}

/** A cantrip's saving throw with Potent Cantrip: a creature that succeeds takes half the damage. */
export function withPotentCantrip(action: CombatAction): CombatAction {
  return action.save ? { ...action, save: { ...action.save, halfOnSuccess: true } } : action;
}

/**
 * A cantrip's missed attack roll with Potent Cantrip: the damage is rolled as
 * a hit's (never a Critical Hit's) and the target takes half of it, through
 * its defences. A hit is left as it is.
 */
export function potentMiss(
  result: AttackResult,
  target: Pick<Combatant, 'name' | 'hp' | 'defences'>,
  action: Pick<CombatAction, 'attack'>,
  roll: RollDie = rollDie
): AttackResult {
  if (result.outcome.hit || !action.attack || action.attack.damage.length === 0) return result;
  const damage = action.attack.damage.map((component) => ({ type: component.type, rolled: rollDamage(component.roll, false, roll) }));
  const dealt = damage.reduce((sum, line) => {
    const half = halfDamage(line.rolled.total);
    return sum + (line.type === null ? half : adjustedDamage({ amount: half, type: line.type }, target.defences ?? {}));
  }, 0);
  let hp = target.hp;
  let dropped = false;
  let instantDeath = false;
  if (target.hp && dealt > 0) {
    const applied = applyDamage(target.hp, [{ amount: dealt, type: 'force' }]);
    hp = applied.hp;
    dropped = applied.dropped;
    instantDeath = applied.instantDeath;
  }
  const types = [...new Set(damage.map((line) => line.type).filter(Boolean))].join(' and ');
  const fate = instantDeath ? `; ${target.name} is killed outright` : dropped ? `; ${target.name} drops to 0 hit points` : '';
  return {
    ...result,
    damage,
    dealt,
    hp,
    dropped,
    instantDeath,
    bonuses: [...result.bonuses, 'Potent Cantrip'],
    summary: `${result.summary}, half damage: ${dealt}${types ? ` ${types}` : ''} damage${fate}`,
  };
}

// ---------- Sculpt Spells ----------

/** How many creatures Sculpt Spells protects: 1 + the spell's level, which is the level of the slot it is cast with. */
export function sculptCount(action: CombatAction, slotLevel: number | null): number {
  return 1 + (slotLevel ?? action.spell?.level ?? 0);
}

/** Whether Sculpt Spells can change this spell: an Evocation spell that calls for a saving throw. */
export function canSculpt(sheet: Sheet | null | undefined, action: CombatAction): boolean {
  return evokerHas(sheet, 'Sculpt Spells') && isEvocation(action) && action.save !== undefined;
}

/**
 * The creatures Sculpt Spells protects, checked against the rules: the
 * feature on the sheet, an Evocation spell with a saving throw, and the
 * creatures picked among the spell's other targets, 1 + the spell's level at
 * most. Whether the Wizard sees each is the caller's to check.
 */
export function sculptSpells(
  sheet: Sheet | null | undefined,
  caster: { id: string; name: string },
  action: CombatAction,
  slotLevel: number | null,
  picked: readonly string[],
  targetIds: readonly string[]
): { error: string } | { protectedIds: ReadonlySet<string> } {
  if (!evokerHas(sheet, 'Sculpt Spells')) return { error: `${caster.name} has no Sculpt Spells` };
  if (!isEvocation(action)) return { error: 'Sculpt Spells changes a spell of the Evocation school' };
  if (!action.save) return { error: 'Sculpt Spells changes a spell that calls for a saving throw' };
  if (picked.includes(caster.id)) return { error: 'Sculpt Spells protects other creatures' };
  if (picked.length === 0 || picked.some((id) => !targetIds.includes(id)) || new Set(picked).size !== picked.length) {
    return { error: "Sculpt Spells picks creatures among the spell's targets" };
  }
  const most = sculptCount(action, slotLevel);
  if (picked.length > most) return { error: `Sculpt Spells protects ${most} ${most === 1 ? 'creature' : 'creatures'} at most with this spell` };
  return { protectedIds: new Set(picked) };
}

// ---------- Empowered Evocation ----------

/** What Empowered Evocation adds to one damage roll of this spell: the Intelligence modifier, or 0 when it does not apply. */
export function empoweredEvocationBonus(sheet: Sheet | null | undefined, action: CombatAction): number {
  if (!sheet || !evokerHas(sheet, 'Empowered Evocation') || !isEvocation(action) || !isWizardSpell(action) || damageOf(action).length === 0) return 0;
  return Math.max(0, abilityModifier(sheet, 'intelligence'));
}

/** A spell's attack or save with `bonus` added to its damage roll (the first it names). Darts take it in `resolveDarts`. */
export function withDamageRollBonus(action: CombatAction, bonus: number): CombatAction {
  if (bonus === 0) return action;
  const add = (damage: readonly DamageComponent[]) =>
    damage.map((line, index) => (index === 0 ? { ...line, roll: { ...line.roll, bonus: (line.roll.bonus ?? 0) + bonus } } : line));
  if (action.attack && action.attack.damage.length > 0) return { ...action, attack: { ...action.attack, damage: add(action.attack.damage) } };
  if (action.save && action.save.damage.length > 0) return { ...action, save: { ...action.save, damage: add(action.save.damage) } };
  return action;
}

// ---------- Overchannel ----------

/** Whether Overchannel can change this spell at some slot: a Wizard spell of level 1–5 that deals damage, on a sheet with the feature. */
export function canOverchannel(sheet: Sheet | null | undefined, action: CombatAction): boolean {
  const level = action.spell?.level ?? 0;
  return level >= 1 && level <= 5 && overchannelRefusal(sheet, '', action, level) === null;
}

/** Why this casting cannot be overchannelled, or null when it can. */
export function overchannelRefusal(sheet: Sheet | null | undefined, caster: string, action: CombatAction, slotLevel: number | null): string | null {
  if (!evokerHas(sheet, 'Overchannel')) return `${caster} has no Overchannel`;
  if (action.source !== 'spell' || !isWizardSpell(action)) return 'Overchannel changes a Wizard spell';
  if (slotLevel === null || slotLevel < 1 || slotLevel > 5) return 'Overchannel changes a spell cast with a spell slot of level 1 to 5';
  if (damageOf(action).length === 0) return 'Overchannel changes a spell that deals damage';
  return null;
}

/**
 * The Necrotic damage Overchannel deals the Wizard, after `earlier` uses since
 * the last Long Rest: none the first time, then 2d12 for each level of the
 * slot, 3d12 the time after, and so on.
 */
export function overchannelBacklash(earlier: number, slotLevel: number): DamageRoll | null {
  return earlier <= 0 ? null : { count: (1 + earlier) * slotLevel, sides: 12 };
}

// ---------- A casting, with all of the above ----------

export interface EvokerCasting {
  /** The spell as the always-on features leave it: Potent Cantrip's half damage on a save, Empowered Evocation's bonus. */
  action: CombatAction;
  /** Potent Cantrip applies: a missed attack roll deals half damage too. */
  potent: boolean;
  /** What Empowered Evocation adds to one damage roll; 0 for none. Already in `action` unless it throws darts. */
  empowered: number;
  /** The creatures Sculpt Spells protects. */
  protectedIds: ReadonlySet<string>;
  /** Overchannel is used: each damage die at its highest number. */
  overchannel: boolean;
  /** What Overchannel deals the Wizard after the spell; null for the first use, or none. */
  backlash: DamageRoll | null;
}

/**
 * What an Evoker's features do to a spell as it is cast: Sculpt Spells and
 * Overchannel when chosen, checked against the rules; Potent Cantrip and
 * Empowered Evocation whenever they apply. A sheet without the features gets
 * the action back as it is.
 */
export function evokerCasting(
  sheet: Sheet | null | undefined,
  caster: { id: string; name: string },
  cast: CombatAction,
  slotLevel: number | null,
  chosen: { sculpt?: readonly string[]; overchannel?: boolean; targetIds: readonly string[] }
): { error: string } | EvokerCasting {
  let action = cast;
  let protectedIds: ReadonlySet<string> = new Set();
  if (chosen.sculpt) {
    const sculpted = sculptSpells(sheet, caster, action, slotLevel, chosen.sculpt, chosen.targetIds);
    if ('error' in sculpted) return sculpted;
    protectedIds = sculpted.protectedIds;
  }
  let backlash: DamageRoll | null = null;
  if (chosen.overchannel) {
    const refusal = overchannelRefusal(sheet, caster.name, action, slotLevel);
    if (refusal) return { error: refusal };
    const earlier = resourcesOf(sheet!).find((entry) => entry.name === 'Overchannel')?.used ?? 0;
    backlash = overchannelBacklash(earlier, slotLevel!);
  }
  const potent = potentCantripApplies(sheet, action);
  if (potent) action = withPotentCantrip(action);
  const empowered = empoweredEvocationBonus(sheet, action);
  action = withDamageRollBonus(action, empowered);
  return { action, potent, empowered, protectedIds, overchannel: chosen.overchannel === true, backlash };
}

// ---------- Magic Missile ----------

export interface DartTarget extends Combatant {
  /** How many of the darts strike this creature. */
  darts: number;
}

export interface DartsRequest {
  source: Combatant;
  targets: readonly DartTarget[];
  action: CombatAction;
  board: AttackRequest['board'];
  /** Added to one dart's damage roll, the first: Empowered Evocation. */
  bonus?: number;
  /** Each die at its highest number: Overchannel. */
  maximum?: boolean;
}

export interface DartsResult {
  ok: true;
  /** One entry per target, in the order asked. */
  targets: Array<{
    name: string;
    /** Each dart as rolled. */
    rolls: RolledDamage[];
    /** Damage after the target's defences. */
    dealt: number;
    hp: HitPoints | null;
    dropped: boolean;
    instantDeath: boolean;
  }>;
  /** One line for the log. */
  summary: string;
}

const refuse = (reason: string): AttackRefusal => ({ ok: false, reason });

/**
 * Darts that strike with no attack roll and no saving throw: every dart is
 * divided among the targets, each within range and not behind total cover,
 * and rolls its own damage, which meets the target's defences.
 */
export function resolveDarts(request: DartsRequest, roll: RollDie = rollDie): DartsResult | AttackRefusal {
  const { source, targets, action, board } = request;
  const profile = action.darts;
  if (!profile) return refuse(`${action.name} has no darts to divide`);
  if (!canAct(readConditions(source.conditions, source.exhaustion))) return refuse(`${source.name} is Incapacitated and cannot act`);
  if (targets.some((target) => !Number.isInteger(target.darts) || target.darts < 1)) return refuse(`Each creature chosen is struck by at least one dart`);
  const sent = targets.reduce((sum, target) => sum + target.darts, 0);
  if (sent !== profile.count) return refuse(`${action.name} makes ${profile.count} darts; ${sent} were divided`);
  for (const target of targets) {
    const distance = distanceFeet(source.standing, target.standing, board);
    if (action.rangeFeet !== undefined && distance > action.rangeFeet) {
      return refuse(`${target.name} is ${distance} ft away, beyond the range of ${action.name} (${action.rangeFeet} ft)`);
    }
    if (coverBetween(source.standing, target.standing, board) === 'total') return refuse(`${target.name} is behind total cover`);
  }

  const die: RollDie = request.maximum ? (sides) => sides : roll;
  let bonusLeft = request.bonus ?? 0;
  const type = profile.damage.type;
  const results = targets.map((target) => {
    const rolls = Array.from({ length: target.darts }, () => {
      const rolled = rollDamage({ ...profile.damage.roll, bonus: (profile.damage.roll.bonus ?? 0) + bonusLeft }, false, die);
      bonusLeft = 0;
      return rolled;
    });
    const dealt = rolls.reduce((sum, rolled) => sum + (type === null ? rolled.total : adjustedDamage({ amount: rolled.total, type }, target.defences ?? {})), 0);
    let hp = target.hp;
    let dropped = false;
    let instantDeath = false;
    if (target.hp && dealt > 0) {
      const applied = applyDamage(target.hp, [{ amount: dealt, type: 'force' }]);
      hp = applied.hp;
      dropped = applied.dropped;
      instantDeath = applied.instantDeath;
    }
    return { name: target.name, rolls, dealt, hp, dropped, instantDeath };
  });
  const each = results.map((result, index) => {
    const count = targets[index].darts;
    const fate = result.instantDeath ? ', killed outright' : result.dropped ? ', drops to 0' : '';
    return `${result.name} is struck by ${count} ${count === 1 ? 'dart' : 'darts'} (${result.rolls.map((rolled) => rolled.total).join(' + ')}): ${result.dealt}${type ? ` ${type}` : ''} damage${fate}`;
  });
  return { ok: true, targets: results, summary: `${action.name} (${profile.count} darts): ${each.join('; ')}` };
}
