import type { CombatAction } from '../actions';
import { sneakAttackDamage, sneakAttackDice, sneakAttackWeapon } from '../sneakAttack';

const weapon = (kind: 'melee' | 'ranged', finesse = false): CombatAction => ({
  name: 'Weapon',
  cost: 'action',
  source: 'sheet',
  attack: {
    kind,
    bonus: 5,
    damage: [{ roll: { count: 1, sides: 8, bonus: 3 }, type: 'piercing' }],
    ...(finesse ? { finesse } : {}),
  },
});

describe('sneakAttackDice', () => {
  it('reads the Rogue table, for a Rogue or a gestalt one', () => {
    expect(sneakAttackDice({ class: 'Rogue', level: 1 })).toBe(1);
    expect(sneakAttackDice({ class: 'Fighter / Rogue', level: 5 })).toBe(3);
    expect(sneakAttackDice({ class: 'rogue', level: 20 })).toBe(10);
  });

  it('is none for anyone else', () => {
    expect(sneakAttackDice({ class: 'Fighter', level: 5 })).toBe(0);
    expect(sneakAttackDice(null)).toBe(0);
  });
});

describe('sneakAttackWeapon', () => {
  it('is a Finesse or a Ranged weapon', () => {
    expect(sneakAttackWeapon(weapon('melee', true))).toBe(true);
    expect(sneakAttackWeapon(weapon('ranged'))).toBe(true);
    expect(sneakAttackWeapon(weapon('melee'))).toBe(false);
  });

  it('is not a spell nor an Unarmed Strike', () => {
    expect(sneakAttackWeapon({ ...weapon('ranged'), source: 'spell' })).toBe(false);
    expect(
      sneakAttackWeapon({ ...weapon('melee', true), source: 'unarmed', unarmed: 'damage' })
    ).toBe(false);
  });
});

describe('sneakAttackDamage', () => {
  const rapier = weapon('melee', true);

  it('comes with Advantage, of the weapon’s damage type', () => {
    expect(sneakAttackDamage(3, rapier, 'advantage', false)).toEqual({
      roll: { count: 3, sides: 6, bonus: 0 },
      type: 'piercing',
    });
  });

  it('comes with an ally beside the target, unless the roll has Disadvantage', () => {
    expect(sneakAttackDamage(2, rapier, 'normal', true)).not.toBeNull();
    expect(sneakAttackDamage(2, rapier, 'disadvantage', true)).toBeNull();
  });

  it('does not come with neither, nor for another weapon, nor without dice', () => {
    expect(sneakAttackDamage(2, rapier, 'normal', false)).toBeNull();
    expect(sneakAttackDamage(2, weapon('melee'), 'advantage', true)).toBeNull();
    expect(sneakAttackDamage(0, rapier, 'advantage', true)).toBeNull();
  });
});
