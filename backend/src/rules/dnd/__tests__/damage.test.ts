import {
  adjustedDamage,
  applyDamage,
  applyHealing,
  concentrationDC,
  grantTempHp,
  halfDamage,
  rollDamage,
  type HitPoints,
} from '../damage';
import type { RollDie } from '../d20';

const dice = (...values: number[]): RollDie => {
  let next = 0;
  return () => values[next++];
};
const hp = (current: number, max = 20, temp = 0): HitPoints => ({ current, max, temp });

describe('adjustedDamage', () => {
  it('passes damage through with no defences', () => {
    expect(adjustedDamage({ amount: 9, type: 'fire' }, {})).toBe(9);
  });

  it('halves with Resistance, rounding down', () => {
    expect(adjustedDamage({ amount: 9, type: 'fire' }, { resistances: ['fire'] })).toBe(4);
  });

  it('doubles with Vulnerability', () => {
    expect(adjustedDamage({ amount: 9, type: 'fire' }, { vulnerabilities: ['fire'] })).toBe(18);
  });

  it('takes none with Immunity, whatever else it has', () => {
    expect(adjustedDamage({ amount: 9, type: 'fire' }, { immunities: ['fire'], vulnerabilities: ['fire'] })).toBe(0);
  });

  it('halves before doubling when it has both', () => {
    expect(adjustedDamage({ amount: 9, type: 'fire' }, { resistances: ['fire'], vulnerabilities: ['fire'] })).toBe(8);
  });

  it('leaves other types alone', () => {
    expect(adjustedDamage({ amount: 9, type: 'cold' }, { resistances: ['fire'], immunities: ['poison'] })).toBe(9);
  });
});

describe('applyDamage', () => {
  it('takes damage from hit points', () => {
    const outcome = applyDamage(hp(20), [{ amount: 7, type: 'slashing' }]);
    expect(outcome.hp).toEqual(hp(13));
    expect(outcome).toMatchObject({ dealt: 7, absorbed: 0, dropped: false, instantDeath: false });
  });

  it('adjusts each instance by its own type', () => {
    const outcome = applyDamage(hp(20), [{ amount: 6, type: 'slashing' }, { amount: 6, type: 'fire' }], { resistances: ['fire'] });
    expect(outcome.dealt).toBe(9);
    expect(outcome.hp.current).toBe(11);
  });

  it('loses Temporary Hit Points first', () => {
    const outcome = applyDamage(hp(20, 20, 5), [{ amount: 8, type: 'force' }]);
    expect(outcome.hp).toEqual(hp(17, 20, 0));
    expect(outcome.absorbed).toBe(5);
  });

  it('stops at 0 and says the creature dropped', () => {
    const outcome = applyDamage(hp(4), [{ amount: 10, type: 'piercing' }]);
    expect(outcome.hp.current).toBe(0);
    expect(outcome.dropped).toBe(true);
    expect(outcome.instantDeath).toBe(false);
  });

  it('kills outright when the damage left over at 0 reaches the maximum', () => {
    expect(applyDamage(hp(4, 20), [{ amount: 23, type: 'force' }]).instantDeath).toBe(false);
    expect(applyDamage(hp(4, 20), [{ amount: 24, type: 'force' }]).instantDeath).toBe(true);
  });

  it('does not say a creature already at 0 dropped again', () => {
    const outcome = applyDamage(hp(0), [{ amount: 3, type: 'force' }]);
    expect(outcome.dropped).toBe(false);
  });

  it('does not change the hit points it was given', () => {
    const before = hp(20, 20, 3);
    applyDamage(before, [{ amount: 9, type: 'cold' }]);
    expect(before).toEqual(hp(20, 20, 3));
  });
});

describe('healing and temporary hit points', () => {
  it('heals up to the maximum and no further', () => {
    expect(applyHealing(hp(5), 8).current).toBe(13);
    expect(applyHealing(hp(15), 80).current).toBe(20);
  });

  it('keeps the larger of the Temporary Hit Points it has and is given', () => {
    expect(grantTempHp(hp(10, 20, 4), 7).temp).toBe(7);
    expect(grantTempHp(hp(10, 20, 9), 7).temp).toBe(9);
  });
});

describe('rollDamage', () => {
  it('rolls the dice and adds the bonus', () => {
    expect(rollDamage({ count: 2, sides: 6, bonus: 3 }, false, dice(4, 5))).toEqual({ dice: [4, 5], bonus: 3, total: 12 });
  });

  it('rolls the dice twice on a Critical Hit and adds the bonus once', () => {
    const rolled = rollDamage({ count: 2, sides: 6, bonus: 3 }, true, dice(4, 5, 1, 6));
    expect(rolled.dice).toEqual([4, 5, 1, 6]);
    expect(rolled.total).toBe(19);
  });

  it('is never below 0', () => {
    expect(rollDamage({ count: 1, sides: 4, bonus: -5 }, false, dice(1)).total).toBe(0);
  });
});

describe('halfDamage and concentrationDC', () => {
  it('halves rounding down', () => {
    expect(halfDamage(15)).toBe(7);
  });

  it('asks for DC 10 or half the damage, whichever is higher, to at most 30', () => {
    expect(concentrationDC(7)).toBe(10);
    expect(concentrationDC(21)).toBe(10);
    expect(concentrationDC(26)).toBe(13);
    expect(concentrationDC(500)).toBe(30);
  });
});
