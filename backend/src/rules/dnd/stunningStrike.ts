// ============================================
// Stunning Strike (Monk 5), by the D&D rules (SRD 5.2.1)
//
// Once per turn, when the Monk hits with a Monk weapon or an Unarmed Strike,
// it can spend 1 Focus Point: the target makes a Constitution save against
// 8 + the Monk's Wisdom modifier + Proficiency Bonus. On a failure it is
// Stunned until the start of the Monk's next turn; on a success its Speed is
// halved until then, and the next attack roll against it has Advantage.
// ============================================

import type { CombatAction } from './actions';
import { abilityModifier } from './resources';
import { findSrdWeapon } from '../../utils/srdWeapons';

type Sheet = Record<string, unknown>;

/** The Monk's save DC: 8 + Wisdom modifier + Proficiency Bonus. */
export function monkSaveDC(sheet: Sheet): number {
  const proficiency = typeof sheet.proficiencyBonus === 'number' ? sheet.proficiencyBonus : 2;
  return 8 + abilityModifier(sheet, 'wisdom') + proficiency;
}

/** Whether an attack is with a Monk weapon (a Simple Melee weapon, or a Martial Melee one with Light) or an Unarmed Strike. */
export function isMonkAttack(action: CombatAction): boolean {
  if (action.source === 'spell') return false;
  if (action.unarmed === 'damage') return true;
  const weapon = findSrdWeapon(action.weapon ?? action.name);
  if (!weapon || weapon.kind !== 'melee') return false;
  return weapon.category === 'simple' || weapon.properties.some((property) => /^light$/i.test(property));
}
