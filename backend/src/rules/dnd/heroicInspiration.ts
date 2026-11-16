// ============================================
// Heroic Inspiration, by the D&D rules
//
// SRD 5.2.1, Playing the Game and the Rules Glossary: "If you have Heroic
// Inspiration, you can expend it to reroll any die immediately after rolling
// it, and you must use the new roll." A character has it or not, never more
// than one. The DM gives it; a Human regains it as a Long Rest ends
// (Resourceful), and a Champion of level 10 gains it at the start of each of
// its turns when it has none (Heroic Warrior).
//
// The sheet keeps it as `inspiration: true`.
//
// What the VTT asks: after a d20 the server rolled for the character missed
// or failed (an attack roll, its own saving throw, an ability check). One
// d20 is rolled again: with Advantage or Disadvantage the lower of the two,
// which is the die a player would pick, and the roll is read again as the
// mode says. Rerolling a success, a damage die or any other die is the
// table's: the character spends it by hand.
//
// Pure: a sheet or a roll in, a sheet or a roll out.
// ============================================

import { rollDie, type D20Roll, type RollDie, type SaveOutcome } from './d20';
import { hasFeature, readFeatures } from './featureEffects';
import { speciesOf } from './species';

type Sheet = Record<string, unknown>;

export const HEROIC_INSPIRATION = 'Heroic Inspiration';

/** Whether a sheet holds Heroic Inspiration. */
export function hasHeroicInspiration(sheet: Sheet | null | undefined): boolean {
  return sheet?.inspiration === true;
}

/** A sheet that holds Heroic Inspiration, or no longer does. */
export function withHeroicInspiration(sheet: Sheet, held: boolean): Sheet {
  return { ...sheet, inspiration: held };
}

/**
 * A d20 roll with one die rolled again, which must be used. A roll with two
 * dice has its lower one rolled again, and counts the higher (Advantage) or
 * the lower (Disadvantage) of the new die and the one kept. The total is the
 * new d20 plus the modifier: whatever was added after the first roll is gone.
 */
export function rerollD20(rolled: D20Roll, roll: RollDie = rollDie): D20Roll {
  const again = roll(20);
  if (rolled.dice.length < 2) return { ...rolled, dice: [again], natural: again, total: again + rolled.modifier };
  const kept = Math.max(...rolled.dice);
  const dice = [kept, again];
  const natural = rolled.mode === 'disadvantage' ? Math.min(...dice) : Math.max(...dice);
  return { ...rolled, dice, natural, total: natural + rolled.modifier };
}

/** A failed saving throw with one d20 rolled again; a save that was not rolled stays as it is. */
export function rerolledSave(outcome: SaveOutcome, roll: RollDie = rollDie): SaveOutcome {
  if (!outcome.roll) return outcome;
  const again = rerollD20(outcome.roll, roll);
  return { roll: again, dc: outcome.dc, success: again.total >= outcome.dc };
}

/** Whether a sheet regains Heroic Inspiration as a Long Rest ends: a Human's Resourceful. */
export function isResourceful(sheet: Sheet | null): boolean {
  if (!sheet) return false;
  const found = speciesOf(sheet);
  const trait = found?.species.traits.find((entry) => entry.name === 'Resourceful');
  if (trait && /Heroic Inspiration/i.test(trait.text) && /Long Rest/i.test(trait.text)) return true;
  return hasFeature(readFeatures(sheet), 'Resourceful');
}

/** A sheet after a Long Rest's Resourceful: Heroic Inspiration, when it had none. */
export function resourcefulLongRest(sheet: Sheet): { sheet: Sheet; regained: string[] } {
  if (!isResourceful(sheet) || hasHeroicInspiration(sheet)) return { sheet, regained: [] };
  return { sheet: withHeroicInspiration(sheet, true), regained: [`${HEROIC_INSPIRATION} (Resourceful)`] };
}

/** Whether a sheet lists a Champion's Heroic Warrior (Fighter 10). */
export function hasHeroicWarrior(sheet: Sheet | null): boolean {
  return sheet !== null && hasFeature(readFeatures(sheet), 'Heroic Warrior');
}
