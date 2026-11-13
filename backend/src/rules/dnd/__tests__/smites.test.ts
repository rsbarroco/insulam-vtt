/**
 * Divine Smite: its dice by slot level and target, who has it, and what it follows.
 */

import { canSmiteWith, divineSmiteDamage, fiendOrUndead, hasDivineSmite } from '../smites';
import type { CombatAction } from '../actions';

describe('Divine Smite', () => {
  it('deals 2d8 Radiant, 1d8 more for each slot level above 1 and against a Fiend or Undead', () => {
    expect(divineSmiteDamage(1)).toEqual({ roll: { count: 2, sides: 8 }, type: 'radiant' });
    expect(divineSmiteDamage(3, 'Large Giant')).toEqual({ roll: { count: 4, sides: 8 }, type: 'radiant' });
    expect(divineSmiteDamage(2, 'Medium Undead')).toEqual({ roll: { count: 4, sides: 8 }, type: 'radiant' });
    expect(fiendOrUndead('Large Fiend (Devil)')).toBe(true);
    expect(fiendOrUndead(null)).toBe(false);
  });

  it('is had by a sheet with the spell prepared, or with Paladin’s Smite', () => {
    expect(hasDivineSmite({ spellcasting: { spells: [{ name: 'Divine Smite', level: 1, prepared: true }] } })).toBe(true);
    expect(hasDivineSmite({ spellcasting: { spells: [{ name: 'Divine Smite', level: 1, prepared: false }] } })).toBe(false);
    expect(hasDivineSmite({ featuresAndTraits: [{ name: 'Paladin’s Smite (Paladin 2)' }] })).toBe(true);
    expect(hasDivineSmite({ featuresAndTraits: ["Paladin's Smite"] })).toBe(true);
    expect(hasDivineSmite({})).toBe(false);
  });

  it('follows a Melee weapon attack or an Unarmed Strike, not a spell or a ranged weapon', () => {
    const melee = { name: 'Longsword', cost: 'action', source: 'sheet', attack: { kind: 'melee' } } as CombatAction;
    expect(canSmiteWith(melee)).toBe(true);
    expect(canSmiteWith({ ...melee, attack: { ...melee.attack!, kind: 'ranged' } } as CombatAction)).toBe(false);
    expect(canSmiteWith({ ...melee, source: 'spell' })).toBe(false);
    expect(canSmiteWith({ name: 'Unarmed Strike', cost: 'action', source: 'sheet', unarmed: 'damage' } as CombatAction)).toBe(true);
  });
});
