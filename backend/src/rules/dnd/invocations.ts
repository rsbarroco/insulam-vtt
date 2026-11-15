// ============================================
// A Warlock's damage cantrips and the invocations that change them, by the
// D&D rules (SRD 5.2.1)
//
//   • Eldritch Blast makes two beams at level 5, three at 11 and four at 17:
//     a separate attack roll each, at one target or several.
//   • Agonizing Blast: a Warlock cantrip that deals damage adds the Charisma
//     modifier to its damage rolls. The sheet names the cantrip in brackets,
//     "Agonizing Blast (Eldritch Blast)"; Eldritch Blast when it names none.
//   • Repelling Blast: a hit with a Warlock cantrip that makes an attack roll
//     can push a Large or smaller creature up to 10 feet straight away.
// ============================================

import type { CombatAction } from './actions';
import { abilityModifier } from './resources';

type Sheet = Record<string, unknown>;

const DEFAULT_CANTRIP = 'Eldritch Blast';

/** How many beams Eldritch Blast makes for a character of this level. */
export function eldritchBlastBeams(level: number): number {
  return 1 + (level >= 5 ? 1 : 0) + (level >= 11 ? 1 : 0) + (level >= 17 ? 1 : 0);
}

const plain = (name: string) => name.trim().toLowerCase().replace(/[’']/g, "'");

/** The cantrips a sheet's invocation of this name applies to: each one written in brackets, or Eldritch Blast. */
export function invocationCantrips(sheet: Sheet, invocation: string): string[] {
  const list = Array.isArray(sheet.featuresAndTraits) ? sheet.featuresAndTraits : [];
  const pattern = new RegExp(`^${invocation}(?:\\s*\\(([^)]+)\\))?\\s*$`, 'i');
  return list.flatMap((entry) => {
    const name = typeof entry === 'string' ? entry : (entry as { name?: unknown })?.name;
    if (typeof name !== 'string') return [];
    const found = pattern.exec(name.trim());
    if (!found) return [];
    // A bracket that names a class and level ("Warlock 2") names no cantrip.
    const named = found[1] && !/\d/.test(found[1]) ? found[1] : DEFAULT_CANTRIP;
    return [plain(named)];
  });
}

/**
 * A sheet's spell actions as its Warlock invocations change them: Agonizing
 * Blast adds the Charisma modifier to the chosen cantrip's damage, and Eldritch
 * Blast makes as many beams as the character's level gives.
 */
export function withInvocations(sheet: Sheet, actions: readonly CombatAction[]): CombatAction[] {
  const agonizing = invocationCantrips(sheet, 'Agonizing Blast');
  const charisma = abilityModifier(sheet, 'charisma');
  const level = typeof sheet.level === 'number' ? sheet.level : 1;
  return actions.map((action) => {
    if (action.spell?.level !== 0) return action;
    let changed = action;
    if (plain(action.name) === plain(DEFAULT_CANTRIP)) changed = { ...changed, beams: eldritchBlastBeams(level) };
    if (agonizing.includes(plain(action.name)) && charisma !== 0) {
      const add = (damage: NonNullable<CombatAction['attack']>['damage']) =>
        damage.map((line, index) => (index === 0 ? { ...line, roll: { ...line.roll, bonus: (line.roll.bonus ?? 0) + charisma } } : line));
      if (changed.attack) changed = { ...changed, attack: { ...changed.attack, damage: add(changed.attack.damage) } };
      if (changed.save) changed = { ...changed, save: { ...changed.save, damage: add(changed.save.damage) } };
    }
    return changed;
  });
}

/** Whether a hit with this action can push its target with Repelling Blast. */
export function repels(sheet: Sheet, action: CombatAction): boolean {
  return action.spell?.level === 0 && action.attack !== undefined && invocationCantrips(sheet, 'Repelling Blast').includes(plain(action.name));
}
