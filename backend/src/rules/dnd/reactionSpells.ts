// ============================================
// Spells cast as a Reaction, by the D&D rules (SRD 5.2.1)
//
// Shield answers a hit: +5 to AC until the start of the caster's next turn,
// the triggering attack included, so the hit is decided again. Counterspell
// answers a spell being cast within 60 feet: the caster makes a Constitution
// save against the reactor's spell save DC or the spell dissipates, its slot
// kept. Hellish Rebuke answers damage from a creature within 60 feet: a
// Dexterity save, 2d10 Fire damage (1d10 more a slot level above 1), half on
// a success. Feather Fall answers a fall: no damage from it.
//
// Each is decided once its trigger is known, so the server asks the caster's
// controller, and spends the slot and the reaction only on a yes.
// ============================================

import type { CombatAction, DamageComponent } from './actions';
import { findSpell, slotsLeft, type SheetSpellcasting } from './spells';

export const SHIELD = 'Shield';
export const COUNTERSPELL = 'Counterspell';
export const HELLISH_REBUKE = 'Hellish Rebuke';
export const FEATHER_FALL = 'Feather Fall';

/** What Shield adds to the caster's Armor Class. */
export const SHIELD_BONUS = 5;
/** How far Counterspell, Hellish Rebuke and Feather Fall reach, in feet. */
export const REACTION_SPELL_FEET = 60;

/** Whether the sheet has the spell prepared (a sheet that does not mark preparation has every spell it lists ready). */
export function hasPrepared(sheet: SheetSpellcasting | null | undefined, name: string): boolean {
  const wanted = findSpell(name);
  if (!wanted) return false;
  return (sheet?.spellcasting?.spells ?? []).some((entry) => entry.prepared !== false && findSpell(entry.name)?.id === wanted.id);
}

/** The slot levels the sheet could cast the prepared spell with, lowest first; empty when it is not prepared or no slot is left. */
export function reactionSlots(sheet: SheetSpellcasting | null | undefined, name: string): number[] {
  const spell = findSpell(name);
  if (!spell || !hasPrepared(sheet, name)) return [];
  return Object.keys(slotsLeft(sheet))
    .map(Number)
    .filter((level) => level >= spell.level)
    .sort((a, b) => a - b);
}

/** The lowest slot the sheet could cast the prepared spell with, or null. */
export function lowestReactionSlot(sheet: SheetSpellcasting | null | undefined, name: string): number | null {
  return reactionSlots(sheet, name)[0] ?? null;
}

/** A prompt option that names the slot: "Shield (level 1 slot)". */
export function slotOption(name: string, level: number): string {
  return `${name} (level ${level} slot)`;
}

/** The slot level a prompt answer names for the spell, or null when the answer is not that spell. */
export function slotOfOption(name: string, choice: string | null): number | null {
  if (!choice || !choice.startsWith(`${name} (level `)) return null;
  const level = Number(/\(level (\d) slot\)$/.exec(choice)?.[1]);
  return Number.isInteger(level) ? level : null;
}

/**
 * Whether Shield would turn this hit into a miss: the roll is no natural 20
 * (which hits whatever the AC) and its total falls short of the Armor Class
 * it met (cover included) plus 5.
 */
export function shieldTurnsHit(outcome: { hit: boolean; armorClass: number; roll: { natural: number; total: number } }): boolean {
  return outcome.hit && outcome.roll.natural !== 20 && outcome.roll.total < outcome.armorClass + SHIELD_BONUS;
}

/** Hellish Rebuke's damage with a slot of `slotLevel`: 2d10 Fire, 1d10 more for each level above 1. */
export function hellishRebukeDamage(slotLevel: number): DamageComponent {
  return { roll: { count: 2 + Math.max(0, slotLevel - 1), sides: 10, bonus: 0 }, type: 'fire' };
}

/**
 * Whether Counterspell can answer the action: a spell of the catalogue with a
 * Verbal, Somatic or Material component, cast in a way that keeps them
 * (`subtle` is a cast whose Verbal and Somatic components were dropped).
 */
export function counterable(action: CombatAction, subtle = false): boolean {
  const spell = action.spell ? findSpell(action.spell.id) : null;
  if (!spell) return false;
  return spell.components.some((component) => component === 'M' || (!subtle && (component === 'V' || component === 'S')));
}
