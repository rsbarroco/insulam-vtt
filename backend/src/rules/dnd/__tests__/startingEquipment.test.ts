/**
 * Starting equipment: the packages read from the classes' and backgrounds'
 * sentences, what of them is worn and held, and the attack rows the weapons make.
 */

import { findSrdWeapon } from '../../../utils/srdWeapons';
import { findBackground } from '../origins';
import {
  attackFor,
  backgroundEquipment,
  classEquipment,
  equipmentPackages,
  inventoryOf,
  masteryAllows,
  weaponMasteryCount,
  type Wielder,
} from '../startingEquipment';

const weapon = (name: string) => findSrdWeapon(name)!;
const fighterArms: Wielder = { str: 3, dex: 1, proficiencyBonus: 2, proficiencies: 'Simple and Martial weapons', monkLevel: 0, masteries: [] };

describe('the packages', () => {
  it('reads a class’s options, with the items, their counts and the gold', () => {
    const [a, b, c] = classEquipment('Fighter');
    expect(a).toMatchObject({ option: 'A', gold: 4 });
    expect(a.items).toEqual([
      { name: 'Chain Mail', quantity: 1, armor: 'Chain Mail' },
      { name: 'Greatsword', quantity: 1, weapon: 'Greatsword' },
      { name: 'Flail', quantity: 1, weapon: 'Flail' },
      { name: 'Javelin', quantity: 8, weapon: 'Javelin' },
      { name: 'Dungeoneer’s Pack', quantity: 1 },
    ]);
    expect(b.items.map((item) => item.name)).toEqual(['Studded Leather Armor', 'Scimitar', 'Shortsword', 'Longbow', 'Arrows', 'Quiver', 'Dungeoneer’s Pack']);
    expect(c).toMatchObject({ option: 'C', items: [], gold: 155 });
  });

  it('reads a staff that is a focus as the Quarterstaff it also is', () => {
    expect(classEquipment('Wizard')[0].items).toContainEqual({ name: 'Quarterstaff', quantity: 1, weapon: 'Quarterstaff', notes: 'Arcane Focus' });
    expect(classEquipment('Warlock')[0].items).toContainEqual({ name: 'Arcane Focus (orb)', quantity: 1 });
  });

  it('reads a background’s options', () => {
    const [a, b] = backgroundEquipment(findBackground('Soldier')!);
    expect(a.gold).toBe(14);
    expect(a.items.slice(0, 3)).toEqual([
      { name: 'Spear', quantity: 1, weapon: 'Spear' },
      { name: 'Shortbow', quantity: 1, weapon: 'Shortbow' },
      { name: 'Arrows', quantity: 20 },
    ]);
    expect(b).toMatchObject({ option: 'B', items: [], gold: 50 });
    expect(equipmentPackages('')).toEqual([]);
  });
});

describe('what is worn and held', () => {
  it('wears the armor and the Shield the training covers, with the best one-handed weapon', () => {
    const items = inventoryOf([classEquipment('Paladin')[0]], 'Light, Medium, and Heavy armor and Shields');
    const equipped = items.filter((item) => item.equipped).map((item) => item.name);
    expect(equipped).toEqual(['Chain Mail', 'Shield', 'Longsword']);
    expect(items.find((item) => item.name === 'Javelin')).toEqual({ name: 'Javelin', quantity: 6, equippable: true, equipped: false, weight: 2 });
  });

  it('holds a two-handed weapon without a Shield, and two Light weapons together', () => {
    const fighter = inventoryOf([classEquipment('Fighter')[0]], 'Light, Medium, and Heavy armor and Shields');
    expect(fighter.filter((item) => item.equipped).map((item) => item.name)).toEqual(['Chain Mail', 'Greatsword']);
    const rogue = inventoryOf([classEquipment('Rogue')[0], backgroundEquipment(findBackground('Criminal')!)[0]], 'Light armor');
    expect(rogue.filter((item) => item.equipped).map((item) => item.name)).toEqual(['Leather Armor', 'Dagger', 'Shortsword']);
    // The Criminal's two Daggers join the Rogue's two.
    expect(rogue.find((item) => item.name === 'Dagger')?.quantity).toBe(4);
  });

  it('carries armor it is not trained in without wearing it', () => {
    const items = inventoryOf([classEquipment('Cleric')[0]], 'Light armor');
    expect(items.find((item) => item.name === 'Chain Shirt')?.equipped).toBe(false);
    expect(items.find((item) => item.name === 'Shield')?.equipped).toBe(false);
  });
});

