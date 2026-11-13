import type { CombatAction } from '../actions';
import {
  archeryBonus,
  atLeastThree,
  greatWeaponFighting,
  hasFeat,
  savageAttackerApplies,
} from '../feats';

const weapon = (
  kind: 'melee' | 'ranged',
  over: Partial<NonNullable<CombatAction['attack']>> = {}
): CombatAction => ({
  name: 'Weapon',
  cost: 'action',
  source: 'sheet',
  attack: {
    kind,
    bonus: 5,
    damage: [{ roll: { count: 2, sides: 6, bonus: 3 }, type: 'slashing' }],
    ...over,
  },
});
const features = (...names: string[]) => names.map((name) => ({ name, description: '' }));

describe('hasFeat', () => {
  it('finds a feat however the sheet writes it', () => {
    expect(hasFeat(features('Savage Attacker (Origin feat)'), 'Savage Attacker')).toBe(true);
    expect(hasFeat(features('Fighting Style: Archery'), 'Archery')).toBe(true);
    expect(hasFeat(features('Great-Weapon Fighting'), 'Great Weapon Fighting')).toBe(true);
    expect(hasFeat(features('Archery Practice'), 'Archery')).toBe(false);
  });
});

describe('the feats in an attack', () => {
  it('Archery adds 2 to a Ranged weapon attack only', () => {
    expect(archeryBonus(features('Archery'), weapon('ranged'))).toBe(2);
    expect(archeryBonus(features('Archery'), weapon('melee'))).toBe(0);
    expect(archeryBonus(features('Archery'), { ...weapon('ranged'), source: 'spell' })).toBe(0);
  });

  it('Great Weapon Fighting is for a melee Two-Handed weapon, and counts a 1 or 2 as 3', () => {
    expect(
      greatWeaponFighting(features('Great Weapon Fighting'), weapon('melee', { twoHanded: true }))
    ).toBe(true);
    expect(greatWeaponFighting(features('Great Weapon Fighting'), weapon('melee'))).toBe(false);
    expect(atLeastThree(() => 1)(6)).toBe(3);
    expect(atLeastThree(() => 5)(6)).toBe(5);
  });

  it('Savage Attacker is for a weapon', () => {
    expect(savageAttackerApplies(features('Savage Attacker'), weapon('melee'))).toBe(true);
    expect(
      savageAttackerApplies(features('Savage Attacker'), {
        ...weapon('melee'),
        source: 'unarmed',
        unarmed: 'damage',
      })
    ).toBe(false);
  });
});
