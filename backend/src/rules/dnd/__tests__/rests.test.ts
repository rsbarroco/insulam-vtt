import { longRest, readPool, spendHitDie } from '../rests';

const sheet = (over: Record<string, unknown> = {}) => ({
  hp: { current: 10, maximum: 30, temporary: 4 },
  stats: { constitution: { score: 14, modifier: 2 } },
  hitDice: [{ class: 'Fighter', die: 'd10', maximum: 5, remaining: 2 }],
  ...over,
});

describe('readPool', () => {
  it('reads a die with its count, and the older packed pool', () => {
    expect(readPool({ die: 'd10', maximum: 5, remaining: 3 })).toEqual({
      sides: 10,
      maximum: 5,
      remaining: 3,
    });
    expect(readPool({ total: '5d8', remaining: 9 })).toEqual({
      sides: 8,
      maximum: 5,
      remaining: 5,
    });
  });

  it('leaves a pool it cannot roll as written alone', () => {
    expect(readPool({ die: '2d6', maximum: 3, remaining: 3 })).toBeNull();
    expect(readPool({ die: 'd10', remaining: 1 })).toBeNull();
  });
});

describe('spendHitDie', () => {
  it('rolls the die, adds Constitution and regains that many Hit Points', () => {
    const spent = spendHitDie(sheet(), () => 6);
    expect(spent).toMatchObject({
      ok: true,
      rolled: 6,
      sides: 10,
      modifier: 2,
      regained: 8,
      left: 1,
    });
    if (!spent.ok) return;
    expect(spent.sheet.hp).toEqual({ current: 18, maximum: 30, temporary: 4 });
    expect(spent.sheet.hitDice).toEqual([
      { class: 'Fighter', die: 'd10', maximum: 5, remaining: 1 },
    ]);
  });

  it('regains at least 1, and no more than the maximum', () => {
    const frail = sheet({ stats: { constitution: { score: 4, modifier: -3 } } });
    expect(spendHitDie(frail, () => 1)).toMatchObject({ regained: 1 });
    expect(
      spendHitDie(sheet({ hp: { current: 28, maximum: 30, temporary: 0 } }), () => 10)
    ).toMatchObject({ regained: 2 });
  });

  it('takes the die from the first pool that has one', () => {
    const two = sheet({
      hitDice: [
        { class: 'Fighter', die: 'd10', maximum: 3, remaining: 0 },
        { class: 'Wizard', die: 'd6', maximum: 3, remaining: 3 },
      ],
    });
    const spent = spendHitDie(two, () => 4);
    expect(spent).toMatchObject({ ok: true, sides: 6, left: 2 });
  });

  it('refuses with no dice left, at full Hit Points, or with none to track', () => {
    expect(
      spendHitDie(sheet({ hitDice: [{ class: 'Fighter', die: 'd10', maximum: 5, remaining: 0 }] }))
    ).toEqual({
      ok: false,
      reason: 'No Hit Point Dice left to spend',
    });
    expect(spendHitDie(sheet({ hp: { current: 30, maximum: 30, temporary: 0 } }))).toEqual({
      ok: false,
      reason: 'Already at full Hit Points',
    });
    expect(spendHitDie({})).toEqual({ ok: false, reason: 'The sheet tracks no Hit Points' });
  });
});

describe('longRest', () => {
  const tired = sheet({
    spellcasting: {
      spellSaveDC: 14,
      slots: { '1': { total: 4, expended: 3 }, '2': { total: 2, expended: 0 } },
    },
    exhaustionLevel: 2,
    deathSaves: { successes: 1, failures: 2 },
  });

  it('gives back all Hit Points, Hit Point Dice and spell slots', () => {
    const rested = longRest(tired);
    expect(rested.sheet.hp).toEqual({ current: 30, maximum: 30, temporary: 0 });
    expect(rested.sheet.hitDice).toEqual([
      { class: 'Fighter', die: 'd10', maximum: 5, remaining: 5 },
    ]);
    expect(rested.sheet.spellcasting).toEqual({
      spellSaveDC: 14,
      slots: { '1': { total: 4, expended: 0 }, '2': { total: 2, expended: 0 } },
    });
  });

  it('takes off one level of Exhaustion and clears the death saves', () => {
    const rested = longRest(tired);
    expect(rested.sheet.exhaustionLevel).toBe(1);
    expect(rested.sheet.deathSaves).toEqual({ successes: 0, failures: 0 });
  });

  it('says what it gave back', () => {
    expect(longRest(tired).regained).toEqual([
      '20 Hit Points',
      '3 Hit Point Dice',
      '3 spell slots',
      'Exhaustion 2 to 1',
    ]);
    expect(
      longRest(sheet({ hp: { current: 30, maximum: 30, temporary: 0 }, hitDice: [] })).regained
    ).toEqual([]);
  });

  it('leaves the stored sheet untouched', () => {
    const before = JSON.stringify(tired);
    longRest(tired);
    expect(JSON.stringify(tired)).toBe(before);
  });
});
