/**
 * Monk features past the basics: the Martial Arts die, the numbers of the
 * Deflect Attacks redirect, Slow Fall, Wholeness of Body, Self-Restoration and
 * Heightened Focus.
 */

import {
  flurryStrikes,
  martialArtsDie,
  redirectDamage,
  selfRestorable,
  slowFallReduction,
  wholenessOfBodyHealing,
} from '../monk';

const monk = (level: number, extra: Record<string, unknown> = {}) => ({
  class: 'Monk',
  level,
  stats: { dexterity: { score: 16, modifier: 3 }, wisdom: { score: 14, modifier: 2 } },
  ...extra,
});

describe('the Martial Arts die', () => {
  it('follows the Monk table: d6, d8 from 5, d10 from 11, d12 from 17', () => {
    expect([1, 4, 5, 10, 11, 16, 17, 20].map((level) => martialArtsDie(monk(level)))).toEqual([6, 6, 8, 8, 10, 10, 12, 12]);
  });

  it('is a d6 for a sheet with no Monk levels, and reads a gestalt Monk at its level', () => {
    expect(martialArtsDie({ class: 'Fighter', level: 20 })).toBe(6);
    expect(martialArtsDie({ class: 'Fighter / Monk', level: 11 })).toBe(10);
  });
});

describe('the numbers of the features', () => {
  it('redirects an attack for two Martial Arts dice + Dexterity modifier', () => {
    expect(redirectDamage(monk(3))).toEqual({ count: 2, sides: 6, bonus: 3 });
    expect(redirectDamage(monk(11))).toEqual({ count: 2, sides: 10, bonus: 3 });
  });

  it('takes five times the Monk level off a fall', () => {
    expect(slowFallReduction(monk(4))).toBe(20);
    expect(slowFallReduction({ class: 'Rogue', level: 4 })).toBe(0);
  });

  it('heals the roll + Wisdom modifier with Wholeness of Body, at least 1', () => {
    expect(wholenessOfBodyHealing(monk(6), 5)).toBe(7);
    expect(wholenessOfBodyHealing(monk(6, { stats: { wisdom: { score: 6, modifier: -2 } } }), 1)).toBe(1);
  });

  it('gives Flurry of Blows two strikes, three with Heightened Focus', () => {
    expect([flurryStrikes(false), flurryStrikes(true)]).toEqual([2, 3]);
  });
});

describe('Self-Restoration', () => {
  it('names the conditions it can end, in the order of the rule, whatever their case', () => {
    expect(selfRestorable(['Prone', 'poisoned', 'Charmed'])).toEqual(['Charmed', 'Poisoned']);
    expect(selfRestorable(['Stunned'])).toEqual([]);
  });
});
