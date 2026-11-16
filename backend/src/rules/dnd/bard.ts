// ============================================
// The Bard and the College of Lore (SRD 5.2.1), past Bardic Inspiration
//
//   • Cutting Words (Lore 3): when a creature the Bard can see within 60 feet
//     makes a damage roll or succeeds on an ability check or attack roll, the
//     Bard can take a Reaction to expend a use of Bardic Inspiration, roll the
//     die and subtract the number from that roll.
//   • Font of Inspiration (Bard 5): expend a spell slot (no action) to regain
//     one expended use of Bardic Inspiration.
//   • Countercharm (Bard 7): when the Bard or a creature within 30 feet fails
//     a save against an effect that applies the Charmed or Frightened
//     condition, the Bard can take a Reaction to have the save rolled again,
//     with Advantage.
//   • Peerless Skill (Lore 14): when the Bard fails an ability check or attack
//     roll, it can expend a use of Bardic Inspiration, roll the die and add
//     it; on a failure the use isn't expended.
//   • Superior Inspiration (Bard 18): when the Bard rolls Initiative, it
//     regains expended uses of Bardic Inspiration until it has two.
//
// Each choice is made once the roll is known, so the handlers ask it then;
// what is here says who may be asked and what the answer does to the roll.
// ============================================

import type { CombatAction } from './actions';
import { conditionsOnFailure } from './actionConditions';
import type { CheckResult } from './checks';
import type { AttackOutcome, RollMode } from './d20';
import { hasFeature, readFeatures } from './featureEffects';
import { bardicDie, classLevel, resourcesOf } from './resources';
import { findSpell } from './spells';

type Sheet = Record<string, unknown>;

/** How far away the creature whose roll Cutting Words answers can be. */
export const CUTTING_WORDS_FEET = 60;
/** How far from the Bard a creature that failed its save can be, for Countercharm. */
export const COUNTERCHARM_FEET = 30;

export const CUT_ATTACK = 'Cutting Words (attack roll)';
export const CUT_DAMAGE = 'Cutting Words (damage)';

/** The uses of Bardic Inspiration a sheet has left. */
export function inspirationLeft(sheet: Sheet): number {
  const uses = resourcesOf(sheet).find((entry) => entry.name === 'Bardic Inspiration');
  return uses ? uses.max - uses.used : 0;
}

/** The sides of a Bard's Bardic Inspiration die: 6 to 12. */
export function bardicSides(sheet: Sheet): number {
  return Number((bardicDie(sheet) ?? 'd6').slice(1)) || 6;
}

/** A subclass feature of the Bard: read from the features the sheet lists, as the sheet names the subclass no other way. */
const loreFeature = (sheet: Sheet, name: string, level: number) =>
  classLevel(sheet, 'Bard') >= level && hasFeature(readFeatures(sheet), name);

/** Cutting Words with a use of Bardic Inspiration to spend on it. */
export function canCutWords(sheet: Sheet | null): sheet is Sheet {
  return sheet !== null && loreFeature(sheet, 'Cutting Words', 3) && inspirationLeft(sheet) > 0;
}

/** Peerless Skill with a use of Bardic Inspiration to roll. */
export function canUsePeerlessSkill(sheet: Sheet | null): sheet is Sheet {
  return sheet !== null && loreFeature(sheet, 'Peerless Skill', 14) && inspirationLeft(sheet) > 0;
}

/** Countercharm: a Bard of level 7 or more. */
export function hasCountercharm(sheet: Sheet | null): boolean {
  return sheet !== null && classLevel(sheet, 'Bard') >= 7;
}

/** Whether Cutting Words taken off a hit's attack roll would turn it into a miss: a 20 on the d20 hits whatever the total. */
export function cutTurnsToMiss(outcome: AttackOutcome, rolled: number): boolean {
  return outcome.hit && outcome.roll.natural !== 20 && outcome.roll.total - rolled < outcome.armorClass;
}

