// ============================================
// Divine Smite, by the D&D rules (SRD 5.2.1)
//
// A Bonus Action spell taken right after hitting with a Melee weapon or an
// Unarmed Strike: the target takes an extra 2d8 Radiant damage, 1d8 more for
// each slot level above 1, and 1d8 more if it is a Fiend or an Undead. The
// dice are the attack's, so a Critical Hit doubles them.
//
// The VTT asks for it with the attack, before the roll: the slot is spent
// only if the attack hits.
// ============================================

import type { CombatAction, DamageComponent } from './actions';
import type { SheetSpellcasting } from './spells';
import { featureName } from './featureEffects';

/** Whether the sheet has Divine Smite ready: the spell prepared, or a Paladin's Smite that keeps it so. */
export function hasDivineSmite(sheet: (SheetSpellcasting & { featuresAndTraits?: unknown }) | null | undefined): boolean {
  const spells = sheet?.spellcasting?.spells ?? [];
  if (spells.some((spell) => typeof spell?.name === 'string' && spell.name.trim().toLowerCase() === 'divine smite' && spell.prepared !== false)) {
    return true;
  }
  const features = Array.isArray(sheet?.featuresAndTraits) ? sheet.featuresAndTraits : [];
  return features.some((entry) => {
    const name = typeof entry === 'string' ? entry : (entry as { name?: unknown })?.name;
    return typeof name === 'string' && /^paladin[’']s smite$/i.test(featureName(name));
  });
}

/** Whether a creature type, as a stat block writes it ("Medium Undead"), is a Fiend or an Undead. */
export function fiendOrUndead(creatureType: string | null | undefined): boolean {
  return /\b(fiend|undead)\b/i.test(creatureType ?? '');
}

/** The extra damage of Divine Smite cast with a slot of `slotLevel` against a creature of this type. */
export function divineSmiteDamage(slotLevel: number, creatureType?: string | null): DamageComponent {
  const count = 2 + Math.max(0, slotLevel - 1) + (fiendOrUndead(creatureType) ? 1 : 0);
  return { roll: { count, sides: 8 }, type: 'radiant' };
}

/** Whether an attack can carry a smite: a Melee weapon attack or an Unarmed Strike, not a spell. */
export function canSmiteWith(action: CombatAction): boolean {
  if (action.source === 'spell') return false;
  if (action.unarmed === 'damage') return true;
  return action.attack?.kind === 'melee';
}
