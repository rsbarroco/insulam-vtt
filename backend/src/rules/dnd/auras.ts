// ============================================
// Aura of Protection (Paladin 6), by the D&D rules (SRD 5.2.1)
//
// The Paladin and its allies in a 10-foot Emanation from it add the
// Paladin's Charisma modifier (at least +1) to their saving throws, while
// the Paladin is not Incapacitated. A creature in more than one such aura
// gains from one of them only: the best.
//
// The aura also carries Aura of Courage (Paladin 10: immunity to the
// Frightened condition) and Aura of Devotion (Oath of Devotion 7: immunity to
// the Charmed condition) for the Paladin and its allies in it; a creature
// that enters it with the condition is not affected by it while there. Aura
// Expansion (Paladin 18) makes it a 30-foot Emanation.
// ============================================

import { hasFeature, readFeatures } from './featureEffects';
import { abilityModifier } from './resources';

type Sheet = Record<string, unknown>;

/** How far the aura reaches from the Paladin, in feet. */
export const AURA_FEET = 10;

/** What a sheet's Aura of Protection adds to saves: its Charisma modifier, at least 1; 0 without the aura. */
export function auraOfProtectionBonus(sheet: Sheet | null): number {
  if (!sheet || !hasFeature(readFeatures(sheet), 'Aura of Protection')) return 0;
  return Math.max(1, abilityModifier(sheet, 'charisma'));
}

/** How far an Aura of Protection reaches with Aura Expansion, in feet. */
export const EXPANDED_AURA_FEET = 30;

/** How far a sheet's Aura of Protection reaches: 10 feet, 30 with Aura Expansion. */
export function auraFeet(sheet: Sheet | null): number {
  return sheet && hasFeature(readFeatures(sheet), 'Aura Expansion') ? EXPANDED_AURA_FEET : AURA_FEET;
}

/** The features that make an aura keep a condition off those in it, by the condition in lower case. */
const AURA_IMMUNITIES: Readonly<Record<string, string>> = {
  frightened: 'Aura of Courage',
  charmed: 'Aura of Devotion',
};

/** The conditions a sheet's aura keeps off the Paladin and its allies in it, with the feature that does. */
export function auraImmunities(sheet: Sheet | null): Array<{ condition: string; feature: string }> {
  if (!sheet) return [];
  const features = readFeatures(sheet);
  return Object.entries(AURA_IMMUNITIES)
    .filter(([, feature]) => hasFeature(features, feature))
    .map(([condition, feature]) => ({ condition, feature }));
}
