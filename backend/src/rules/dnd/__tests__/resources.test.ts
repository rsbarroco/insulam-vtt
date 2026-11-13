import {
  classesOf,
  resourcesOf,
  restoreResources,
  secondWindBonus,
  spendResource, rageDamage, bardicDie } from '../resources';

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

describe('rageDamage', () => {
  it('follows the Barbarian table: +2, +3 from level 9, +4 from 16', () => {
    expect([1, 8, 9, 16].map((level) => rageDamage({ class: 'Barbarian', level }))).toEqual([2, 2, 3, 4]);
    expect(rageDamage({ class: 'Fighter', level: 9 })).toBe(0);
  });
});

describe('the other classes’ features with uses', () => {
  const names = (sheet: Record<string, unknown>) => resourcesOf(sheet).map((r) => [r.name, r.max, r.shortRest]);

  it('gives a Bard its Charisma modifier in Bardic Inspiration, back on a Short Rest from level 5', () => {
    const bard = (level: number, charisma: number) => ({ class: 'Bard', level, stats: { charisma: { score: charisma } } });
    expect(names(bard(1, 16))).toEqual([['Bardic Inspiration', 3, 'none']]);
    expect(names(bard(5, 8))).toEqual([['Bardic Inspiration', 1, 'all']]);
    expect(bardicDie(bard(5, 16))).toBe('d8');
    expect(bardicDie({ class: 'Fighter', level: 5 })).toBeNull();
  });

  it('reads Channel Divinity, Wild Shape, Focus, Sorcery Points and Favored Enemy from the tables', () => {
    expect(names({ class: 'Cleric', level: 1 })).toEqual([]);
    expect(names({ class: 'Cleric', level: 6 })).toEqual([['Channel Divinity', 3, 'one']]);
    expect(names({ class: 'Paladin / Cleric', level: 3 })).toEqual([
      ['Channel Divinity', 2, 'one'],
      ['Lay on Hands', 15, 'none'],
    ]);
    expect(names({ class: 'Druid', level: 2 })).toEqual([['Wild Shape', 2, 'one']]);
    expect(names({ class: 'Monk', level: 5 })).toEqual([['Focus Points', 5, 'all']]);
    expect(names({ class: 'Sorcerer', level: 4 })).toEqual([['Sorcery Points', 4, 'none']]);
    expect(names({ class: 'Ranger', level: 1 })).toEqual([['Favored Enemy', 2, 'none']]);
  });

  it('spends several points at once, never past what is left', () => {
    const monk = { class: 'Monk', level: 5, featureUses: { 'Focus Points': 2 } };
    expect(spendResource(monk, 'Focus Points', 3)).toMatchObject({ ok: true, left: 0 });
    expect(spendResource(monk, 'Focus Points', 4)).toEqual({ ok: false, reason: 'Only 3 Focus Points left' });
  });

  it('gives back on a Short Rest only what the feature says', () => {
    const sheet = {
      class: 'Sorcerer / Monk',
      level: 5,
      featureUses: { 'Sorcery Points': 3, 'Focus Points': 4 },
    };
    expect(restoreResources(sheet, 'short')).toEqual({
      sheet: { ...sheet, featureUses: { 'Sorcery Points': 3 } },
      regained: ['4 Focus Points'],
    });
    expect(restoreResources(sheet, 'long').sheet.featureUses).toEqual({});
  });
});
