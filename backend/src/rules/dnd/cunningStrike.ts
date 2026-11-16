// ============================================
// Cunning Strike (Rogue 5), by the D&D rules (SRD 5.2.1)
//
// When the Rogue deals Sneak Attack damage it can forgo Sneak Attack dice
// for an effect, the die removed before the roll; a save the effect calls
// for has a DC of 8 + the Rogue's Dexterity modifier + Proficiency Bonus.
//
//   • Poison (1d6): a Constitution save or Poisoned for 1 minute, repeating
//     the save at the end of each of its turns. Needs a Poisoner's Kit.
//   • Trip (1d6): a Large or smaller target makes a Dexterity save or is
//     knocked Prone.
//   • Withdraw (1d6): the Rogue moves up to half its Speed without
//     provoking Opportunity Attacks (the move is the player's).
//
// Improved Cunning Strike (Rogue 11): up to two effects on one Sneak
// Attack, paying the cost of each.
//
// Devious Strikes (Rogue 14) adds:
//
//   • Daze (2d6): a Constitution save, or on its next turn the target can
//     only move, or take an action, or take a Bonus Action (the table's to
//     hold it to).
//   • Knock Out (6d6): a Constitution save or Unconscious for 1 minute or
//     until it takes damage, repeating the save at the end of each of its
//     turns.
//   • Obscure (3d6): a Dexterity save or Blinded until the end of its next
//     turn.
//
// Supreme Sneak (Thief 9) adds:
//
//   • Stealth Attack (1d6): with the Hide action's Invisible condition, the
//     attack does not end it if the Rogue ends the turn behind
//     Three-Quarters or Total Cover (where it ends the turn is the table's).
// ============================================

import { abilityModifier } from './resources';

type Sheet = Record<string, unknown>;

export const CUNNING_EFFECTS = ['poison', 'trip', 'withdraw', 'daze', 'knockOut', 'obscure', 'stealth'] as const;

export type CunningEffect = (typeof CUNNING_EFFECTS)[number];

/** The Sneak Attack dice each effect costs. */
export const CUNNING_COST: Readonly<Record<CunningEffect, number>> = {
  poison: 1,
  trip: 1,
  withdraw: 1,
  daze: 2,
  knockOut: 6,
  obscure: 3,
  stealth: 1,
};

export const CUNNING_LABELS: Readonly<Record<CunningEffect, string>> = {
  poison: 'Poison',
  trip: 'Trip',
  withdraw: 'Withdraw',
  daze: 'Daze',
  knockOut: 'Knock Out',
  obscure: 'Obscure',
  stealth: 'Stealth Attack',
};

/** The feature that gives each effect; Cunning Strike itself gives the first three. */
export const CUNNING_FEATURE: Readonly<Record<CunningEffect, string>> = {
  poison: 'Cunning Strike',
  trip: 'Cunning Strike',
  withdraw: 'Cunning Strike',
  daze: 'Devious Strikes',
  knockOut: 'Devious Strikes',
  obscure: 'Devious Strikes',
  stealth: 'Supreme Sneak',
};

/** The effects a sheet's features give, in the rules' order. */
export function cunningEffectsOf(featureNames: ReadonlySet<string>): CunningEffect[] {
  if (!featureNames.has('cunning strike')) return [];
  return CUNNING_EFFECTS.filter((effect) => featureNames.has(CUNNING_FEATURE[effect].toLowerCase()));
}

/**
 * The effects chosen for one Sneak Attack, checked against the Rogue's
 * features and the dice it has: one effect, two with Improved Cunning
 * Strike, each a different one, their costs together no more than the dice.
 * `featureNames` are the sheet's feature names in lower case.
 */
export function chooseCunningStrike(
  chosen: readonly CunningEffect[],
  featureNames: ReadonlySet<string>,
  sneakDice: number
): { ok: true; cost: number; label: string } | { ok: false; reason: string } {
  if (!featureNames.has('cunning strike')) return { ok: false, reason: 'no Cunning Strike' };
  if (new Set(chosen).size !== chosen.length) return { ok: false, reason: 'A Cunning Strike effect is used once on a Sneak Attack' };
  if (chosen.length > 1 && !featureNames.has('improved cunning strike')) {
    return { ok: false, reason: 'Two Cunning Strike effects need Improved Cunning Strike' };
  }
  for (const effect of chosen) {
    const needs = CUNNING_FEATURE[effect];
    if (!featureNames.has(needs.toLowerCase())) return { ok: false, reason: `${CUNNING_LABELS[effect]} needs ${needs}` };
  }
  const cost = chosen.reduce((sum, effect) => sum + CUNNING_COST[effect], 0);
  if (sneakDice < cost) {
    return {
      ok: false,
      reason: sneakDice <= 0 ? 'Cunning Strike needs a Sneak Attack to forgo dice from' : `Those Cunning Strike effects cost ${cost}d6 of a ${sneakDice}d6 Sneak Attack`,
    };
  }
  return { ok: true, cost, label: chosen.map((effect) => CUNNING_LABELS[effect]).join(' and ') };
}

/** The DC of a Cunning Strike save: 8 + Dexterity modifier + Proficiency Bonus. */
export function cunningStrikeDC(sheet: Sheet): number {
  const proficiency = typeof sheet.proficiencyBonus === 'number' ? sheet.proficiencyBonus : 2;
  return 8 + abilityModifier(sheet, 'dexterity') + proficiency;
}

/** Whether the sheet's inventory has a Poisoner's Kit, which the Poison effect needs. */
export function hasPoisonersKit(sheet: Sheet): boolean {
  const items = Array.isArray(sheet.inventory) ? sheet.inventory : [];
  return items.some((item) => {
    const name = typeof item === 'string' ? item : (item as { name?: unknown })?.name;
    return typeof name === 'string' && /poisoner[’']?s kit/i.test(name);
  });
}