/** A hit whose attack roll Cutting Words lowered without turning it into a miss: the total as it is now. */
export function cutAttackOutcome(outcome: AttackOutcome, rolled: number): AttackOutcome {
  return { ...outcome, roll: { ...outcome.roll, total: outcome.roll.total - rolled } };
}

/** A successful check with Cutting Words subtracted, which may turn it into a failure. */
export function withCuttingWords(result: CheckResult, dc: number, rolled: number, bard: string): CheckResult {
  if (result.success !== true) return result;
  const total = result.total - rolled;
  const success = total >= dc;
  return {
    ...result,
    total,
    success,
    summary: `${result.summary}; ${bard}'s Cutting Words -${rolled}: ${total}, ${success ? 'still a success' : 'failure'}`,
  };
}

/** A failed check with Peerless Skill's die added, which may turn it into a success; the use is spent only then. */
export function withPeerlessSkill(result: CheckResult, dc: number, rolled: number): CheckResult {
  if (result.success !== false) return result;
  const total = result.total + rolled;
  const success = total >= dc;
  return {
    ...result,
    total,
    success,
    summary: `${result.summary}; Peerless Skill +${rolled}: ${total}, ${success ? 'success' : 'still a failure, the use is kept'}`,
  };
}

/**
 * Whether an action's failed save applies the Charmed or Frightened
 * condition, as far as its text says: a stat block's "Failure:" sentence, a
 * spell's description, or Turn Undead.
 */
export function charmsOrFrightens(action: Pick<CombatAction, 'source' | 'text' | 'name' | 'spell' | 'channel' | 'onlyCreatureType'>): boolean {
  if (action.onlyCreatureType === 'undead' && action.channel) return true;
  const named = (text: string) => /\b(charmed|frightened)\b/i.test(text);
  if (action.source === 'statBlock') {
    return conditionsOnFailure(action.text ?? '').some((rider) => named(rider.condition));
  }
  if (action.spell) {
    const spell = findSpell(action.spell.id) ?? findSpell(action.name);
    return (spell?.description ?? []).some((paragraph) => /\b(?:has|have) the (?:charmed|frightened) condition\b/i.test(paragraph));
  }
  return false;
}

/** How a save is rolled again with Countercharm: with Advantage, which a Disadvantage on the first roll cancels. */
export function countercharmMode(first: RollMode | undefined): RollMode {
  return first === 'disadvantage' ? 'normal' : 'advantage';
}

/**
 * Font of Inspiration: a sheet with one expended use of Bardic Inspiration
 * back, or why not. The spell slot is the caller's to spend.
 */
export function withInspirationRegained(sheet: Sheet): { ok: true; sheet: Sheet; left: number } | { ok: false; reason: string } {
  if (classLevel(sheet, 'Bard') < 5) return { ok: false, reason: 'Font of Inspiration is a Bard feature of level 5' };
  const uses = resourcesOf(sheet).find((entry) => entry.name === 'Bardic Inspiration');
  if (!uses || uses.used === 0) return { ok: false, reason: 'No expended use of Bardic Inspiration to regain' };
  const featureUses = { ...((sheet.featureUses ?? {}) as Record<string, unknown>), 'Bardic Inspiration': uses.used - 1 };
  return { ok: true, sheet: { ...sheet, featureUses }, left: uses.max - uses.used + 1 };
}

/**
 * Superior Inspiration: the sheet as rolling Initiative leaves it, with uses
 * of Bardic Inspiration regained until it has two; null when nothing changes.
 */
export function withSuperiorInspiration(sheet: Sheet): { sheet: Sheet; regained: number } | null {
  if (classLevel(sheet, 'Bard') < 18) return null;
  const uses = resourcesOf(sheet).find((entry) => entry.name === 'Bardic Inspiration');
  if (!uses) return null;
  const wanted = Math.min(2, uses.max);
  const left = uses.max - uses.used;
  if (left >= wanted) return null;
  const featureUses = { ...((sheet.featureUses ?? {}) as Record<string, unknown>), 'Bardic Inspiration': uses.max - wanted };
  return { sheet: { ...sheet, featureUses }, regained: wanted - left };
}
