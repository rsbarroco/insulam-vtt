/**
 * The guided D&D builder's state: what the form offers under a campaign's
 * rules, and the choices it sends the server.
 */

import { describe, it, expect } from 'vitest';
import type { DndClassSummary, DndFeat, DndFeatureChoice, DndRulesCatalogue } from '@/types';
import { DEFAULT_CHARACTER_RULES, RULES_AS_WRITTEN } from '@/utils/characterRules';
import {
  backgroundAbilities,
  backgroundPoints,
  carriedWeapons,
  choiceOptions,
  dueChoices,
  dueImprovements,
  featsFor,
  initialState,
  masteryWeapons,
  missing,
  originFeats,
  skillChoices,
  spellAllowances,
  spellOptions,
  spellPicks,
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

describe('the options of features', () => {
  const style = (id: string, cls: string, level: number): DndFeatureChoice => ({
    id, title: 'Fighting Style', class: cls, level, counts: Array.from({ length: 20 }, (_, at) => (at + 1 >= level ? 1 : 0)),
    writes: 'adds', asked: true,
    options: ['Archery', 'Defense'].map((name) => ({ label: name, name: `${name} (Fighting Style feat)` })),
  });
  const withChoices = (): DndRulesCatalogue => ({
    ...catalogue(),
    featureChoices: [
      { id: 'ancestry', title: 'Draconic Ancestry', species: 'Dwarf', level: 1, counts: [], writes: 'race', asked: true,
        options: [{ label: 'Red', name: 'Dwarf (Red)' }, { label: 'Blue', name: 'Dwarf (Blue)' }] },
      style('fighterStyle', 'Fighter', 1),
      style('wizardStyle', 'Wizard', 3),
      { id: 'invocations', title: 'Eldritch Invocations', class: 'Fighter', level: 1, counts: Array(20).fill(2), writes: 'adds', asked: true,
        options: [
          { label: 'Pact of the Blade', name: 'Pact of the Blade', group: 'Pact of the Blade' },
          { label: 'Pact of the Blade (Longsword)', name: 'Pact of the Blade (Longsword)', group: 'Pact of the Blade' },
          { label: 'Thirsting Blade', name: 'Thirsting Blade', group: 'Thirsting Blade', needs: 'Pact of the Blade', minLevel: 5 },
          { label: 'Eldritch Mind', name: 'Eldritch Mind', group: 'Eldritch Mind' },
        ] },
      { id: 'boon', title: 'Boon', feat: 'Boon of Fate', level: 1, counts: [], writes: 'renames', asked: false, options: [] },
    ],
  });

  it('asks those the species and the classes give at the level, and not those the build works out', () => {
    expect(dueChoices(chosen(), withChoices()).map((due) => [due.choice.id, due.count])).toEqual([
      ['ancestry', 1], ['fighterStyle', 1], ['wizardStyle', 1], ['invocations', 2],
    ]);
    expect(dueChoices(chosen({ level: 2, species: '' }), withChoices()).map((due) => due.choice.id)).toEqual(['fighterStyle', 'invocations']);
  });

  it('offers each slot what is left: not another slot’s option, another choice’s name, a level too high, or what needs a missing option', () => {
    const state = chosen({ level: 5, featureChoices: { fighterStyle: ['Archery'], invocations: ['Pact of the Blade (Longsword)', ''] } });
    const due = dueChoices(state, withChoices());
    const of = (id: string, slot = 0) => choiceOptions(state, withChoices(), due.find((entry) => entry.choice.id === id)!, slot).map((option) => option.label);
    expect(of('wizardStyle')).toEqual(['Defense']);
    expect(of('invocations', 1)).toEqual(['Thirsting Blade', 'Eldritch Mind']);
    expect(of('invocations', 0)).toEqual(['Pact of the Blade', 'Pact of the Blade (Longsword)', 'Eldritch Mind']);
    const low = chosen({ level: 4, featureChoices: { invocations: ['Pact of the Blade', ''] } });
    expect(choiceOptions(low, withChoices(), dueChoices(low, withChoices())[3], 1).map((option) => option.label)).toEqual(['Eldritch Mind']);
  });

  it('sends the picks, and says which are still to choose', () => {
    const state = chosen({ featureChoices: { ancestry: ['Red'], fighterStyle: ['Archery'], invocations: ['Eldritch Mind', ''] } });
    expect(toChoices('Brann', state, withChoices()).featureChoices).toEqual({ ancestry: ['Red'], fighterStyle: ['Archery'], invocations: ['Eldritch Mind'] });
    expect(missing('Brann', state, withChoices())).toEqual(['Fighting Style', '1 of Eldritch Invocations']);
    expect(missing('Brann', chosen(), withChoices())[0]).toBe('the Draconic Ancestry');
    expect(toChoices('Brann', chosen(), withChoices())).not.toHaveProperty('featureChoices');
  });
});

describe('the starting equipment and the spells', () => {
  const fighterKit = [
    { option: 'A', gold: 4, text: 'Chain Mail, Greatsword, 8 Javelins, and 4 GP', items: [
      { name: 'Chain Mail', quantity: 1, armor: 'Chain Mail' }, { name: 'Greatsword', quantity: 1, weapon: 'Greatsword' },
      { name: 'Javelin', quantity: 8, weapon: 'Javelin' },
    ] },
    { option: 'B', gold: 155, text: '155 GP', items: [] },
  ];
  const spell = (name: string, level: number, classes: string[]) => ({ name, level, classes, school: 'Evocation', ritual: false, concentration: false });
  const casting = (): DndRulesCatalogue => {
    const base = catalogue();
    return {
      ...base,
      backgrounds: [{ ...base.backgrounds[0], startingEquipment: [
        { option: 'A', gold: 14, text: 'Spear, Shortbow, 14 GP', items: [{ name: 'Spear', quantity: 1, weapon: 'Spear' }, { name: 'Shortbow', quantity: 1, weapon: 'Shortbow' }] },
        { option: 'B', gold: 50, text: '50 GP', items: [] },
      ] }],
      classes: base.classes.map((entry) =>
        entry.name === 'Fighter'
          ? { ...entry, coreTraits: { 'Weapon Proficiencies': 'Simple and Martial weapons' }, startingEquipment: fighterKit, weaponMastery: Array(20).fill(3), spellcasting: null }
          : entry.name === 'Wizard'
            ? { ...entry, coreTraits: { 'Weapon Proficiencies': 'Simple weapons' }, weaponMastery: Array(20).fill(0), spellcasting: {
              cantrips: Array(20).fill(2), prepared: Array(20).fill(2), maxSpellLevel: [1, 1, 2, ...Array(17).fill(2)],
              spellbook: Array.from({ length: 20 }, (_, at) => 3 + at), alwaysPrepared: [{ level: 3, spell: 'Shield' }],
            } }
            : entry
      ),
      spells: [
        spell('Fire Bolt', 0, ['Wizard']), spell('Light', 0, ['Wizard', 'Cleric']), spell('Sacred Flame', 0, ['Cleric']),
        spell('Magic Missile', 1, ['Wizard']), spell('Shield', 1, ['Wizard']), spell('Sleep', 1, ['Wizard']), spell('Grease', 1, ['Wizard']),
        spell('Web', 2, ['Wizard']),
      ],
    };
  };

  it('carries the weapons of the packages chosen, and offers the ones Weapon Mastery can take', () => {
    const state = chosen({ classEquipment: 'A', backgroundEquipment: 'A' });
    expect(carriedWeapons(state, casting())).toEqual(['Greatsword', 'Javelin', 'Spear', 'Shortbow']);
    expect(masteryWeapons(state, casting())).toEqual(['Greatsword', 'Javelin', 'Spear', 'Shortbow']);
    expect(carriedWeapons(chosen({ classEquipment: 'B', backgroundEquipment: 'B' }), casting())).toEqual([]);
  });

  it('counts each casting class’s picks by its table, of the levels it has slots for', () => {
    const [wizard] = spellAllowances(chosen({ level: 1 }), casting());
    expect(wizard).toEqual({ class: 'Wizard', cantrips: 2, prepared: 2, maxSpellLevel: 1, spellbook: 3, alwaysPrepared: [] });
    const at3 = spellAllowances(chosen({ level: 3 }), casting())[0];
    expect(at3.alwaysPrepared).toEqual(['Shield']);
    // At level 3: level 2 spells, and not Shield, which a feature prepares.
    expect(spellOptions(chosen({ level: 3 }), casting(), at3).spells.map((entry) => entry.name)).toEqual(['Magic Missile', 'Sleep', 'Grease', 'Web']);
    expect(spellOptions(chosen({ level: 1 }), casting(), wizard).cantrips.map((entry) => entry.name)).toEqual(['Fire Bolt', 'Light']);
  });

  it('prepares a Wizard’s spells from its book, and drops picks the level no longer allows', () => {
    const state = chosen({ level: 1, spells: { Wizard: { cantrips: ['Fire Bolt', 'Light'], spellbook: ['Magic Missile', 'Sleep', 'Web', 'Grease'], prepared: ['Sleep', 'Shield', 'Web'] } } });
    const [wizard] = spellAllowances(state, casting());
    expect(spellOptions(state, casting(), wizard).prepared.map((entry) => entry.name)).toEqual(['Magic Missile', 'Sleep', 'Grease']);
    expect(spellPicks(state, casting(), wizard)).toEqual({ cantrips: ['Fire Bolt', 'Light'], spellbook: ['Magic Missile', 'Sleep', 'Grease'], prepared: ['Sleep'] });
  });

  it('sends the equipment, the masteries and the spells, and says what is missing', () => {
    const state = chosen({
      level: 1,
      classEquipment: 'A',
      backgroundEquipment: 'A',
      masteries: ['Greatsword', 'Longsword'],
      spells: { Wizard: { cantrips: ['Fire Bolt', 'Light'], spellbook: ['Magic Missile', 'Sleep', 'Grease'], prepared: ['Sleep', 'Grease'] } },
    });
    expect(toChoices('Brann', state, casting())).toMatchObject({
      equipment: { class: 'A', background: 'A' },
      masteries: ['Greatsword'],
      spells: [{ class: 'Wizard', cantrips: ['Fire Bolt', 'Light'], spellbook: ['Magic Missile', 'Sleep', 'Grease'], prepared: ['Sleep', 'Grease'] }],
    });
    expect(missing('Brann', { ...state, improvements: {} }, casting())).toEqual([]);
    expect(missing('Brann', { ...state, improvements: {}, classEquipment: '', spells: {} }, casting())).toEqual([
      'the Fighter\'s starting equipment', '2 cantrips for Wizard', '3 spells in the spellbook for Wizard', '2 prepared spells for Wizard',
    ]);
    // A catalogue without equipment or spells asks for neither.
    expect(toChoices('Brann', chosen(), catalogue())).not.toHaveProperty('spells');
  });
});
