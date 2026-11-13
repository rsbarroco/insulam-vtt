import { findSrdWeapon, proficientWith, SRD_WEAPONS, weaponAttack } from './srdWeapons';

const weapon = (name: string) => {
  const found = findSrdWeapon(name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};
const fighter = { str: 3, dex: 1, proficiencyBonus: 2, proficient: true };

describe('the SRD weapons', () => {
  it('are the table’s 38, ten simple melee and four simple ranged among them', () => {
    expect(SRD_WEAPONS).toHaveLength(38);
    expect(SRD_WEAPONS.filter((w) => w.category === 'simple' && w.kind === 'melee')).toHaveLength(10);
    expect(SRD_WEAPONS.filter((w) => w.category === 'simple' && w.kind === 'ranged')).toHaveLength(4);
  });

  it('keep what the table says of each', () => {
    expect(weapon('Longsword')).toMatchObject({ damage: '1d8', damageType: 'slashing', versatile: '1d10', mastery: 'Sap' });
    expect(weapon('heavy  crossbow')).toMatchObject({ range: { normal: 100, long: 400 }, mastery: 'Push' });
    expect(weapon('Glaive')).toMatchObject({ reach: true, properties: ['Heavy', 'Reach', 'Two-Handed'] });
    expect(weapon('Blowgun').damage).toBe('1');
    expect(findSrdWeapon('Vorpal Sword')).toBeNull();
  });
});

describe('weaponAttack', () => {
  it('uses Strength for a melee weapon and adds proficiency to the roll', () => {
    expect(weaponAttack(weapon('Longsword'), fighter)).toEqual({
      name: 'Longsword',
      attackBonus: 5,
      damageRoll: '1d8+3',
      damageType: 'slashing',
      range: 5,
      properties: ['Versatile (1d10)'],
      notes: 'Two hands: 1d10+3. Mastery: Sap',
    });
  });

  it('uses Dexterity for a ranged weapon, at its normal range', () => {
    expect(weaponAttack(weapon('Longbow'), fighter)).toMatchObject({ attackBonus: 3, damageRoll: '1d8+1', range: 150 });
  });

  it('uses the better of the two with Finesse', () => {
    expect(weaponAttack(weapon('Rapier'), { ...fighter, str: -1, dex: 4 })).toMatchObject({ attackBonus: 6, damageRoll: '1d8+4' });
  });

  it('reaches 10 feet with Reach, and adds no proficiency without it', () => {
    expect(weaponAttack(weapon('Whip'), { ...fighter, proficient: false })).toMatchObject({ attackBonus: 3, range: 10 });
  });

  it('writes a modifier of 0 or less as it is', () => {
    expect(weaponAttack(weapon('Club'), { ...fighter, str: 0 }).damageRoll).toBe('1d4');
    expect(weaponAttack(weapon('Club'), { ...fighter, str: -1 }).damageRoll).toBe('1d4-1');
  });
});

describe('proficientWith', () => {
  it('reads the categories', () => {
    expect(proficientWith(weapon('Club'), 'Simple weapons')).toBe(true);
    expect(proficientWith(weapon('Longsword'), 'Simple weapons')).toBe(false);
    expect(proficientWith(weapon('Longsword'), 'Simple and Martial weapons')).toBe(true);
  });

  it('reads Martial weapons limited to a property', () => {
    const rogue = 'Simple weapons and Martial weapons that have the Finesse or Light property';
    expect(proficientWith(weapon('Rapier'), rogue)).toBe(true);
    expect(proficientWith(weapon('Hand Crossbow'), rogue)).toBe(true);
    expect(proficientWith(weapon('Longsword'), rogue)).toBe(false);
  });

  it('reads weapons named one by one, and nothing from nothing', () => {
    expect(proficientWith(weapon('Longsword'), 'Daggers, Longswords')).toBe(true);
    expect(proficientWith(weapon('Rapier'), 'Daggers, Longswords')).toBe(false);
    expect(proficientWith(weapon('Club'), '')).toBe(false);
  });
});
