import { canWrestle, proficiencyBonusForChallenge, pushedTo, unarmedActions } from '../unarmed';

describe('unarmedActions', () => {
  const [strike, grapple, prone, push] = unarmedActions(3, 2);

  it('attacks with Strength and proficiency, for 1 plus Strength of Bludgeoning damage', () => {
    expect(strike).toMatchObject({ name: 'Unarmed Strike', unarmed: 'damage', source: 'unarmed' });
    expect(strike.attack).toEqual({
      kind: 'melee',
      bonus: 5,
      reachFeet: 5,
      damage: [{ type: 'bludgeoning', roll: { count: 0, sides: 1, bonus: 4 } }],
    });
  });

  it('never deals less than nothing', () => {
    expect(unarmedActions(-3, 2)[0].attack?.damage[0].roll.bonus).toBe(0);
  });

  it('grapples and shoves against DC 8 plus Strength and proficiency, within 5 feet', () => {
    for (const action of [grapple, prone, push]) {
      expect(action.save).toEqual({ ability: 'str', dc: 13, damage: [], halfOnSuccess: false });
      expect(action.rangeFeet).toBe(5);
    }
    expect([grapple.unarmed, prone.unarmed, push.unarmed]).toEqual(['grapple', 'prone', 'push']);
  });
});

describe('proficiencyBonusForChallenge', () => {
  it('follows the table: +2 to CR 4, +3 from 5, +9 at 29 and 30', () => {
    expect([0, 0.25, 1, 4, 5, 8, 9, 17, 29, 30].map(proficiencyBonusForChallenge)).toEqual([
      2, 2, 2, 2, 3, 3, 4, 6, 9, 9,
    ]);
  });
});

describe('canWrestle', () => {
  it('allows a target up to one size larger', () => {
    expect(canWrestle(1, 1)).toBe(true);
    expect(canWrestle(1, 2)).toBe(true);
    expect(canWrestle(1, 3)).toBe(false);
    expect(canWrestle(2, 1)).toBe(true);
  });
});

describe('pushedTo', () => {
  const board = { cols: 10, rows: 10 };
  const one = (x: number, y: number) => ({ x, y, width: 1, height: 1 });

  it('moves the target one square straight away', () => {
    expect(pushedTo(one(3, 3), one(4, 3), board)).toEqual({ x: 5, y: 3 });
    expect(pushedTo(one(3, 3), one(2, 2), board)).toEqual({ x: 1, y: 1 });
  });

  it('keeps it on the board', () => {
    expect(pushedTo(one(8, 3), one(9, 3), board)).toEqual({ x: 9, y: 3 });
  });

  it('pushes away from the middle of a large creature', () => {
    expect(pushedTo({ x: 2, y: 2, width: 2, height: 2 }, one(4, 2), board)).toEqual({ x: 5, y: 1 });
  });
});
