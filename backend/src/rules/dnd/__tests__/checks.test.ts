import { checkModifiers, passiveScore, resolveCheck, SKILL_CHECKS } from '../checks';
import { readConditions } from '../conditions';

const having = (...names: string[]) => readConditions(names);
const dice =
  (...faces: number[]) =>
  () =>
    faces.shift() ?? 10;
const check = (over: Partial<Parameters<typeof resolveCheck>[0]> = {}) => ({
  name: 'Hero',
  label: 'Dexterity (Stealth)',
  bonus: 5,
  conditions: having(),
  ...over,
});

describe('resolveCheck', () => {
  it('meets or beats the DC to succeed', () => {
    expect(resolveCheck(check({ dc: 15 }), dice(10))).toMatchObject({ total: 15, success: true });
    expect(resolveCheck(check({ dc: 15 }), dice(9))).toMatchObject({ total: 14, success: false });
  });

  it('says the roll and the verdict in one line', () => {
    expect(resolveCheck(check({ dc: 15 }), dice(12)).summary).toBe(
      'Hero Dexterity (Stealth) check: 17 vs DC 15: success'
    );
    expect(resolveCheck(check({ dc: 15 }), dice(3)).summary).toBe(
      'Hero Dexterity (Stealth) check: 8 vs DC 15: failure'
    );
  });

  it('gives the total alone when the table set no DC', () => {
    const made = resolveCheck(check({ label: 'Strength', bonus: -1 }), dice(7));
    expect(made).toMatchObject({ total: 6, success: null });
    expect(made.summary).toBe('Hero Strength check: 6');
  });

  it('makes nothing special of a 20 or a 1', () => {
    expect(resolveCheck(check({ dc: 30 }), dice(20)).success).toBe(false);
    expect(resolveCheck(check({ dc: 5 }), dice(1)).success).toBe(true);
  });

  it.each(['Poisoned', 'Frightened'])('rolls with Disadvantage for a %s creature', (name) => {
    const made = resolveCheck(check({ dc: 15, conditions: having(name) }), dice(18, 4));
    expect(made).toMatchObject({ total: 9, success: false, reasons: [`Disadvantage: ${name}`] });
    expect(made.roll.dice).toEqual([18, 4]);
  });

  it('cancels the table’s Advantage against a condition’s Disadvantage', () => {
    const made = resolveCheck(
      check({ mode: 'advantage', conditions: having('Poisoned') }),
      dice(18, 4)
    );
    expect(made.roll.dice).toEqual([18]);
    expect(made.reasons).toEqual(['Disadvantage: Poisoned', 'Advantage: granted by the table']);
  });

  it('takes 2 from the roll for each level of Exhaustion', () => {
    expect(resolveCheck(check({ conditions: readConditions([], 3) }), dice(10)).total).toBe(9);
  });
});

describe('checkModifiers', () => {
  it('leaves a creature with other conditions to roll normally', () => {
    expect(checkModifiers(having('Prone', 'Grappled'))).toEqual({
      advantage: false,
      disadvantage: false,
      penalty: 0,
      reasons: [],
    });
  });
});

describe('the skills', () => {
  it('are the eighteen, each on its ability', () => {
    expect(Object.keys(SKILL_CHECKS)).toHaveLength(18);
    expect(SKILL_CHECKS.stealth).toEqual({ ability: 'dex', name: 'Stealth' });
    expect(SKILL_CHECKS.animalHandling).toEqual({ ability: 'wis', name: 'Animal Handling' });
  });

  it('have a passive score of 10 plus the bonus', () => {
    expect(passiveScore(3)).toBe(13);
    expect(passiveScore(-1)).toBe(9);
  });
});

describe('a raging creature', () => {
  it('makes Strength checks with Advantage, and others as usual', () => {
    const raging = having('Raging');
    expect(resolveCheck(check({ label: 'Strength (Athletics)', ability: 'str', conditions: raging }), dice(3, 15))).toMatchObject({
      total: 20,
      reasons: ['Advantage: Rage'],
    });
    expect(resolveCheck(check({ ability: 'dex', conditions: raging }), dice(3)).reasons).toEqual([]);
  });
});

describe('Tactical Mind', () => {
  it('adds 1d10 to a failed check, which may turn it into a success', () => {
    const turned = resolveCheck(check({ dc: 15, tacticalMind: true }), dice(4, 7));
    expect(turned).toMatchObject({ total: 16, success: true, tacticalMind: { rolled: 7, success: true } });
    expect(turned.summary).toBe('Hero Dexterity (Stealth) check: 9 vs DC 15: failure; Tactical Mind +7: 16, success');
    const still = resolveCheck(check({ dc: 15, tacticalMind: true }), dice(2, 3));
    expect(still).toMatchObject({ total: 10, success: false, tacticalMind: { rolled: 3, success: false } });
  });

  it('is not used by a check that succeeds, or one with no DC', () => {
    expect(resolveCheck(check({ dc: 15, tacticalMind: true }), dice(12)).tacticalMind).toBeUndefined();
    expect(resolveCheck(check({ tacticalMind: true }), dice(2)).tacticalMind).toBeUndefined();
  });
});
