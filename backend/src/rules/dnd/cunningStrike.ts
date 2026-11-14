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
// ============================================

import { abilityModifier } from './resources';

type Sheet = Record<string, unknown>;

export type CunningEffect = 'poison' | 'trip' | 'withdraw';

/** The Sneak Attack dice each effect costs. */
export const CUNNING_COST: Readonly<Record<CunningEffect, number>> = { poison: 1, trip: 1, withdraw: 1 };

export const CUNNING_LABELS: Readonly<Record<CunningEffect, string>> = { poison: 'Poison', trip: 'Trip', withdraw: 'Withdraw' };

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
