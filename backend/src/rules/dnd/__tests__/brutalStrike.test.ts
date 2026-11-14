/**
 * Brutal Strike: its extra die by Barbarian level.
 */

import { brutalStrikeDamage } from '../brutalStrike';

describe('Brutal Strike', () => {
  it('deals an extra 1d10 of the weapon’s type, 2d10 from Barbarian 17', () => {
    expect(brutalStrikeDamage({ class: 'Barbarian', level: 9 }, 'slashing')).toEqual({ roll: { count: 1, sides: 10 }, type: 'slashing' });
    expect(brutalStrikeDamage({ class: 'Barbarian / Rogue', level: 17 }, 'piercing')).toEqual({ roll: { count: 2, sides: 10 }, type: 'piercing' });
  });
});
