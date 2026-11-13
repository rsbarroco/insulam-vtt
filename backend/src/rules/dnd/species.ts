// ============================================
// What a character's species does in play, by the D&D rules
//
// SRD 5.2.1, Character Origins, the species traits the VTT applies:
//
//   • Darkvision: the range its trait gives (60 feet, 120 for Dwarves and
//     Orcs), which a token placed for the character sees by.
//   • Damage resistances: Dwarven Resilience (Poison); a Dragonborn's Damage
//     Resistance, of its Draconic Ancestry's type; a Tiefling's Fiendish
//     Legacy (Abyssal Poison, Chthonic Necrotic, Infernal Fire).
//   • Luck (Halfling): a 1 on the d20 of a D20 Test is rerolled, and the new
//     roll is used.
//   • Relentless Endurance (Orc): reduced to 0 Hit Points but not killed
//     outright, it drops to 1 instead, once until a Long Rest.
//
// A sheet names its species as `race`; the choice a species asks for is
// written after it in parentheses: "Dragonborn (Red)", "Tiefling (Infernal)".
//
// Pure: a sheet in, what its species gives out.
// ============================================

import type { RollDie } from './d20';
import type { DamageType } from './damage';
import { findSpecies, type Species } from './origins';

type Sheet = Record<string, unknown>;

/** The species a sheet names, and the choice written after it. */
export function speciesOf(sheet: Sheet | null): { species: Species; choice: string | null } | null {
  const written =
    typeof sheet?.race === 'string'
      ? sheet.race
      : typeof sheet?.species === 'string'
        ? sheet.species
        : '';
  const match = /^\s*([^(]+?)\s*(?:\(\s*([^)]*?)\s*\))?\s*$/.exec(written);
  const species = match ? findSpecies(match[1]) : null;
  return species ? { species, choice: match?.[2] || null } : null;
}

const named = (species: Species, trait: string) =>
  species.traits.find((entry) => entry.name.toLowerCase() === trait.toLowerCase()) ?? null;

/** The range of a sheet's species' Darkvision in feet; 0 without it. */
export function darkvisionFeet(sheet: Sheet | null): number {
  const found = speciesOf(sheet);
  const trait = found ? named(found.species, 'Darkvision') : null;
  const range = trait ? /range of (\d+) feet/i.exec(trait.text) : null;
  return range ? Number(range[1]) : 0;
}

const FIENDISH: Readonly<Record<string, DamageType>> = {
  abyssal: 'poison',
  chthonic: 'necrotic',
  infernal: 'fire',
};

/** The damage types a sheet's species resists. */
export function speciesResistances(sheet: Sheet | null): DamageType[] {
  const found = speciesOf(sheet);
  if (!found) return [];
  const { species, choice } = found;
  const out: DamageType[] = [];
  if (named(species, 'Dwarven Resilience')) out.push('poison');
  if (named(species, 'Damage Resistance') && choice) {
    const ancestor = (species.tables?.['Draconic Ancestors'] ?? []).find(
      (row) => row.dragon?.toLowerCase() === choice.toLowerCase()
    );
    if (ancestor?.damageType) out.push(ancestor.damageType.toLowerCase() as DamageType);
  }
  if (named(species, 'Fiendish Legacy') && choice && FIENDISH[choice.toLowerCase()])
    out.push(FIENDISH[choice.toLowerCase()]);
  return out;
}

/** Whether a sheet's species has the Halfling's Luck. */
export function hasLuck(sheet: Sheet | null): boolean {
  const found = speciesOf(sheet);
  return found !== null && named(found.species, 'Luck') !== null;
}

/** Whether a sheet's species has the Orc's Relentless Endurance. */
export function hasRelentlessEndurance(sheet: Sheet | null): boolean {
  const found = speciesOf(sheet);
  return found !== null && named(found.species, 'Relentless Endurance') !== null;
}

/** A roller for a lucky creature: a 1 on a d20 is rolled again, and the new roll stands. */
export function lucky(roll: RollDie): RollDie {
  return (sides) => {
    const first = roll(sides);
    return sides === 20 && first === 1 ? roll(sides) : first;
  };
}

/**
 * Hit Points after damage for a creature with Relentless Endurance left:
 * reduced to 0 but not killed outright (the damage past 0 is less than its
 * maximum), it has 1. Null when the trait does nothing.
 */
export function endure(
  before: { current: number; max: number; temp: number },
  dealt: number,
  after: number
): number | null {
  if (before.current <= 0 || after > 0) return null;
  const past = dealt - before.current - before.temp;
  return past >= before.max ? null : 1;
}
