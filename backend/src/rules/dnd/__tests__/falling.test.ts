import { fallDice, resolveFall } from '../falling';

const threes = () => 3;
const hero = (over = {}) => ({ name: 'Hero', hp: { current: 20, max: 20, temp: 0 }, ...over });

describe('fallDice', () => {
  it('is one d6 for every 10 feet fallen', () => {
    expect([0, 9, 10, 19, 20, 45].map(fallDice)).toEqual([0, 0, 1, 1, 2, 4]);
  });

  it('stops at 20d6', () => {
    expect(fallDice(200)).toBe(20);
    expect(fallDice(1000)).toBe(20);
  });
});

describe('resolveFall', () => {
  it('rolls the dice, takes the damage and lands the creature Prone', () => {
    const fall = resolveFall(hero(), 30, threes);
    expect(fall.rolled.dice).toEqual([3, 3, 3]);
    expect(fall).toMatchObject({
      dealt: 9,
      hp: { current: 11, max: 20, temp: 0 },
      prone: true,
      dropped: false,
    });
    expect(fall.summary).toBe('Hero falls 30 ft: 9 bludgeoning damage, Prone');
  });

  it('takes Temporary Hit Points first', () => {
    expect(resolveFall(hero({ hp: { current: 20, max: 20, temp: 5 } }), 20, threes).hp).toEqual({
      current: 19,
      max: 20,
      temp: 0,
    });
  });

  it('halves it for a creature resistant to bludgeoning damage', () => {
    expect(
      resolveFall(hero({ defences: { resistances: ['bludgeoning'] } }), 40, threes).dealt
    ).toBe(6);
  });

  it('leaves a creature that takes no damage on its feet', () => {
    const immune = resolveFall(hero({ defences: { immunities: ['bludgeoning'] } }), 40, threes);
    expect(immune).toMatchObject({ dealt: 0, prone: false, hp: { current: 20 } });
    expect(immune.summary).toBe('Hero falls 40 ft: no damage');
    expect(resolveFall(hero(), 5, threes)).toMatchObject({ dealt: 0, prone: false });
  });

  it('says when the fall drops the creature, or kills it outright', () => {
    expect(resolveFall(hero({ hp: { current: 6, max: 20, temp: 0 } }), 30, threes).summary).toBe(
      'Hero falls 30 ft: 9 bludgeoning damage, Prone, drops to 0 Hit Points'
    );
    expect(resolveFall(hero({ hp: { current: 4, max: 10, temp: 0 } }), 200, threes)).toMatchObject({
      instantDeath: true,
    });
  });

  it('still lands a creature with no hit points to track Prone', () => {
    expect(resolveFall({ name: 'Crate', hp: null }, 20, threes)).toMatchObject({
      dealt: 6,
      hp: null,
      prone: true,
      dropped: false,
    });
  });
});
