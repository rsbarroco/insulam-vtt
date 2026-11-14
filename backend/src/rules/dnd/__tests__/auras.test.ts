/**
 * Aura of Protection: what it adds to saves.
 */

import { auraOfProtectionBonus } from '../auras';

describe('Aura of Protection', () => {
  it('adds the Charisma modifier, at least 1, and nothing without the feature', () => {
    const paladin = (modifier: number) => ({ featuresAndTraits: [{ name: 'Aura of Protection' }], stats: { charisma: { score: 10 + 2 * modifier, modifier } } });
    expect(auraOfProtectionBonus(paladin(4))).toBe(4);
    expect(auraOfProtectionBonus(paladin(-1))).toBe(1);
    expect(auraOfProtectionBonus({ stats: { charisma: { score: 18, modifier: 4 } } })).toBe(0);
    expect(auraOfProtectionBonus(null)).toBe(0);
  });
});
