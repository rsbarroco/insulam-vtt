/**
 * The classes of the SRD 5.2.1: that the build kept every class whole, and
 * that the numbers advancement.ts computes from agree with the document.
 */

import { CLASSES, CLASS_NAMES, spellSlots } from '../advancement';
import { allClasses, buildFeatures, columnAt, featuresUpTo, findClass } from '../classes';

const ABILITY = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' } as const;

describe('the catalogue', () => {
  it('holds the twelve classes, each one whole', () => {
    expect(allClasses().map((c) => c.name)).toEqual([...CLASS_NAMES]);
    for (const c of allClasses()) {
      expect(c.featuresByLevel).toHaveLength(20);
      for (const values of Object.values(c.columns)) expect(values).toHaveLength(20);
      for (const label of ['Primary Ability', 'Hit Point Die', 'Saving Throw Proficiencies', 'Skill Proficiencies', 'Weapon Proficiencies', 'Armor Training', 'Starting Equipment']) {
        expect(c.coreTraits[label]).toBeTruthy();
      }
      expect(c.subclass.name).toBeTruthy();
      expect(c.subclass.features.length).toBeGreaterThanOrEqual(4);
      expect(c.subclass.features[0].level).toBe(3);
      for (const feature of [...c.features, ...c.subclass.features]) {
        expect(feature.text.length).toBeGreaterThan(0);
        expect(feature.level).toBeGreaterThanOrEqual(1);
        expect(feature.level).toBeLessThanOrEqual(20);
      }
    }
  });

  it('has a heading for every feature its table names', () => {
    for (const c of allClasses()) {
      c.featuresByLevel.forEach((names, index) => {
        for (const listed of names) {
          if (listed === 'Subclass feature') continue;
          // "Action Surge (two uses)" is a later line of the Action Surge feature.
          const name = listed.replace(/ \(.*\)$/, '');
          expect([c.name, listed, c.features.some((f) => f.name === name && f.level <= index + 1)]).toEqual([c.name, listed, true]);
        }
      });
    }
  });

  it('gives a subclass, an improvement at 4 and an Epic Boon at 19 to every class', () => {
    for (const c of allClasses()) {
      expect(c.features.find((f) => f.name === `${c.name} Subclass`)?.level).toBe(3);
      expect(c.features.find((f) => f.name === 'Ability Score Improvement')?.level).toBe(4);
      expect(c.features.find((f) => f.name === 'Epic Boon')?.level).toBe(19);
    }
  });

  it('keeps the lists of options apart, each option with its cost or prerequisite', () => {
    const metamagic = findClass('Sorcerer')!.optionLists[0];
    expect(metamagic.name).toBe('Metamagic Options');
    expect(metamagic.options).toHaveLength(10);
    expect(metamagic.options.find((o) => o.name === 'Quickened Spell')?.cost).toBe('2 Sorcery Points');
    const invocations = findClass('warlock')!.optionLists[0];
    expect(invocations.options).toHaveLength(28);
    expect(invocations.options.find((o) => o.name === 'Thirsting Blade')?.prerequisite).toBe('Level 5+ Warlock, Pact of the Blade Invocation');
    expect(invocations.options.every((o) => o.text.length > 0)).toBe(true);
  });
});

describe('the numbers of advancement.ts', () => {
  it('agree with the Core Traits of the document', () => {
    for (const name of CLASS_NAMES) {
      const core = findClass(name)!.coreTraits;
      expect(core['Hit Point Die']).toBe(`D${CLASSES[name].hitDie} per ${name} level`);
      expect(core['Saving Throw Proficiencies']).toBe(CLASSES[name].saves.map((ability) => ABILITY[ability]).join(' and '));
    }
  });

  it('agree with the improvement levels each class names', () => {
    for (const name of CLASS_NAMES) {
      const levels = findClass(name)!.featuresByLevel.flatMap((names, index) => (names.includes('Ability Score Improvement') ? [index + 1] : []));
      expect([name, levels]).toEqual([name, [...CLASSES[name].improvements]]);
    }
  });

  it('agree with the spell slots of every caster', () => {
    for (const name of CLASS_NAMES) {
      if (CLASSES[name].caster !== 'full' && CLASSES[name].caster !== 'half') continue;
      for (let level = 1; level <= 20; level++) {
        const printed = Array.from({ length: 9 }, (_, slot) => Number(columnAt(name, `Spell Slots Level ${slot + 1}`, level)?.replace('—', '0') ?? 0));
        expect([name, level, spellSlots([name], level)]).toEqual([name, level, printed]);
      }
    }
  });
});

describe('reading a class', () => {
  it('lists what a class has given by a level, with its subclass', () => {
    expect(featuresUpTo('Barbarian', 3).map((f) => f.name)).toEqual([
      'Rage', 'Unarmored Defense', 'Weapon Mastery', 'Danger Sense', 'Reckless Attack', 'Barbarian Subclass', 'Primal Knowledge', 'Frenzy',
    ]);
    expect(featuresUpTo('Barbarian', 3, false).map((f) => f.name)).not.toContain('Frenzy');
  });

  it('reads a column of the features table', () => {
    expect(columnAt('Barbarian', 'Rages', 1)).toBe('2');
    expect(columnAt('Rogue', 'Sneak Attack', 5)).toBe('3d6');
    expect(columnAt('Sorcerer', 'Sorcery Points', 1)).toBe('—');
    expect(columnAt('Fighter', 'Rages', 5)).toBeNull();
  });

  it('gives a gestalt character the features of both classes, and what does not stack once', () => {
    const built = buildFeatures(['Fighter', 'Barbarian'], 5);
    const names = built.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['Second Wind', 'Rage', 'Action Surge', 'Reckless Attack', 'Fast Movement']));
    expect(names.filter((name) => name === 'Extra Attack')).toHaveLength(1);
    expect(names.filter((name) => name === 'Ability Score Improvement')).toHaveLength(1);
    // Each class's own Weapon Mastery is its own feature.
    expect(names.filter((name) => name === 'Weapon Mastery')).toHaveLength(2);
    expect(built.find((f) => f.name === 'Rage')?.from).toBe('Barbarian');
  });
});
