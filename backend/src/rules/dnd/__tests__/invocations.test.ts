/**
 * A Warlock's Eldritch Blast beams, and the invocations that change its cantrips.
 */

import { eldritchBlastBeams, invocationCantrips, repels, withInvocations } from '../invocations';
import type { CombatAction } from '../actions';

const blast: CombatAction = {
  name: 'Eldritch Blast',
  cost: 'action',
  source: 'spell',
  spell: { id: 'eldritch-blast', level: 0 },
  attack: { kind: 'ranged', bonus: 6, rangeFeet: { normal: 120, long: 120 }, damage: [{ roll: { count: 1, sides: 10 }, type: 'force' }] },
};
const warlock = (features: string[], level = 5) => ({
  level,
  stats: { charisma: { score: 16, modifier: 3 } },
  featuresAndTraits: features.map((name) => ({ name })),
});

describe('Warlock invocations', () => {
  it('makes more Eldritch Blast beams at levels 5, 11 and 17', () => {
    expect([1, 5, 11, 17].map(eldritchBlastBeams)).toEqual([1, 2, 3, 4]);
  });

  it('reads the cantrip an invocation names, Eldritch Blast when it names none or a class and level', () => {
    expect(invocationCantrips(warlock(['Agonizing Blast (Eldritch Blast)', 'Agonizing Blast (Warlock 2)']), 'Agonizing Blast')).toEqual([
      'eldritch blast',
      'eldritch blast',
    ]);
    expect(invocationCantrips(warlock(['Agonizing Blast (Toll the Dead)']), 'Agonizing Blast')).toEqual(['toll the dead']);
    expect(invocationCantrips(warlock(['Repelling Blast']), 'Agonizing Blast')).toEqual([]);
  });

  it('adds the Charisma modifier with Agonizing Blast, and counts the beams', () => {
    const [changed] = withInvocations(warlock(['Agonizing Blast']), [blast]);
    expect(changed.attack!.damage[0].roll).toEqual({ count: 1, sides: 10, bonus: 3 });
    expect(changed.beams).toBe(2);
    expect(withInvocations(warlock([]), [blast])[0].attack!.damage[0].roll.bonus).toBeUndefined();
  });

  it('pushes with Repelling Blast only for the cantrip it names', () => {
    expect(repels(warlock(['Repelling Blast']), blast)).toBe(true);
    expect(repels(warlock([]), blast)).toBe(false);
    expect(repels(warlock(['Repelling Blast']), { ...blast, name: 'Fire Bolt' })).toBe(false);
  });
});