describe('the attack a weapon makes', () => {
  it('adds Strength, Dexterity for a ranged weapon, and the Proficiency Bonus when proficient', () => {
    expect(attackFor(weapon('Greatsword'), fighterArms)).toMatchObject({ name: 'Greatsword', attackBonus: 5, damageRoll: '2d6+3', damageType: 'slashing' });
    expect(attackFor(weapon('Longbow'), fighterArms)).toMatchObject({ attackBonus: 3, damageRoll: '1d8+1', range: 150 });
    // A thrown melee weapon uses Strength.
    expect(attackFor(weapon('Javelin'), fighterArms)).toMatchObject({ attackBonus: 5, damageRoll: '1d6+3', range: 5 });
    expect(attackFor(weapon('Longsword'), { ...fighterArms, proficiencies: 'Simple weapons' })).toMatchObject({ attackBonus: 3 });
  });

  it('takes the better of Strength and Dexterity with Finesse', () => {
    expect(attackFor(weapon('Rapier'), { ...fighterArms, str: 0, dex: 3, proficiencies: 'Simple weapons and Martial weapons that have the Finesse or Light property' }))
      .toMatchObject({ attackBonus: 5, damageRoll: '1d8+3' });
  });

  it('marks the mastery the character uses', () => {
    expect(attackFor(weapon('Greatsword'), { ...fighterArms, masteries: ['Greatsword'] }).useMastery).toBe(true);
    expect(attackFor(weapon('Flail'), { ...fighterArms, masteries: ['Greatsword'] }).useMastery).toBeUndefined();
  });

  it('gives a Monk weapon Dexterity and the Martial Arts die (Martial Arts)', () => {
    const monk: Wielder = { str: 0, dex: 3, proficiencyBonus: 2, proficiencies: 'Simple weapons and Martial weapons that have the Light property', monkLevel: 1, masteries: [] };
    expect(attackFor(weapon('Dagger'), monk)).toMatchObject({ attackBonus: 5, damageRoll: '1d6+3' });
    expect(attackFor(weapon('Spear'), monk)).toMatchObject({ attackBonus: 5, damageRoll: '1d6+3' });
    expect(attackFor(weapon('Spear'), { ...monk, monkLevel: 5 })).toMatchObject({ damageRoll: '1d8+3' });
    // A ranged weapon is not a Monk weapon.
    expect(attackFor(weapon('Shortbow'), monk)).toMatchObject({ attackBonus: 5, damageRoll: '1d6+3' });
    expect(attackFor(weapon('Light Crossbow'), { ...monk, dex: 1, str: 3 })).toMatchObject({ attackBonus: 3, damageRoll: '1d8+1' });
  });
});

describe('Weapon Mastery', () => {
  it('counts the kinds of weapons by the class table', () => {
    expect([1, 4, 10, 16].map((level) => weaponMasteryCount('Fighter', level))).toEqual([3, 4, 5, 6]);
    expect([1, 4, 10].map((level) => weaponMasteryCount('Barbarian', level))).toEqual([2, 3, 4]);
    expect(weaponMasteryCount('Rogue', 1)).toBe(2);
    expect(weaponMasteryCount('Wizard', 20)).toBe(0);
  });

  it('keeps a Barbarian’s to melee weapons', () => {
    expect(masteryAllows('Barbarian', weapon('Longbow'))).toBe(false);
    expect(masteryAllows('Fighter', weapon('Longbow'))).toBe(true);
  });
});
