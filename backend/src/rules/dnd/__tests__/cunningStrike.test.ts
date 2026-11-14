/**
 * Cunning Strike: its save DC and the Poisoner's Kit the Poison effect needs.
 */

import { cunningStrikeDC, hasPoisonersKit } from '../cunningStrike';

describe('Cunning Strike', () => {
  it('sets its DC at 8 + Dexterity modifier + Proficiency Bonus', () => {
    expect(cunningStrikeDC({ proficiencyBonus: 3, stats: { dexterity: { score: 18, modifier: 4 } } })).toBe(15);
  });

  it('finds a Poisoner’s Kit in the inventory, however its apostrophe is written', () => {
    expect(hasPoisonersKit({ inventory: [{ name: "Poisoner's Kit" }] })).toBe(true);
    expect(hasPoisonersKit({ inventory: [{ name: 'Poisoner’s Kit' }] })).toBe(true);
    expect(hasPoisonersKit({ inventory: [{ name: 'Thieves’ Tools' }] })).toBe(false);
    expect(hasPoisonersKit({})).toBe(false);
  });
});
