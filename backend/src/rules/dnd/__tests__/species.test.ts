import {
  darkvisionFeet,
  endure,
  hasLuck,
  hasRelentlessEndurance,
  lucky,
  speciesOf,
  speciesResistances,
} from '../species';
import { resourcesOf, restoreResources } from '../resources';

describe('speciesOf', () => {
  it('reads the species a sheet names, and the choice in parentheses', () => {
    expect(speciesOf({ race: 'Dragonborn (Red)' })).toMatchObject({
      species: { name: 'Dragonborn' },
      choice: 'Red',
    });
    expect(speciesOf({ race: 'dwarf' })).toMatchObject({
      species: { name: 'Dwarf' },
      choice: null,
    });
    expect(speciesOf({ race: 'Warforged' })).toBeNull();
    expect(speciesOf(null)).toBeNull();
  });
});

describe('darkvisionFeet', () => {
  it('is the range of the Darkvision trait', () => {
    expect(darkvisionFeet({ race: 'Dwarf' })).toBe(120);
    expect(darkvisionFeet({ race: 'Orc' })).toBe(120);
    expect(darkvisionFeet({ race: 'Elf' })).toBe(60);
    expect(darkvisionFeet({ race: 'Human' })).toBe(0);
  });
});

describe('speciesResistances', () => {
  it('gives a Dwarf Poison, a Dragonborn its ancestry’s, a Tiefling its legacy’s', () => {
    expect(speciesResistances({ race: 'Dwarf' })).toEqual(['poison']);
    expect(speciesResistances({ race: 'Dragonborn (Silver)' })).toEqual(['cold']);
    expect(speciesResistances({ race: 'Dragonborn' })).toEqual([]);
    expect(speciesResistances({ race: 'Tiefling (Infernal)' })).toEqual(['fire']);
    expect(speciesResistances({ race: 'Halfling' })).toEqual([]);
  });
});

describe('Luck', () => {
  it('belongs to a Halfling, and rolls a 1 on a d20 again', () => {
    expect(hasLuck({ race: 'Halfling' })).toBe(true);
    expect(hasLuck({ race: 'Gnome' })).toBe(false);
    const rolls = [1, 14];
    const roll = lucky(() => rolls.shift()!);
    expect(roll(20)).toBe(14);
    const damage = lucky(() => 1);
    expect(damage(6)).toBe(1);
  });
});

describe('Relentless Endurance', () => {
  it('keeps an Orc at 1 Hit Point unless killed outright', () => {
    expect(hasRelentlessEndurance({ race: 'Orc' })).toBe(true);
    expect(endure({ current: 10, max: 20, temp: 0 }, 15, 0)).toBe(1);
    expect(endure({ current: 10, max: 20, temp: 0 }, 30, 0)).toBeNull();
    expect(endure({ current: 10, max: 20, temp: 0 }, 5, 5)).toBeNull();
    expect(endure({ current: 0, max: 20, temp: 0 }, 5, 0)).toBeNull();
  });

  it('is a use that comes back on a Long Rest only', () => {
    const orc = {
      race: 'Orc',
      class: 'Fighter',
      level: 1,
      featureUses: { 'Relentless Endurance': 1 },
    };
    expect(resourcesOf(orc).find((r) => r.name === 'Relentless Endurance')).toMatchObject({
      max: 1,
      used: 1,
    });
    expect(restoreResources(orc, 'short').sheet.featureUses).toMatchObject({
      'Relentless Endurance': 1,
    });
    expect(restoreResources(orc, 'long').sheet.featureUses).toEqual({});
  });
});
