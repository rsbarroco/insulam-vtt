/**
 * Aura of Protection: what it adds to saves, how far it reaches and the
 * conditions it keeps off.
 */

import { auraFeet, auraImmunities, auraOfProtectionBonus } from '../auras';

describe('Aura of Protection', () => {
  it('adds the Charisma modifier, at least 1, and nothing without the feature', () => {
    const paladin = (modifier: number) => ({ featuresAndTraits: [{ name: 'Aura of Protection' }], stats: { charisma: { score: 10 + 2 * modifier, modifier } } });
    expect(auraOfProtectionBonus(paladin(4))).toBe(4);
    expect(auraOfProtectionBonus(paladin(-1))).toBe(1);
    expect(auraOfProtectionBonus({ stats: { charisma: { score: 18, modifier: 4 } } })).toBe(0);
    expect(auraOfProtectionBonus(null)).toBe(0);
  });
});

describe('The aura', () => {
  const sheet = (...names: string[]) => ({ featuresAndTraits: names.map((name) => ({ name })) });

  it('reaches 10 feet, 30 with Aura Expansion', () => {
    expect(auraFeet(sheet('Aura of Protection'))).toBe(10);
    expect(auraFeet(sheet('Aura of Protection', 'Aura Expansion (Paladin 18)'))).toBe(30);
    expect(auraFeet(null)).toBe(10);
  });

  it('keeps Frightened off with Aura of Courage and Charmed off with Aura of Devotion', () => {
    expect(auraImmunities(sheet('Aura of Courage (Paladin 10)'))).toEqual([{ condition: 'frightened', feature: 'Aura of Courage' }]);
    expect(auraImmunities(sheet('Aura of Courage', 'Aura of Devotion (Oath of Devotion 7)')).map((kept) => kept.condition)).toEqual(['frightened', 'charmed']);
    expect(auraImmunities(sheet('Aura of Protection'))).toEqual([]);
    expect(auraImmunities(null)).toEqual([]);
  });
});
