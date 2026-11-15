// ============================================
// A Sorcerer's Metamagic chosen as a spell is cast, by the D&D rules (SRD 5.2.1)
//
//   • Careful Spell (1 Sorcery Point): up to the Charisma modifier (at least
//     one) of the creatures making the spell's save succeed on it, and take
//     no damage where they would take half.
//   • Distant Spell (1): the spell's range doubles; Touch becomes 30 feet.
//   • Heightened Spell (2): one target has Disadvantage on its save.
//   • Quickened Spell (2): a spell with a casting time of an action is cast
//     as a Bonus Action.
//
// The ones chosen once a roll is known (Empowered Spell, Seeking Spell) are
// asked of the Sorcerer's player after the roll.
// ============================================

import type { CombatAction } from './actions';
import { hasFeature, readFeatures } from './featureEffects';
import { abilityModifier } from './resources';

type Sheet = Record<string, unknown>;

export type CastingMetamagic = 'careful' | 'distant' | 'heightened' | 'quickened';

export const METAMAGIC: Readonly<Record<CastingMetamagic, { name: string; cost: number }>> = {
  careful: { name: 'Careful Spell', cost: 1 },
  distant: { name: 'Distant Spell', cost: 1 },
  heightened: { name: 'Heightened Spell', cost: 2 },
  quickened: { name: 'Quickened Spell', cost: 2 },
};

/** Whether the sheet knows a Metamagic option: a feature of its name ("Metamagic: Careful Spell" counts). */
export function knowsMetamagic(sheet: Sheet, option: CastingMetamagic): boolean {
  const name = METAMAGIC[option].name;
  const features = readFeatures(sheet);
  return hasFeature(features, name) || features.some((feature) => new RegExp(`\\b${name}\\b`, 'i').test(feature.name));
}

/** How many creatures Careful Spell protects: the Charisma modifier, at least one. */
export function carefulCount(sheet: Sheet): number {
  return Math.max(1, abilityModifier(sheet, 'charisma'));
}

/** A spell with Distant Spell: its range doubled, or 30 feet for a spell of Touch range. Null for a spell of Self range. */
export function distantAction(action: CombatAction): CombatAction | null {
  const range = action.rangeFeet;
  const doubled = range === undefined ? undefined : range <= 5 ? (range === 0 ? null : 30) : range * 2;
  if (doubled === null) return null;
  const attack = action.attack?.rangeFeet
    ? { ...action.attack, rangeFeet: { normal: action.attack.rangeFeet.normal * 2, long: action.attack.rangeFeet.long === null ? null : action.attack.rangeFeet.long * 2 } }
    : action.attack?.kind === 'melee' && action.attack.reachFeet !== undefined
      ? { ...action.attack, reachFeet: Math.max(30, action.attack.reachFeet) }
      : action.attack;
  return { ...action, ...(doubled !== undefined ? { rangeFeet: doubled } : {}), ...(attack ? { attack } : {}) };
}
