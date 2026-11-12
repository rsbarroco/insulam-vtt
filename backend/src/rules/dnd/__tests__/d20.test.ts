import { abilityCheck, attackRoll, coverBonus, rollD20, rollDie, rollMode, savingThrow, type RollDie } from '../d20';

/** A die that gives these numbers in turn. */
const dice = (...values: number[]): RollDie => {
  let next = 0;
  return () => values[next++];
};

describe('rollDie', () => {
  it('stays within the die', () => {
    for (let i = 0; i < 500; i++) {
      const value = rollDie(20);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(20);
    }
  });
});

describe('rollMode', () => {
  it('is normal with neither or with both', () => {
    expect(rollMode(false, false)).toBe('normal');
    expect(rollMode(true, true)).toBe('normal');
  });

  it('is the one it has', () => {
    expect(rollMode(true, false)).toBe('advantage');
    expect(rollMode(false, true)).toBe('disadvantage');
  });
});

describe('rollD20', () => {
  it('rolls one die and adds the modifier', () => {
    expect(rollD20(5, 'normal', dice(12))).toEqual({ mode: 'normal', dice: [12], natural: 12, modifier: 5, total: 17 });
  });

  it('keeps the higher of two with Advantage and the lower with Disadvantage', () => {
    expect(rollD20(0, 'advantage', dice(4, 15)).natural).toBe(15);
    expect(rollD20(0, 'disadvantage', dice(4, 15)).natural).toBe(4);
    expect(rollD20(0, 'advantage', dice(4, 15)).dice).toEqual([4, 15]);
  });
});

describe('attackRoll', () => {
  it('hits when the total meets the Armor Class', () => {
    expect(attackRoll({ bonus: 5, armorClass: 15 }, dice(10)).hit).toBe(true);
    expect(attackRoll({ bonus: 5, armorClass: 15 }, dice(9)).hit).toBe(false);
  });

  it('always hits on a 20, as a Critical Hit', () => {
    const outcome = attackRoll({ bonus: -5, armorClass: 30 }, dice(20));
    expect(outcome.hit).toBe(true);
    expect(outcome.critical).toBe(true);
  });

  it('always misses on a 1', () => {
    const outcome = attackRoll({ bonus: 30, armorClass: 5 }, dice(1));
    expect(outcome.hit).toBe(false);
    expect(outcome.critical).toBe(false);
  });

  it('adds cover to the Armor Class', () => {
    expect(coverBonus('none')).toBe(0);
    expect(coverBonus('half')).toBe(2);
    expect(coverBonus('three-quarters')).toBe(5);
    const behindCover = attackRoll({ bonus: 5, armorClass: 15, cover: 'half' }, dice(11));
    expect(behindCover.armorClass).toBe(17);
    expect(behindCover.hit).toBe(false);
  });

  it('makes any hit a Critical Hit when told the target is helpless and close', () => {
    expect(attackRoll({ bonus: 5, armorClass: 10, criticalOnHit: true }, dice(8)).critical).toBe(true);
    expect(attackRoll({ bonus: 5, armorClass: 30, criticalOnHit: true }, dice(8)).critical).toBe(false);
  });

  it('rolls with the mode it is given', () => {
    expect(attackRoll({ bonus: 0, armorClass: 12, mode: 'disadvantage' }, dice(18, 3)).hit).toBe(false);
  });
});

describe('savingThrow', () => {
  it('succeeds when the total meets the DC', () => {
    expect(savingThrow({ bonus: 2, dc: 13 }, dice(11)).success).toBe(true);
    expect(savingThrow({ bonus: 2, dc: 13 }, dice(10)).success).toBe(false);
  });

  it('gives a 20 and a 1 no special meaning', () => {
    expect(savingThrow({ bonus: 0, dc: 25 }, dice(20)).success).toBe(false);
    expect(savingThrow({ bonus: 10, dc: 10 }, dice(1)).success).toBe(true);
  });

  it('fails without rolling when it cannot succeed', () => {
    const outcome = savingThrow({ bonus: 20, dc: 5, autoFail: true }, dice());
    expect(outcome).toEqual({ roll: null, dc: 5, success: false });
  });
});

describe('abilityCheck', () => {
  it('meets or beats the DC', () => {
    expect(abilityCheck({ bonus: 3, dc: 15 }, dice(12)).success).toBe(true);
  });
});
