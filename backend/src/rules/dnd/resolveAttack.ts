// ============================================
// Resolving one attack, by the D&D rules
//
// Everything the rules ask of an attack roll, in order: can the attacker
// act, is the target in reach or range and not behind total cover, what do
// the conditions of both and the distance do to the roll, the roll against
// Armor Class with cover, and on a hit the damage, doubled dice on a
// Critical Hit, through the target's defences and Temporary Hit Points.
//
// Pure: the caller loads the two creatures and the board, and stores what
// comes back. Nothing here reads or writes anything.
// ============================================

import { coverBetween, distanceFeet, type BoardHeights, type Cover, type Standing } from '../../utils/boardSight';
import type { CombatAction, DamageComponent } from './actions';
import { attackModifiers, canAct, readConditions } from './conditions';
import { attackRoll, rollDie, rollMode, type AttackOutcome, type RollDie, type RollMode } from './d20';
import { adjustedDamage, applyDamage, rollDamage, type DamageType, type Defences, type HitPoints, type RolledDamage } from './damage';

export interface Combatant {
  name: string;
  standing: Standing;
  /** Null when the creature has no sheet or stat block that gives one. */
  armorClass: number | null;
  /** Null when the creature tracks no hit points. */
  hp: HitPoints | null;
  /** Condition names as the token carries them. */
  conditions: readonly string[];
  /** Exhaustion level, when the sheet tracks one. */
  exhaustion?: number;
  /** Strength and Dexterity scores, when a sheet gives them: a Heavy weapon asks 13. */
  scores?: { str: number | null; dex: number | null };
  defences?: Defences;
}

export interface AttackRequest {
  attacker: Combatant;
  target: Combatant;
  action: CombatAction;
  board: {
    heights: BoardHeights | null;
    feetPerSquare: number;
    diagonalRule: 'flat' | 'alternating';
    /** Other creatures standing on the board, which can give cover. */
    others: readonly Standing[];
  };
  /** Advantage or Disadvantage the table grants beyond what the engine can see. */
  mode?: RollMode;
  /** Who cannot see whom, for a reason the conditions do not give: darkness on a lit map. */
  unseen?: { attacker?: boolean; target?: boolean };
  /** Reasons the caller found, written as the engine writes its own: "Advantage: Vex". */
  extraReasons?: readonly string[];
  /**
   * Damage a feature adds to a hit, once the roll's Advantage or Disadvantage
   * is known (a Rogue's Sneak Attack asks it); null when it adds none.
   */
  bonusDamage?: (mode: RollMode) => { label: string; damage: DamageComponent } | null;
}

export interface AttackRefusal {
  ok: false;
  reason: string;
}

export interface AttackResult {
  ok: true;
  distanceFeet: number;
  cover: Cover;
  /** Why the roll had Advantage or Disadvantage, in the order found. */
  reasons: string[];
  outcome: AttackOutcome;
  /** One entry per damage line of the action, as rolled; empty on a miss. */
  damage: Array<{ type: DamageType | null; rolled: RolledDamage }>;
  /** The features that added damage to the hit, by name: "Sneak Attack". */
  bonuses: string[];
  /** Damage after the target's defences. */
  dealt: number;
  /** The target's hit points afterwards, or null when it tracks none. */
  hp: HitPoints | null;
  dropped: boolean;
  instantDeath: boolean;
  /** One line for the log. */
  summary: string;
}

const refuse = (reason: string): AttackRefusal => ({ ok: false, reason });

