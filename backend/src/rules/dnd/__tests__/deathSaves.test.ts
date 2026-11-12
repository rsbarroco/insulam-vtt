import { deathSavesAfterDamage, isDying, readDeathSaves, damageAtZero, deathSavingThrow } from '../deathSaves';
import type { RollDie } from '../d20';

const die = (value: number): RollDie => () => value;
const none = { successes: 0, failures: 0 };

describe('deathSavingThrow', () => {
  it('counts 10 or higher as a success and lower as a failure', () => {
    expect(deathSavingThrow(none, die(10)).saves).toEqual({ successes: 1, failures: 0 });
    expect(deathSavingThrow(none, die(9)).saves).toEqual({ successes: 0, failures: 1 });
  });

  it('counts a 1 as two failures', () => {
    expect(deathSavingThrow(none, die(1)).saves).toEqual({ successes: 0, failures: 2 });
  });

  it('revives on a 20 and clears the saves', () => {
    expect(deathSavingThrow({ successes: 1, failures: 2 }, die(20))).toEqual({ natural: 20, saves: none, result: 'revived' });
  });

  it('is stable at three successes and dead at three failures', () => {
    expect(deathSavingThrow({ successes: 2, failures: 2 }, die(15)).result).toBe('stable');
    expect(deathSavingThrow({ successes: 2, failures: 2 }, die(5)).result).toBe('dead');
    expect(deathSavingThrow({ successes: 0, failures: 2 }, die(1)).saves.failures).toBe(3);
  });

  it('goes on otherwise', () => {
    expect(deathSavingThrow(none, die(12)).result).toBe('continues');
  });
});

describe('damageAtZero', () => {
  it('is one failure, or two from a Critical Hit', () => {
    expect(damageAtZero(none).saves.failures).toBe(1);
    expect(damageAtZero(none, true).saves.failures).toBe(2);
  });

  it('kills at the third failure', () => {
    expect(damageAtZero({ successes: 2, failures: 2 }).result).toBe('dead');
    expect(damageAtZero({ successes: 0, failures: 1 }, true).result).toBe('dead');
  });
});

describe('death saves on a sheet', () => {
  it('reads what is stored, whatever its state', () => {
    expect(readDeathSaves({ successes: 2, failures: 1 })).toEqual({ successes: 2, failures: 1 });
    expect(readDeathSaves(undefined)).toEqual({ successes: 0, failures: 0 });
    expect(readDeathSaves({ successes: 9, failures: -1 })).toEqual({ successes: 3, failures: 0 });
  });

  it('counts damage at 0 Hit Points as a failure, two from a Critical Hit', () => {
    expect(deathSavesAfterDamage({ successes: 1, failures: 0 }, 0, 0, false)).toEqual({ successes: 1, failures: 1 });
    expect(deathSavesAfterDamage({ successes: 1, failures: 1 }, 0, 0, true)).toEqual({ successes: 1, failures: 3 });
  });

  it('starts the saves afresh when a character drops to 0, and leaves them alone otherwise', () => {
    expect(deathSavesAfterDamage({ successes: 2, failures: 2 }, 5, 0, false)).toEqual({ successes: 0, failures: 0 });
    expect(deathSavesAfterDamage({ successes: 0, failures: 0 }, 5, 0, false)).toBeNull();
    expect(deathSavesAfterDamage({ successes: 0, failures: 1 }, 9, 4, false)).toBeNull();
  });

  it('knows who is dying', () => {
    expect(isDying(0, { successes: 2, failures: 2 })).toBe(true);
    expect(isDying(0, { successes: 3, failures: 0 })).toBe(false);
    expect(isDying(0, { successes: 0, failures: 3 })).toBe(false);
    expect(isDying(4, { successes: 0, failures: 0 })).toBe(false);
  });
});
