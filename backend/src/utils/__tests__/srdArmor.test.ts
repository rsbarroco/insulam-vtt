import { armorClassOf, findSrdArmor, SRD_ARMOR } from '../srdArmor';

const base = {
  dex: 3,
  con: 2,
  wis: 1,
  classes: [] as string[],
  features: [] as string[],
  equipped: [] as string[],
};

describe('the armor table', () => {
  it('has the thirteen pieces of the SRD, found however the sheet writes them', () => {
    expect(SRD_ARMOR).toHaveLength(13);
    expect(findSrdArmor('chain mail')?.base).toBe(16);
    expect(findSrdArmor('Studded Leather')?.base).toBe(12);
    expect(findSrdArmor('Plate')?.strength).toBe(15);
    expect(findSrdArmor('Rope')).toBeNull();
  });
});

describe('armorClassOf', () => {
  it('adds Dexterity to light armor, at most 2 to medium, none to heavy', () => {
    expect(armorClassOf({ ...base, equipped: ['Leather Armor'] }).armorClass).toBe(14);
    expect(armorClassOf({ ...base, equipped: ['Breastplate'] }).armorClass).toBe(16);
    expect(armorClassOf({ ...base, equipped: ['Chain Mail'] }).armorClass).toBe(16);
  });

  it('adds 2 for a Shield and 1 for Defense with armor', () => {
    expect(
      armorClassOf({
        ...base,
        equipped: ['Chain Mail', 'Shield'],
        features: ['Fighting Style: Defense'],
      })
    ).toEqual({
      armorClass: 19,
      armor: 'Chain Mail',
      shield: true,
      from: 'Chain Mail 16 + Defense 1 + Shield 2',
    });
    expect(armorClassOf({ ...base, features: ['Defense'] }).armorClass).toBe(13);
  });

  it('takes the best Unarmored Defense, a Monk’s only without a Shield', () => {
    expect(armorClassOf({ ...base, classes: ['Barbarian'] }).armorClass).toBe(15);
    expect(armorClassOf({ ...base, classes: ['Monk'], wis: 4 }).armorClass).toBe(17);
    expect(
      armorClassOf({ ...base, classes: ['Monk'], wis: 4, equipped: ['Shield'] }).armorClass
    ).toBe(15);
    expect(armorClassOf({ ...base, classes: ['Barbarian', 'Monk'], wis: 1 }).armorClass).toBe(15);
  });
});
