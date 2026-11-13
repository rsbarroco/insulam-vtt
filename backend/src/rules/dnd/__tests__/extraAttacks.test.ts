import type { CombatAction } from '../actions';
import { extrasOf, hasTwoWeaponFighting, withoutAbilityModifier } from '../extraAttacks';

const weapon = (over: Partial<CombatAction> = {}, light = false): CombatAction => ({
  name: 'Weapon',
  cost: 'action',
  source: 'sheet',
  attack: {
    kind: 'melee',
    bonus: 5,
    damage: [
      { roll: { count: 1, sides: 6, bonus: 3 }, type: 'slashing' },
      { roll: { count: 1, sides: 4, bonus: 0 }, type: 'fire' },
    ],
    ...(light ? { light } : {}),
  },
  ...over,
});

describe('extrasOf', () => {
  it('gives Cleave to a melee weapon whose mastery is used, and Light to a Light weapon', () => {
    expect(extrasOf(weapon({ mastery: 'Cleave' }))).toEqual(['cleave']);
    expect(extrasOf(weapon({ mastery: 'Nick' }, true))).toEqual(['light']);
    expect(extrasOf(weapon())).toEqual([]);
  });

  it('gives nothing to a spell or an Unarmed Strike', () => {
    expect(extrasOf(weapon({ source: 'spell', mastery: 'Cleave' }))).toEqual([]);
    expect(extrasOf(weapon({ source: 'unarmed' }, true))).toEqual([]);
  });
});

describe('withoutAbilityModifier', () => {
  it('takes a positive modifier off the first damage line only', () => {
    const damage = withoutAbilityModifier(weapon(), 3).attack?.damage;
    expect(damage?.map((line) => line.roll.bonus)).toEqual([0, 0]);
  });

  it('keeps a negative modifier', () => {
    expect(withoutAbilityModifier(weapon(), -1)).toEqual(weapon());
  });
});

describe('hasTwoWeaponFighting', () => {
  it('finds the fighting style however it is written', () => {
    expect(hasTwoWeaponFighting([{ name: 'Fighting Style: Two-Weapon Fighting' }])).toBe(true);
    expect(hasTwoWeaponFighting([{ name: 'Two Weapon Fighting' }])).toBe(true);
    expect(hasTwoWeaponFighting([{ name: 'Great Weapon Fighting' }])).toBe(false);
  });
});
