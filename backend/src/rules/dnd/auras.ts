// ============================================
// Aura of Protection (Paladin 6), by the D&D rules (SRD 5.2.1)
//
// The Paladin and its allies in a 10-foot Emanation from it add the
// Paladin's Charisma modifier (at least +1) to their saving throws, while
// the Paladin is not Incapacitated. A creature in more than one such aura
// gains from one of them only: the best.
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
