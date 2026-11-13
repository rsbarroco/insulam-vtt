/**
 * What features let a character do on its turn, read from the sheets the
 * guided builder writes.
 */

import { RULES_AS_WRITTEN } from '../../../utils/characterRules';
import { buildCharacter, type CharacterChoices } from '../buildCharacter';
import { attacksPerAction, featureName, featureOptions, readFeatures } from '../featureEffects';

const base: CharacterChoices = {
  name: 'Brann', species: 'Human', background: 'Soldier', classes: ['Fighter'], level: 1,
  abilityScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundIncreases: { str: 2, con: 1 }, originFeat: 'Savage Attacker', skills: ['perception', 'survival'], improvements: [],
};
const asi = (level: number) => ({ level, feat: 'Ability Score Improvement', featPoints: { wis: 1, cha: 1 } });
const sheetOf = (choices: Partial<CharacterChoices>) => {
  const built = buildCharacter({ ...base, ...choices }, RULES_AS_WRITTEN);
  if (!built.ok) throw new Error(built.errors.join(' | '));
  return built.sheet;
};
const featuresOf = (choices: Partial<CharacterChoices>) => readFeatures(sheetOf(choices));

describe('reading a sheet’s features', () => {
  it('takes the name without where it came from', () => {
    expect(featureName('Second Wind (Fighter 1)')).toBe('Second Wind');
    expect(featureName('Darkvision (Dwarf)')).toBe('Darkvision');
    expect(featureName('Alert (Origin feat)')).toBe('Alert');
    expect(featureName('Fire Breath (Recharge 5–6)')).toBe('Fire Breath (Recharge 5–6)');
    expect(featureName('Lucky')).toBe('Lucky');
  });

  it('reads both shapes a sheet stores a feature in', () => {
    expect(readFeatures({ featuresAndTraits: ['Lucky', { name: ' Rage ', description: 'x' }, { name: '' }, 7, ''] })).toEqual([
      { name: 'Lucky', description: '' },
      { name: 'Rage', description: 'x' },
    ]);
    expect(readFeatures(null)).toEqual([]);
  });
});

describe('attacks with the Attack action', () => {
  it('is one until Extra Attack, then two', () => {
    expect(attacksPerAction(featuresOf({ level: 4, improvements: [asi(4)] }))).toBe(1);
    expect(attacksPerAction(featuresOf({ level: 5, improvements: [asi(4)] }))).toBe(2);
  });

  it('follows a Fighter to three and four attacks', () => {
    const levels = [4, 6, 8, 12, 14, 16];
    const improvements = [...levels.map(asi), { level: 19, feat: 'Boon of Fate', featPoints: { int: 1 } }];
    expect(attacksPerAction(featuresOf({ level: 11, improvements: improvements.filter((choice) => choice.level <= 11) }))).toBe(3);
    expect(attacksPerAction(featuresOf({ level: 20, improvements }))).toBe(4);
  });

  it('is one for a class that never gets Extra Attack, and for a hand-written sheet', () => {
    expect(attacksPerAction(featuresOf({ classes: ['Wizard'], skills: ['arcana', 'history'], level: 5, improvements: [asi(4)] }))).toBe(1);
    expect(attacksPerAction(readFeatures({ featuresAndTraits: ['Extra Attack'] }))).toBe(2);
    expect(attacksPerAction([])).toBe(1);
  });
});

describe('features used with a Bonus Action or a Reaction', () => {
  it('lists what a Fighter can do with its Bonus Action', () => {
    const options = featureOptions(featuresOf({ level: 2 }));
    expect(options.filter((option) => option.cost === 'bonusAction').map((option) => option.name)).toEqual(['Second Wind']);
    expect(options.find((option) => option.name === 'Second Wind')?.text).toContain('1d10');
  });

  it('lists a Rogue’s Cunning Action and a Barbarian’s Rage', () => {
    const rogue = featureOptions(featuresOf({ classes: ['Rogue'], skills: ['stealth', 'acrobatics', 'deception', 'insight'], level: 5, improvements: [asi(4)] }));
    expect(rogue.filter((option) => option.cost === 'bonusAction').map((option) => option.name)).toEqual(expect.arrayContaining(['Cunning Action', 'Steady Aim']));
    expect(rogue.filter((option) => option.cost === 'reaction').map((option) => option.name)).toContain('Uncanny Dodge');
    const barbarian = featureOptions(featuresOf({ classes: ['Barbarian'], skills: ['perception', 'survival'], level: 1 }));
    expect(barbarian.map((option) => `${option.name}:${option.cost}`)).toContain('Rage:bonusAction');
  });

  it('leaves out a feature that is always on', () => {
    const names = featureOptions(featuresOf({ level: 5, improvements: [asi(4)] })).map((option) => option.name);
    expect(names).not.toContain('Extra Attack');
    expect(names).not.toContain('Weapon Mastery');
  });
});

describe('a reaction the server resolves', () => {
  it('is listed by its name when the sheet gives no text for it', () => {
    expect(featureOptions([{ name: 'Uncanny Dodge (Rogue 5)', description: '' }])).toEqual([
      { name: 'Uncanny Dodge', cost: 'reaction', text: '' },
    ]);
    expect(featureOptions([{ name: 'Fast Hands', description: '' }])).toEqual([]);
  });
});
