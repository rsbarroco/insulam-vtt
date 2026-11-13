/**
 * Deflect Attacks: the reduction a Monk's reaction makes, and the Monk level it reads.
 */

import { deflectReduction, monkLevel } from '../reactions';

describe('Deflect Attacks', () => {
  it('takes 1d10 + Dexterity modifier + Monk level off a Bludgeoning, Piercing or Slashing hit', () => {
    const monk = { class: 'Monk', level: 5, stats: { dexterity: { score: 16, modifier: 3 } } };
    expect(deflectReduction(monk)).toEqual({
      label: 'Deflect Attacks',
      roll: { count: 1, sides: 10, bonus: 8 },
      types: ['bludgeoning', 'piercing', 'slashing'],
    });
  });

  it('reads the Monk level of a gestalt character, and none for another class', () => {
    expect(monkLevel({ class: 'Fighter / Monk', level: 7 })).toBe(7);
    expect(monkLevel({ class: 'Rogue', level: 7 })).toBe(0);
  });
});
