/**
 * Metamagic chosen as a spell is cast: which options a sheet knows, Careful
 * Spell's count and Distant Spell's range.
 */

import { carefulCount, distantAction, empoweredCount, knowsMetamagic } from '../metamagic';
import { rerollLowest } from '../damage';
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

  it('knows the options asked after the roll, and rerolls as many dice as the Charisma modifier', () => {
    const sheet = { featuresAndTraits: [{ name: 'Empowered Spell' }, { name: 'Seeking Spell' }] };
    expect(knowsMetamagic(sheet, 'empowered')).toBe(true);
    expect(knowsMetamagic(sheet, 'seeking')).toBe(true);
    expect(empoweredCount({ stats: { charisma: { score: 18, modifier: 4 } } })).toBe(4);
    expect(empoweredCount({})).toBe(1);
  });

  it('rerolls the lowest dice across the damage lines', () => {
    const next = [9, 8];
    const rerolled = rerollLowest(
      [
        { dice: [1, 6], bonus: 2, total: 9 },
        { dice: [2], bonus: 0, total: 2 },
      ],
      [6, 4],
      2,
      () => next.shift()!
    );
    expect(rerolled).toEqual([
      { dice: [9, 6], bonus: 2, total: 17 },
      { dice: [8], bonus: 0, total: 8 },
    ]);
  });
});
