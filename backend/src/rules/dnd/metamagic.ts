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
//   • Transmuted Spell (1): a spell's Acid, Cold, Fire, Lightning, Poison or
//     Thunder damage becomes another of those types.
//
// Chosen once a roll is known, and asked of the Sorcerer's player then:
//
//   • Empowered Spell (1): the spell's lowest damage dice, up to the Charisma
//     modifier (at least one), are rolled again; the new rolls stand.
//   • Seeking Spell (1): a missed spell attack roll is rolled again.
//
// Both can join another Metamagic option on the same casting.
// ============================================

import type { CombatAction, DamageComponent } from './actions';
import type { DamageType } from './damage';
import { hasFeature, readFeatures } from './featureEffects';
import { abilityModifier } from './resources';

type Sheet = Record<string, unknown>;

export type CastingMetamagic = 'careful' | 'distant' | 'heightened' | 'quickened' | 'transmuted';

export const METAMAGIC: Readonly<Record<CastingMetamagic, { name: string; cost: number }>> = {
  careful: { name: 'Careful Spell', cost: 1 },
  distant: { name: 'Distant Spell', cost: 1 },
  heightened: { name: 'Heightened Spell', cost: 2 },
  quickened: { name: 'Quickened Spell', cost: 2 },
  transmuted: { name: 'Transmuted Spell', cost: 1 },
};

/** The damage types Transmuted Spell changes between. */
export const TRANSMUTED_TYPES = ['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder'] as const satisfies readonly DamageType[];
export type TransmutedType = (typeof TRANSMUTED_TYPES)[number];

/** The Metamagic options chosen once a roll is known, each for 1 Sorcery Point. */
export type AfterRollMetamagic = 'empowered' | 'seeking';

export const AFTER_ROLL_METAMAGIC: Readonly<Record<AfterRollMetamagic, { name: string; cost: number }>> = {
  empowered: { name: 'Empowered Spell', cost: 1 },
  seeking: { name: 'Seeking Spell', cost: 1 },
};

/** How many damage dice Empowered Spell rerolls: the Charisma modifier, at least one. */
export function empoweredCount(sheet: Sheet): number {
  return Math.max(1, abilityModifier(sheet, 'charisma'));
}

/** Whether the sheet knows a Metamagic option: a feature of its name ("Metamagic: Careful Spell" counts). */
export function knowsMetamagic(sheet: Sheet, option: CastingMetamagic | AfterRollMetamagic): boolean {
  const name = option in METAMAGIC ? METAMAGIC[option as CastingMetamagic].name : AFTER_ROLL_METAMAGIC[option as AfterRollMetamagic].name;
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

/** A spell with Transmuted Spell: its damage of the listed types dealt as `to`. Null for a spell that deals none of them, or only `to`. */
export function transmutedAction(action: CombatAction, to: TransmutedType): CombatAction | null {
  const listed = (type: DamageType | null) => type !== null && type !== to && (TRANSMUTED_TYPES as readonly DamageType[]).includes(type);
  const change = (damage: readonly DamageComponent[]) => damage.map((part) => (listed(part.type) ? { ...part, type: to } : part));
  const dealt = [...(action.attack?.damage ?? []), ...(action.save?.damage ?? [])];
  if (!dealt.some((part) => listed(part.type))) return null;
  return {
    ...action,
    ...(action.attack ? { attack: { ...action.attack, damage: change(action.attack.damage) } } : {}),
    ...(action.save ? { save: { ...action.save, damage: change(action.save.damage) } } : {}),
  };
}
