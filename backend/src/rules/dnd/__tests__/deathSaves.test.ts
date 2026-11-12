import { damageAtZero, deathSavingThrow } from '../deathSaves';
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
