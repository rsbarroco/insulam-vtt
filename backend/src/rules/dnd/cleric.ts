// ============================================
// A Cleric's features and the Life Domain, by the D&D rules (SRD 5.2.1)
//
//   • Disciple of Life (Life Domain 3): a spell cast with a spell slot that
//     restores Hit Points restores 2 + the slot's level more.
//   • Preserve Life (Life Domain 3): a Magic action and a use of Channel
//     Divinity; five times the Cleric level in Hit Points, divided among
//     Bloodied creatures within 30 feet (the Cleric among them), none of them
//     restored to more than half its Hit Point maximum.
//   • Blessed Healer (Life Domain 6): after such a spell restores Hit Points
//     to a creature other than the Cleric, the Cleric regains 2 + the slot's
//     level.
//   • Supreme Healing (Life Domain 17): dice rolled to restore Hit Points with
//     a spell or Channel Divinity are not rolled; each is its highest number.
//   • Sear Undead (Cleric 5): Turn Undead rolls d8s equal to the Wisdom
//     modifier (at least one); each Undead that fails takes the total as
//     Radiant damage, which does not end the turn effect.
//   • Blessed Strikes (Cleric 7), one of two options. Divine Strike: once on
//     each of the Cleric's turns, a hit with a weapon deals 1d8 more Necrotic
//     or Radiant damage (2d8 from Cleric 14, Improved Blessed Strikes).
//     Potent Spellcasting: the Wisdom modifier is added to the damage of a
//     Cleric cantrip.
//
// The Life Domain's features are read by name from the sheet's features. The
// option taken for Blessed Strikes is the one a feature's name gives:
// "Divine Strike", "Blessed Strikes: Potent Spellcasting", "Blessed Strikes
// (Divine Strike)". A sheet that names neither option leaves it to the table.
//
// Pure.
// ============================================

import type { CombatAction, DamageComponent } from './actions';
import type { RollDie } from './d20';
import { rollDamage, type HitPoints, type RolledDamage } from './damage';
import { hasFeature, readFeatures } from './featureEffects';
import { abilityModifier, classLevel } from './resources';
import { findSpell } from './spells';

type Sheet = Record<string, unknown>;

/** Whether a Cleric's sheet lists a feature by name. */
function clericHas(sheet: Sheet | null | undefined, feature: string): boolean {
  return !!sheet && classLevel(sheet, 'Cleric') > 0 && hasFeature(readFeatures(sheet), feature);
}

/** Disciple of Life: what a healing spell cast with a slot of `slotLevel` restores on top; 0 without the feature or the slot. */
export function discipleOfLifeBonus(sheet: Sheet | null | undefined, slotLevel: number | null): number {
  return slotLevel !== null && slotLevel > 0 && clericHas(sheet, 'Disciple of Life') ? 2 + slotLevel : 0;
}

/** Blessed Healer: what the Cleric regains after a spell cast with a slot heals another creature; 0 otherwise. */
export function blessedHealerHealing(sheet: Sheet | null | undefined, slotLevel: number | null, healsAnother: boolean): number {
  return healsAnother && slotLevel !== null && slotLevel > 0 && clericHas(sheet, 'Blessed Healer') ? 2 + slotLevel : 0;
}

/** Supreme Healing: whether the sheet's healing dice are their highest number instead of rolled. */
export function hasSupremeHealing(sheet: Sheet | null | undefined): boolean {
  return clericHas(sheet, 'Supreme Healing');
}

/** Healing dice rolled, or each at its highest number with Supreme Healing. */
export function rollHealing(heal: { roll: { count: number; sides: number }; bonus: number }, supreme: boolean, roll?: RollDie): RolledDamage {
  const dice = { count: heal.roll.count, sides: heal.roll.sides, bonus: heal.bonus };
  return supreme ? rollDamage(dice, false, (sides) => sides) : rollDamage(dice, false, roll);
}

/** Sear Undead: the d8s Turn Undead rolls for a Cleric of level 5 or more, the Wisdom modifier and at least one; 0 below. */
export function searUndeadDice(sheet: Sheet): number {
  return classLevel(sheet, 'Cleric') >= 5 ? Math.max(1, abilityModifier(sheet, 'wisdom')) : 0;
}

export type BlessedStrikes = 'divineStrike' | 'potentSpellcasting';