export function resolveAttack(request: AttackRequest, roll: RollDie = rollDie): AttackResult | AttackRefusal {
  const { attacker, target, action, board } = request;
  const profile = action.attack;
  if (!profile) return refuse(`${action.name} has no attack roll the VTT can make`);
  if (target.armorClass === null) return refuse(`${target.name} has no Armor Class to roll against`);

  const attackerState = readConditions(attacker.conditions, attacker.exhaustion);
  const targetState = readConditions(target.conditions, target.exhaustion);
  if (!canAct(attackerState)) return refuse(`${attacker.name} is Incapacitated and cannot attack`);

  const distance = distanceFeet(attacker.standing, target.standing, board);
  const cover = coverBetween(attacker.standing, target.standing, board);
  if (cover === 'total') return refuse(`${target.name} is behind total cover`);

  const ranged = profile.kind === 'ranged';
  let longRange = false;
  if (ranged) {
    const range = profile.rangeFeet;
    if (range) {
      const farthest = range.long ?? range.normal;
      if (distance > farthest) return refuse(`${target.name} is ${distance} ft away, beyond the range of ${farthest} ft`);
      longRange = distance > range.normal;
    }
  } else {
    const reach = profile.reachFeet ?? 5;
    if (distance > reach) return refuse(`${target.name} is ${distance} ft away, beyond the reach of ${reach} ft`);
  }

  const modifiers = attackModifiers({
    attacker: attackerState,
    target: targetState,
    distanceFeet: distance,
    ranged,
    unseenAttacker: request.unseen?.attacker,
    unseenTarget: request.unseen?.target,
  });
  const reasons = [...modifiers.reasons];
  if (longRange) reasons.push('Disadvantage: the target is at long range');
  if (profile.heavy && attacker.scores) {
    const score = ranged ? attacker.scores.dex : attacker.scores.str;
    if (score !== null && score < 13) reasons.push(`Disadvantage: a Heavy weapon wants ${ranged ? 'Dexterity' : 'Strength'} 13`);
  }
  reasons.push(...(request.extraReasons ?? []));
  if (request.mode === 'advantage') reasons.push('Advantage: granted by the table');
  if (request.mode === 'disadvantage') reasons.push('Disadvantage: imposed by the table');
  const mode = rollMode(
    reasons.some((reason) => reason.startsWith('Advantage')),
    reasons.some((reason) => reason.startsWith('Disadvantage'))
  );

  const outcome = attackRoll(
    {
      bonus: profile.bonus + modifiers.penalty,
      armorClass: target.armorClass,
      cover,
      mode,
      criticalOnHit: modifiers.criticalOnHit,
    },
    roll
  );

  const damage: AttackResult['damage'] = [];
  const bonuses: string[] = [];
  let dealt = 0;
  let hp = target.hp;
  let dropped = false;
  let instantDeath = false;
  if (outcome.hit) {
    for (const component of profile.damage) {
      damage.push({ type: component.type, rolled: rollDamage(component.roll, outcome.critical, roll) });
    }
    const bonus = request.bonusDamage?.(mode) ?? null;
    if (bonus) {
      bonuses.push(bonus.label);
      damage.push({ type: bonus.damage.type, rolled: rollDamage(bonus.damage.roll, outcome.critical, roll) });
    }
    // Each line meets the target's defences on its own; damage of no named
    // type meets none.
    dealt = damage.reduce(
      (sum, entry) =>
        sum +
        (entry.type === null
          ? entry.rolled.total
          : adjustedDamage({ amount: entry.rolled.total, type: entry.type }, target.defences ?? {})),
      0
    );
    if (target.hp) {
      // Already adjusted, so applied as it stands.
      const applied = applyDamage(target.hp, [{ amount: dealt, type: 'force' }]);
      hp = applied.hp;
      dropped = applied.dropped;
      instantDeath = applied.instantDeath;
    }
  }

  return {
    ok: true,
    distanceFeet: distance,
    cover,
    reasons,
    outcome,
    damage,
    bonuses,
    dealt,
    hp,
    dropped,
    instantDeath,
    summary: summarize(target.name, action.name, outcome, damage, dealt, dropped, instantDeath),
  };
}

function summarize(
  target: string,
  action: string,
  outcome: AttackOutcome,
  damage: AttackResult['damage'],
  dealt: number,
  dropped: boolean,
  instantDeath: boolean
): string {
  const versus = `${action} vs ${target} (AC ${outcome.armorClass})`;
  if (!outcome.hit) return `${versus}: miss`;
  const types = [...new Set(damage.map((entry) => entry.type).filter(Boolean))].join(' and ');
  const amount = `${dealt}${types ? ` ${types}` : ''} damage`;
  const fate = instantDeath ? `; ${target} is killed outright` : dropped ? `; ${target} drops to 0 hit points` : '';
  return `${versus}: ${outcome.critical ? 'critical hit' : 'hit'}, ${amount}${fate}`;
}
