// ============================================
// A Paladin's features the server resolves, by the D&D rules (SRD 5.2.1)
//
//   • Abjure Foes (Paladin 9): a Magic action and a use of Channel Divinity.
//     As many creatures as the Charisma modifier (at least one) within 60
//     feet make a Wisdom save against the Paladin's spell save DC, or are
//     Frightened for 1 minute or until they take damage.
//   • Sacred Weapon (Oath of Devotion 3): with the Attack action, a use of
//     Channel Divinity imbues one Melee weapon for 10 minutes: the Charisma
//     modifier (at least +1) is added to attack rolls with it, and each hit
//     with it deals the weapon's own damage type or Radiant.
//   • Radiant Strikes (Paladin 11): a hit with a Melee weapon or an Unarmed
//     Strike deals an extra 1d8 Radiant damage.
//   • Restoring Touch (Paladin 14): Lay on Hands also ends Blinded, Charmed,
//     Deafened, Frightened, Paralyzed or Stunned, 5 points of the pool each.
//   • Paladin's Smite (Paladin 2): Divine Smite cast once without a spell
//     slot, back on a Long Rest.
//
// Pure: a sheet in, what the feature gives out.
// ============================================

import type { CombatAction, DamageComponent } from './actions';
import { hasFeature, readFeatures } from './featureEffects';
import { abilityModifier, classLevel, resourcesOf } from './resources';

type Sheet = Record<string, unknown>;

/** The Paladin's spell save DC: the sheet's, or 8 + Charisma modifier + Proficiency Bonus. */
function spellSaveDC(sheet: Sheet): number {
  const written = (sheet.spellcasting as { spellSaveDC?: unknown } | null | undefined)?.spellSaveDC;
  if (typeof written === 'number') return written;
  const proficiency = typeof sheet.proficiencyBonus === 'number' ? sheet.proficiencyBonus : 2;
  return 8 + abilityModifier(sheet, 'charisma') + proficiency;
}

/** How long Abjure Foes lasts, in the Paladin's turns: 1 minute. */
export const ABJURE_FOES_TURNS = 10;

/** How many creatures Abjure Foes can choose: the Charisma modifier, at least one. */
export function abjureFoesTargets(sheet: Sheet): number {
  return Math.max(1, abilityModifier(sheet, 'charisma'));
}

/** The ways a Paladin's sheet can use Channel Divinity as an action of its own now: none without a use left. */
export function paladinChannelActions(sheet: Sheet): CombatAction[] {
  if (classLevel(sheet, 'Paladin') < 9 || !hasFeature(readFeatures(sheet), 'Abjure Foes')) return [];
  const uses = resourcesOf(sheet).find((entry) => entry.name === 'Channel Divinity');
  if (!uses || uses.used >= uses.max) return [];
  const targets = abjureFoesTargets(sheet);
  return [
    {
      name: 'Abjure Foes',
      cost: 'action',
      source: 'sheet',
      rangeFeet: 60,
      channel: 'Channel Divinity',
      text: 'Channel Divinity: as many creatures as your Charisma modifier (at least one) that you can see within 60 feet make a Wisdom save or are Frightened for 1 minute, or until they take damage. While Frightened this way, a creature can only move, take an action or take a Bonus Action on its turn.',
      maxTargets: targets,
      untilDamaged: ['Frightened'],
      save: { ability: 'wis', dc: spellSaveDC(sheet), halfOnSuccess: false, damage: [] },
    },
  ];
}

/** How long Sacred Weapon lasts, in milliseconds: 10 minutes. */
export const SACRED_WEAPON_MS = 10 * 60 * 1000;

/** Whether a sheet has Sacred Weapon. */
export function hasSacredWeapon(sheet: Sheet | null): boolean {
  return sheet !== null && hasFeature(readFeatures(sheet), 'Sacred Weapon');
}

/** Whether an action is an attack with a Melee weapon, which Sacred Weapon can imbue: not a spell, not an Unarmed Strike. */
export function canBeSacred(action: CombatAction): boolean {
  return action.source === 'sheet' && !action.unarmed && action.attack?.kind === 'melee';
}

/** What Sacred Weapon adds to attack rolls with the weapon: the Charisma modifier, at least 1. */
export function sacredWeaponBonus(sheet: Sheet): number {
  return Math.max(1, abilityModifier(sheet, 'charisma'));
}

/** An attack with its attack bonus raised by Sacred Weapon and, when asked, its damage dealt as Radiant. */
export function withSacredWeapon(action: CombatAction, bonus: number, radiant: boolean): CombatAction {
  if (!action.attack) return action;
  return {
    ...action,
    attack: {
      ...action.attack,
      bonus: action.attack.bonus + bonus,
      damage: radiant ? action.attack.damage.map((part) => ({ ...part, type: 'radiant' as const })) : action.attack.damage,
    },
  };
}

/** The extra damage of Radiant Strikes on a hit with a Melee weapon or an Unarmed Strike; null without the feature or with another attack. */
export function radiantStrikes(sheet: Sheet | null, action: CombatAction): DamageComponent | null {
  if (!sheet || !hasFeature(readFeatures(sheet), 'Radiant Strikes')) return null;
  if (action.source === 'spell') return null;
  if (action.unarmed !== 'damage' && action.attack?.kind !== 'melee') return null;
  return { roll: { count: 1, sides: 8 }, type: 'radiant' };
}

/** The conditions Restoring Touch lets Lay on Hands end, 5 points each. */
export const RESTORING_TOUCH = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Paralyzed', 'Stunned'] as const;

/** What Lay on Hands spends to end one condition. */
export const CURE_COST = 5;

/** The conditions a sheet's Lay on Hands can end: Poisoned, and those of Restoring Touch with it. */
export function layOnHandsCures(sheet: Sheet | null): string[] {
  return ['Poisoned', ...(sheet && hasFeature(readFeatures(sheet), 'Restoring Touch') ? RESTORING_TOUCH : [])];
}
