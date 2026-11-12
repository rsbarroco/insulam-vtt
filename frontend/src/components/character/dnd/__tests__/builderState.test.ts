/**
 * The guided D&D builder's state: what the form offers under a campaign's
 * rules, and the choices it sends the server.
 */

import { describe, it, expect } from 'vitest';
import type { DndClassSummary, DndFeat, DndRulesCatalogue } from '@/types';
import { DEFAULT_CHARACTER_RULES, RULES_AS_WRITTEN } from '@/utils/characterRules';
import {
  backgroundAbilities,
  backgroundPoints,
  dueImprovements,
  featsFor,
  initialState,
  missing,
  originFeats,
  skillChoices,
  toChoices,
  totalScores,
  type BuilderState,
} from '../builderState';

const feat = (name: string, category: DndFeat['category'], abilityPoints: DndFeat['abilityPoints'] = null): DndFeat => ({
  id: name.toLowerCase(), name, category, prerequisite: null, description: '', benefits: [], repeatable: null, abilityPoints,
});
const cls = (name: string, among: string[] | 'any', count: number, levels: number[]): DndClassSummary => ({
  id: name.toLowerCase(), name, coreTraits: {}, hitDie: 8, savingThrows: ['str', 'con'], caster: null,
  skillChoices: { count, among }, featuresByLevel: [], subclass: '',
  improvements: [
    ...levels.map((level) => ({ level, kind: 'both' as const, abilityPoints: 2 })),
    { level: 19, kind: 'epicBoon' as const, abilityPoints: 0 },
  ],
});

const catalogue = (rules = DEFAULT_CHARACTER_RULES): DndRulesCatalogue => ({
  source: 'SRD',
  characterRules: rules,
  species: [{ id: 'dwarf', name: 'Dwarf', creatureType: 'Humanoid', size: 'Medium', speedFeet: 30, traits: [] }],
  backgrounds: [{
    id: 'soldier', name: 'Soldier', abilityScores: ['Strength', 'Dexterity', 'Constitution'], feat: 'Savage Attacker',
    skillProficiencies: ['Athletics', 'Intimidation'], toolProficiency: 'Gaming Set', equipment: '',
  }],
  feats: [
    feat('Alert', 'Origin'), feat('Savage Attacker', 'Origin'),
    feat('Grappler', 'General', { total: 1, among: ['str', 'dex'], cap: 22 }),
    feat('Boon of Fate', 'Epic Boon', { total: 1, among: ['str', 'dex', 'con', 'int', 'wis', 'cha'], cap: 30 }),
  ],
  classes: [
    cls('Fighter', ['athletics', 'perception', 'survival', 'history'], 2, [4, 6, 8]),
    cls('Wizard', ['arcana', 'history', 'insight'], 2, [4, 8]),
    cls('Bard', 'any', 3, [4, 8]),
  ],
});

const chosen = (patch: Partial<BuilderState> = {}): BuilderState => ({
  ...initialState(), species: 'Dwarf', background: 'Soldier', classA: 'Fighter', classB: 'Wizard', level: 4,
  backgroundPicks: ['int', 'str', ''], originFeat: 'Alert', skills: ['arcana', 'perception'],
  improvements: { '4:both': { feat: 'Grappler', featPicks: ['str'], extraPicks: ['int', 'int'] } },
  ...patch,
});

describe('what the form offers', () => {
  it('lists the levels that give a feat, once where both classes give one', () => {
    expect(dueImprovements(chosen({ level: 8 }), catalogue()).map((gain) => gain.level)).toEqual([4, 6, 8]);
    expect(dueImprovements(chosen({ level: 3 }), catalogue())).toEqual([]);
    expect(dueImprovements(chosen({ level: 20, classB: '' }), catalogue()).map((gain) => `${gain.level}:${gain.kind}`)).toContain('19:epicBoon');
  });

  it('offers the skills of both classes, without the background’s, counted by the first class', () => {
    expect(skillChoices(chosen(), catalogue())).toEqual({ count: 2, among: ['arcana', 'history', 'insight', 'perception', 'survival'] });
    const bard = skillChoices(chosen({ classA: 'Bard', classB: '' }), catalogue());
    expect(bard.count).toBe(3);
    expect(bard.among).toHaveLength(16);
  });

  it('follows the campaign’s rules for the background', () => {
    expect(backgroundAbilities(chosen(), catalogue())).toHaveLength(6);
    expect(backgroundAbilities(chosen(), catalogue(RULES_AS_WRITTEN))).toEqual(['str', 'dex', 'con']);
    expect(originFeats(chosen(), catalogue()).map((f) => f.name)).toEqual(['Alert', 'Savage Attacker']);
    expect(originFeats(chosen(), catalogue(RULES_AS_WRITTEN)).map((f) => f.name)).toEqual(['Savage Attacker']);
  });

  it('keeps Epic Boons for level 19 and later', () => {
    expect(featsFor({ level: 4, kind: 'both', abilityPoints: 2 }, catalogue()).map((f) => f.name)).not.toContain('Boon of Fate');
    expect(featsFor({ level: 19, kind: 'epicBoon', abilityPoints: 0 }, catalogue()).map((f) => f.name)).toContain('Boon of Fate');
  });
});

describe('what the form sends', () => {
  it('spreads the background’s points either way', () => {
    expect(backgroundPoints(chosen())).toEqual({ int: 2, str: 1 });
    expect(backgroundPoints(chosen({ backgroundSpread: '1+1+1', backgroundPicks: ['str', 'dex', 'con'] }))).toEqual({ str: 1, dex: 1, con: 1 });
  });

  it('adds everything chosen to the scores it shows', () => {
    // Strength 15 + 1 (background) + 1 (Grappler); Intelligence 12 + 2 (background) + 2 (level 4).
    expect(totalScores(chosen(), catalogue())).toMatchObject({ str: 17, int: 16, dex: 14 });
  });

  it('turns the form into the server’s choices', () => {
    expect(toChoices('  Brann ', chosen(), catalogue())).toEqual({
      name: 'Brann', species: 'Dwarf', background: 'Soldier', classes: ['Fighter', 'Wizard'], level: 4,
      abilityScores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      backgroundIncreases: { int: 2, str: 1 }, originFeat: 'Alert', skills: ['arcana', 'perception'],
      improvements: [{ level: 4, feat: 'Grappler', featPoints: { str: 1 }, abilityPoints: { int: 2 } }],
    });
  });

  it('leaves out an improvement of a level the character no longer has', () => {
    expect(toChoices('Brann', chosen({ level: 3 }), catalogue()).improvements).toEqual([]);
  });

  it('says what is still to choose, in the order of the form', () => {
    expect(missing('Brann', chosen(), catalogue())).toEqual([]);
    expect(missing('', initialState(), catalogue())).toEqual([
      'a name', 'a species', 'a background', 'a class', 'the background’s ability scores', 'an origin feat',
    ]);
    expect(missing('Brann', chosen({ skills: ['arcana'], improvements: {} }), catalogue())).toEqual(['2 skills', 'the level 4 feat']);
    expect(missing('Brann', chosen({ improvements: { '4:both': { feat: 'Grappler', featPicks: [''], extraPicks: ['int', 'int'] } } }), catalogue())).toEqual(['the level 4 feat']);
  });
});
