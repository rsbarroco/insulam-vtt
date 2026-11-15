/**
 * Metamagic chosen as a spell is cast: which options a sheet knows, Careful
 * Spell's count and Distant Spell's range.
 */

import { carefulCount, distantAction, knowsMetamagic } from '../metamagic';
import type { CombatAction } from '../actions';

describe('Metamagic', () => {
  it('is known from the sheet’s features, however the option is listed', () => {
    const sheet = { featuresAndTraits: [{ name: 'Metamagic: Careful Spell' }, { name: 'Quickened Spell (Sorcerer 2)' }] };
    expect(knowsMetamagic(sheet, 'careful')).toBe(true);
    expect(knowsMetamagic(sheet, 'quickened')).toBe(true);
    expect(knowsMetamagic(sheet, 'heightened')).toBe(false);
  });

  it('protects as many creatures as the Charisma modifier with Careful Spell, at least one', () => {
    expect(carefulCount({ stats: { charisma: { score: 18, modifier: 4 } } })).toBe(4);
    expect(carefulCount({ stats: { charisma: { score: 8, modifier: -1 } } })).toBe(1);
  });

  it('doubles a range with Distant Spell, makes Touch 30 feet, and leaves Self alone', () => {
    const fireball = { name: 'Fireball', cost: 'action', source: 'spell', rangeFeet: 150 } as CombatAction;
    expect(distantAction(fireball)?.rangeFeet).toBe(300);
    expect(distantAction({ ...fireball, rangeFeet: 5 })?.rangeFeet).toBe(30);
    expect(distantAction({ ...fireball, rangeFeet: 0 })).toBeNull();
    const bolt = {
      ...fireball,
      attack: { kind: 'ranged', bonus: 5, rangeFeet: { normal: 120, long: null }, damage: [] },
    } as unknown as CombatAction;
    expect(distantAction(bolt)?.attack?.rangeFeet).toEqual({ normal: 240, long: null });
  });
});
