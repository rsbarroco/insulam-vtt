/**
 * Backgrounds, species and feats of the SRD 5.2.1, and what the campaign's
 * house rules change about a character's origin.
 */

import { DEFAULT_CHARACTER_RULES as house, RULES_AS_WRITTEN as written } from '../../../utils/characterRules';
import {
  allBackgrounds, allFeats, allSpecies, backgroundAbilities, backgroundIncreaseRefusal, featsOf, findBackground, findFeat,
  findSpecies, originFeatChoices,
} from '../origins';

const tens = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
const soldier = findBackground('Soldier')!;

describe('the catalogue', () => {
  it('holds the backgrounds, species and feats of the document, each one whole', () => {
    expect(allBackgrounds().map((b) => b.name)).toEqual(['Acolyte', 'Criminal', 'Sage', 'Soldier']);
    expect(allSpecies().map((s) => s.name)).toEqual(['Dragonborn', 'Dwarf', 'Elf', 'Gnome', 'Goliath', 'Halfling', 'Human', 'Orc', 'Tiefling']);
    expect(allFeats()).toHaveLength(17);
    for (const background of allBackgrounds()) {
      expect(background.abilityScores).toHaveLength(3);
      expect(background.skillProficiencies).toHaveLength(2);
      expect(findFeat(background.feat)?.category).toBe('Origin');
      expect(background.equipment).toMatch(/^Choose A or B: .*50 GP$/);
    }
    for (const species of allSpecies()) {
      expect(species.creatureType).toBe('Humanoid');
      expect(species.speedFeet).toBeGreaterThanOrEqual(30);
      expect(species.traits.length).toBeGreaterThanOrEqual(3);
      for (const trait of species.traits) expect(trait.text).toMatch(/[.:]$/);
    }
    for (const feat of allFeats()) expect(feat.description || feat.benefits.length).toBeTruthy();
  });

  it('sorts the feats into their categories', () => {
    expect(featsOf('Origin').map((f) => f.name)).toEqual(['Alert', 'Magic Initiate', 'Savage Attacker', 'Skilled']);
    expect(featsOf('General').map((f) => f.name)).toEqual(['Ability Score Improvement', 'Grappler']);
    expect(featsOf('Fighting Style')).toHaveLength(4);
    expect(featsOf('Epic Boon')).toHaveLength(7);
    expect(findFeat('Grappler')).toMatchObject({ prerequisite: 'Level 4+, Strength or Dexterity 13+', repeatable: null });
    expect(findFeat('Skilled')?.repeatable).toBe('You can take this feat more than once.');
  });

  it('keeps the choices a trait offers, and its tables', () => {
    expect(findSpecies('Goliath')?.traits[0].options).toHaveLength(6);
    expect(findSpecies('Gnome')?.traits.find((t) => t.name === 'Gnomish Lineage')?.options?.map((o) => o.name)).toEqual(['Forest Gnome', 'Rock Gnome']);
    expect(findSpecies('Dragonborn')?.tables?.['Draconic Ancestors']).toHaveLength(10);
    expect(findSpecies('Elf')?.tables?.['Elven Lineages'].map((row) => [row.name, row.level3, row.level5])).toEqual([
      ['Drow', 'Faerie Fire', 'Darkness'],
      ['High Elf', 'Detect Magic', 'Misty Step'],
      ['Wood Elf', 'Longstrider', 'Pass without Trace'],
    ]);
    expect(findSpecies('Tiefling')?.tables?.['Fiendish Legacies']).toHaveLength(3);
  });

  it('finds by name whatever the case, and a feat with its choice in brackets', () => {
    expect(findSpecies('high elf')).toBeNull();
    expect(findSpecies('ELF')?.name).toBe('Elf');
    expect(findFeat('Magic Initiate (Wizard)')?.name).toBe('Magic Initiate');
    expect(findBackground('Noble')).toBeNull();
  });
});

describe('the house rules of an origin', () => {
  it('lets a background raise any score, or only its three as written', () => {
    expect(backgroundAbilities(soldier, written)).toEqual(['str', 'dex', 'con']);
    expect(backgroundAbilities(soldier, house)).toHaveLength(6);
  });

  it('offers any origin feat, or only the background’s as written', () => {
    expect(originFeatChoices(soldier, written).map((f) => f.name)).toEqual(['Savage Attacker']);
    expect(originFeatChoices(soldier, house).map((f) => f.name)).toEqual(['Alert', 'Magic Initiate', 'Savage Attacker', 'Skilled']);
  });

  it('takes +2 and +1, or +1 three times', () => {
    expect(backgroundIncreaseRefusal({ str: 2, con: 1 }, tens, soldier, written)).toBeNull();
    expect(backgroundIncreaseRefusal({ str: 1, dex: 1, con: 1 }, tens, soldier, written)).toBeNull();
    expect(backgroundIncreaseRefusal({ str: 2, con: 2 }, tens, soldier, written)).toMatch(/\+2 to one/);
    expect(backgroundIncreaseRefusal({ str: 3 }, tens, soldier, written)).toMatch(/\+2 to one/);
    expect(backgroundIncreaseRefusal({}, tens, soldier, written)).toMatch(/\+2 to one/);
  });

  it('keeps to the scores the background names unless the campaign frees them', () => {
    expect(backgroundIncreaseRefusal({ cha: 2, int: 1 }, tens, soldier, written)).toBe('Soldier raises only Strength, Dexterity, Constitution');
    expect(backgroundIncreaseRefusal({ cha: 2, int: 1 }, tens, soldier, house)).toBeNull();
  });

  it('stops at the campaign’s cap', () => {
    const strong = { ...tens, str: 19 };
    expect(backgroundIncreaseRefusal({ str: 2, con: 1 }, strong, soldier, written)).toBe('A background cannot raise an ability score above 20');
    expect(backgroundIncreaseRefusal({ str: 2, con: 1 }, strong, soldier, house)).toBeNull();
    expect(backgroundIncreaseRefusal({ str: 2, con: 1 }, { ...tens, str: 21 }, soldier, house)).toBe('A background cannot raise an ability score above 22');
  });
});
