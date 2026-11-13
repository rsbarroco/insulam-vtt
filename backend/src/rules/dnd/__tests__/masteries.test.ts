import { hasWeaponMastery, masteryEffect, weaponModifier } from '../masteries';

const wielder = { modifier: 3, proficiencyBonus: 2 };
const medium = { squares: 1 };

describe('hasWeaponMastery', () => {
  it('finds the feature by name, as a sheet lists it', () => {
    expect(
      hasWeaponMastery([{ name: 'Second Wind' }, { name: 'Weapon Mastery (Fighter 1)' }])
    ).toBe(true);
    expect(hasWeaponMastery([{ name: 'Second Wind' }])).toBe(false);
  });
});

describe('weaponModifier', () => {
  it('uses Strength, Dexterity for a ranged weapon, and the better with Finesse', () => {
    const scores = { str: 1, dex: 4 };
    expect(weaponModifier('Maul', scores)).toBe(1);
    expect(weaponModifier('Longbow', scores)).toBe(4);
    expect(weaponModifier('Rapier', scores)).toBe(4);
    expect(weaponModifier('Rapier', { str: 5, dex: 2 })).toBe(5);
  });
});

describe('masteryEffect', () => {
  it('topples on a hit against DC 8 + modifier + Proficiency Bonus', () => {
    expect(masteryEffect('Topple', { hit: true }, wielder, medium, 'Maul')).toEqual({
      kind: 'topple',
      dc: 13,
    });
    expect(masteryEffect('Topple', { hit: false }, wielder, medium, 'Maul')).toBeNull();
  });

  it('pushes 10 feet on a hit, only a target Large or smaller', () => {
    expect(masteryEffect('Push', { hit: true }, wielder, medium, 'Pike')).toEqual({
      kind: 'push',
      squares: 2,
    });
    expect(masteryEffect('Push', { hit: true }, wielder, { squares: 2 }, 'Pike')).toEqual({
      kind: 'push',
      squares: 2,
    });
    expect(masteryEffect('Push', { hit: true }, wielder, { squares: 3 }, 'Pike')).toBeNull();
  });

  it('grazes on a miss for the modifier, of the weapon’s type', () => {
    expect(masteryEffect('Graze', { hit: false }, wielder, medium, 'Greatsword')).toEqual({
      kind: 'graze',
      damage: 3,
      type: 'slashing',
    });
    expect(masteryEffect('Graze', { hit: true }, wielder, medium, 'Greatsword')).toBeNull();
    expect(
      masteryEffect('Graze', { hit: false }, { ...wielder, modifier: 0 }, medium, 'Greatsword')
    ).toBeNull();
  });

  it('marks the target with Sap on a hit, and with Slow or Vex on a hit that deals damage', () => {
    expect(masteryEffect('Sap', { hit: true, dealt: 0 }, wielder, medium, 'Mace')).toEqual({ kind: 'mark', mark: 'sap' });
    expect(masteryEffect('Vex', { hit: true, dealt: 5 }, wielder, medium, 'Rapier')).toEqual({ kind: 'mark', mark: 'vex' });
    expect(masteryEffect('Slow', { hit: true, dealt: 2 }, wielder, medium, 'Club')).toEqual({ kind: 'mark', mark: 'slow' });
    expect(masteryEffect('Vex', { hit: true, dealt: 0 }, wielder, medium, 'Rapier')).toBeNull();
    expect(masteryEffect('Sap', { hit: false }, wielder, medium, 'Mace')).toBeNull();
  });

  it('leaves Cleave and Nick to the table', () => {
    expect(masteryEffect('Cleave', { hit: true, dealt: 5 }, wielder, medium, 'Greataxe')).toBeNull();
    expect(masteryEffect('Nick', { hit: true, dealt: 5 }, wielder, medium, 'Dagger')).toBeNull();
  });
});