/** The Blessed Strikes option a Cleric of level 7 or more took, by the name of a feature; null when the sheet names neither, or both. */
export function blessedStrikesOf(sheet: Sheet | null | undefined): BlessedStrikes | null {
  if (!sheet || classLevel(sheet, 'Cleric') < 7) return null;
  const names = readFeatures(sheet).map((feature) => feature.name.toLowerCase());
  const strike = names.some((name) => name.includes('divine strike'));
  // A gestalt Druid's Elemental Fury has a Potent Spellcasting of its own: a name tagged for the Druid is not the Cleric's.
  const potent = names.some((name) => name.includes('potent spellcasting') && !/elemental fury|druid/.test(name));
  if (strike === potent) return null;
  return strike ? 'divineStrike' : 'potentSpellcasting';
}

/** An attack roll made with a weapon: a sheet's attack, not a spell or an Unarmed Strike. */
const weaponAttack = (action: CombatAction) => action.attack !== undefined && action.source === 'sheet' && !action.unarmed;

/** Divine Strike: the d8s a weapon hit can add, 1 from Cleric 7 and 2 from 14; 0 for another attack or without the option. */
export function divineStrikeDice(sheet: Sheet | null | undefined, action: CombatAction): number {
  if (!sheet || !weaponAttack(action) || blessedStrikesOf(sheet) !== 'divineStrike') return 0;
  return classLevel(sheet, 'Cleric') >= 14 ? 2 : 1;
}

/** The prompt's options for Divine Strike, and the damage type each one deals. */
export const DIVINE_STRIKE_OPTIONS: Readonly<Record<string, 'radiant' | 'necrotic'>> = {
  'Divine Strike (Radiant)': 'radiant',
  'Divine Strike (Necrotic)': 'necrotic',
};

/** Divine Strike's extra damage. */
export function divineStrikeDamage(dice: number, type: 'radiant' | 'necrotic'): DamageComponent {
  return { roll: { count: dice, sides: 8 }, type };
}

/** A sheet's spell actions with Potent Spellcasting: the Wisdom modifier added to the damage of each Cleric cantrip. */
export function withPotentSpellcasting(sheet: Sheet, actions: readonly CombatAction[]): CombatAction[] {
  const wisdom = abilityModifier(sheet, 'wisdom');
  if (wisdom <= 0 || blessedStrikesOf(sheet) !== 'potentSpellcasting') return [...actions];
  const add = (damage: DamageComponent[]) =>
    damage.map((line, index) => (index === 0 ? { ...line, roll: { ...line.roll, bonus: (line.roll.bonus ?? 0) + wisdom } } : line));
  return actions.map((action) => {
    if (action.spell?.level !== 0 || !findSpell(action.spell.id)?.classes.includes('Cleric')) return action;
    if (action.attack && action.attack.damage.length > 0) return { ...action, attack: { ...action.attack, damage: add(action.attack.damage) } };
    if (action.save && action.save.damage.length > 0) return { ...action, save: { ...action.save, damage: add(action.save.damage) } };
    return action;
  });
}

/** Preserve Life: the Hit Points a Cleric's use restores, five times the Cleric level; 0 when the sheet does not list it. */
export function preserveLifePool(sheet: Sheet | null | undefined): number {
  return sheet && clericHas(sheet, 'Preserve Life') ? 5 * classLevel(sheet, 'Cleric') : 0;
}

/** How far Preserve Life reaches from the Cleric, in feet. */
export const PRESERVE_LIFE_FEET = 30;

/** A creature Preserve Life is asked to restore Hit Points to. */
export interface LifeShare {
  name: string;
  /** Null for a creature that tracks no Hit Points. */
  hp: Pick<HitPoints, 'current' | 'max'> | null;
  amount: number;
}

/**
 * Preserve Life divided as asked: what each creature regains, no more than
 * takes it to half its Hit Point maximum. Refused when the shares add up to
 * more than the pool, a creature is not Bloodied (above half its maximum), or
 * no one would regain anything.
 */
export function preserveLife(pool: number, shares: readonly LifeShare[]): { restored: number[] } | { error: string } {
  const asked = shares.reduce((sum, share) => sum + share.amount, 0);
  if (asked > pool) return { error: `Preserve Life restores ${pool} Hit Points at most, and ${asked} were asked for` };
  const restored: number[] = [];
  for (const share of shares) {
    if (!share.hp) return { error: `${share.name} tracks no Hit Points` };
    if (share.hp.current * 2 > share.hp.max) return { error: `${share.name} is not Bloodied` };
    restored.push(Math.max(0, Math.min(share.amount, Math.floor(share.hp.max / 2) - share.hp.current)));
  }
  if (restored.every((amount) => amount === 0)) return { error: 'Preserve Life restores a creature to no more than half its Hit Point maximum' };
  return { restored };
}
