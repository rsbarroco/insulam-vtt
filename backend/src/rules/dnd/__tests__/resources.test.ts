import {
  classesOf,
  resourcesOf,
  restoreResources,
  secondWindBonus,
  spendResource,
} from '../resources';

const fighter = (level: number, featureUses?: Record<string, number>) => ({
  class: 'Fighter',
  level,
  ...(featureUses ? { featureUses } : {}),
});

describe('classesOf', () => {
  it('reads a gestalt sheet as both classes at its level', () => {
    expect(classesOf({ class: 'Fighter / Wizard', level: 4 })).toEqual({
      classes: ['Fighter', 'Wizard'],
      level: 4,
    });
  });
});

describe('resourcesOf', () => {
  it('gives a Fighter Second Wind from its table and Action Surge from level 2', () => {
    expect(resourcesOf(fighter(1))).toEqual([
      { name: 'Second Wind', max: 2, used: 0, shortRest: 'one' },
    ]);
    expect(resourcesOf(fighter(4)).map((r) => [r.name, r.max])).toEqual([
      ['Second Wind', 3],
      ['Action Surge', 1],
    ]);
    expect(resourcesOf(fighter(17)).map((r) => [r.name, r.max])).toEqual([
      ['Second Wind', 4],
      ['Action Surge', 2],
    ]);
  });

  it('gives a Barbarian its Rages, and a gestalt character both', () => {
    expect(
      resourcesOf({ class: 'Barbarian / Fighter', level: 3 }).map((r) => [r.name, r.max])
    ).toEqual([
      ['Second Wind', 2],
      ['Action Surge', 1],
      ['Rage', 3],
    ]);
  });

  it('gives a Wizard none, and reads what is spent', () => {
    expect(resourcesOf({ class: 'Wizard', level: 5 })).toEqual([]);
    expect(resourcesOf(fighter(1, { 'Second Wind': 1 }))[0].used).toBe(1);
  });
});

describe('spendResource', () => {
  it('spends one use, and refuses when none are left', () => {
    const once = spendResource(fighter(1), 'Second Wind');
    expect(once).toMatchObject({ ok: true, left: 1 });
    if (!once.ok) return;
    const twice = spendResource(once.sheet, 'Second Wind');
    expect(twice).toMatchObject({ ok: true, left: 0 });
    if (!twice.ok) return;
    expect(spendResource(twice.sheet, 'Second Wind')).toEqual({
      ok: false,
      reason: 'No uses of Second Wind left until a rest',
    });
  });

  it('refuses a feature the sheet does not have', () => {
    expect(spendResource(fighter(1), 'Action Surge')).toEqual({
      ok: false,
      reason: 'The sheet has no Action Surge',
    });
  });
});

describe('restoreResources', () => {
  const tired = fighter(4, { 'Second Wind': 3, 'Action Surge': 1 });

  it('gives back one Second Wind and every Action Surge on a Short Rest', () => {
    const rested = restoreResources(tired, 'short');
    expect(rested.sheet.featureUses).toEqual({ 'Second Wind': 2 });
    expect(rested.regained).toEqual(['1 Second Wind', '1 Action Surge']);
  });

  it('gives back everything on a Long Rest', () => {
    expect(restoreResources(tired, 'long')).toEqual({
      sheet: { ...tired, featureUses: {} },
      regained: ['3 Second Wind', '1 Action Surge'],
    });
  });
});

describe('secondWindBonus', () => {
  it('is the Fighter level', () => {
    expect(secondWindBonus(fighter(7))).toBe(7);
  });
});
