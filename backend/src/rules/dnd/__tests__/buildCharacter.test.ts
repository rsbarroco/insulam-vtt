/**
 * Building a character from its choices: what the rules allow, what the
 * campaign's house rules change, and the sheet that comes out.
 */

import { DEFAULT_CHARACTER_RULES as house, RULES_AS_WRITTEN as written } from '../../../utils/characterRules';
import { dnd5eCharacterDataSchema } from '../../../validators/game-systems/dnd5e.schema';
import { buildCharacter, classSkillChoices, featPointsRule, skillKey, type CharacterChoices } from '../buildCharacter';
import { findFeat } from '../origins';

const fighter: CharacterChoices = {
  name: 'Brann',
  species: 'Dwarf',
  background: 'Soldier',
  classes: ['Fighter'],
  level: 1,
  abilityScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundIncreases: { str: 2, con: 1 },
  originFeat: 'Savage Attacker',
  skills: ['perception', 'survival'],
  improvements: [],
};

const built = (choices: CharacterChoices, rules = written) => {
  const result = buildCharacter(choices, rules);
  if (!result.ok) throw new Error(result.errors.join(' | '));
  return result;
};
const errors = (choices: CharacterChoices, rules = written) => {
  const result = buildCharacter(choices, rules);
  return result.ok ? [] : result.errors;
};

describe('a level 1 character, as written', () => {
  const { sheet, summary } = built(fighter);

  it('adds the background to the scores and works out the numbers', () => {
    expect(summary.scores).toEqual({ str: 17, dex: 13, con: 15, int: 8, wis: 12, cha: 10 });
    expect(sheet).toMatchObject({
      characterName: 'Brann',
      class: 'Fighter',
      race: 'Dwarf',
      background: 'Soldier',
      level: 1,
      proficiencyBonus: 2,
      speed: 30,
      // d10 + Constitution 2, and Dwarven Toughness's 1.
      hp: { maximum: 13, current: 13, temporary: 0 },
      armorClass: 11,
      initiative: 1,
      passivePerception: 13,
      hitDice: [{ class: 'Fighter', die: 'd10', maximum: 1, remaining: 1 }],
    });
    expect((sheet.stats as Record<string, unknown>).strength).toEqual({ score: 17, modifier: 3 });
  });

  it('gives the saving throws of the class and the skills of the background and the choices', () => {
    const saves = sheet.savingThrows as Record<string, { proficient: boolean; bonus: number }>;
    expect(saves.strength).toEqual({ proficient: true, bonus: 5 });
    expect(saves.dexterity).toEqual({ proficient: false, bonus: 1 });
    const skills = sheet.skills as Record<string, { proficient: boolean; bonus: number }>;
    expect(Object.keys(skills)).toHaveLength(18);
    expect(skills.athletics).toMatchObject({ proficient: true, bonus: 5 });
    expect(skills.intimidation).toMatchObject({ proficient: true, bonus: 2 });
    expect(skills.perception).toMatchObject({ proficient: true, bonus: 3 });
    expect(skills.stealth).toMatchObject({ proficient: false, bonus: 1 });
  });

  it('writes out the species traits, the feat and the class features', () => {
    const names = (sheet.featuresAndTraits as Array<{ name: string; description: string }>).map((entry) => entry.name);
    expect(names).toEqual(expect.arrayContaining([
      'Darkvision (Dwarf)', 'Dwarven Toughness (Dwarf)', 'Savage Attacker (Origin feat)', 'Second Wind (Fighter 1)', 'Fighting Style (Fighter 1)',
    ]));
    expect(names).not.toContain('Action Surge (Fighter 2)');
    expect(sheet.spellcasting).toBeUndefined();
    expect(sheet.proficiencies).toMatchObject({ armor: 'Light, Medium, and Heavy armor and Shields', weapons: 'Simple and Martial weapons' });
  });

  it('is a sheet the VTT accepts', () => {
    expect(dnd5eCharacterDataSchema.safeParse(sheet).success).toBe(true);
  });
});

describe('what the rules refuse', () => {
  it('names everything wrong with the basics at once', () => {
    expect(errors({ ...fighter, name: ' ', species: 'Kender', level: 21, abilityScores: { ...fighter.abilityScores, str: 19 } })).toEqual([
      'Choose a species of the reference document',
      'A character is level 1 to 20',
      'A character needs a name',
      'Strength starts between 3 and 18',
    ]);
  });

  it('keeps a background to its scores and its feat', () => {
    expect(errors({ ...fighter, backgroundIncreases: { cha: 2, int: 1 } })).toEqual(['Soldier raises only Strength, Dexterity, Constitution']);
    expect(errors({ ...fighter, originFeat: 'Alert' })).toEqual(['Soldier gives the Savage Attacker feat']);
  });

  it('counts the skills a class chooses, from its list, beyond the background’s', () => {
    expect(classSkillChoices('Fighter').count).toBe(2);
    expect(classSkillChoices('Bard')).toEqual({ count: 3, among: 'any' });
    expect(skillKey('Sleight of Hand')).toBe('sleightOfHand');
    expect(errors({ ...fighter, skills: ['perception'] })).toEqual(['Fighter chooses 2 skills']);
    expect(errors({ ...fighter, skills: ['perception', 'arcana'] })).toEqual(['Choose skills from the list of Fighter']);
    expect(errors({ ...fighter, skills: ['perception', 'athletics'] })).toEqual(['Soldier already gives Athletics and Intimidation']);
  });

  it('refuses two classes in a campaign without gestalt', () => {
    expect(errors({ ...fighter, classes: ['Fighter', 'Wizard'] })).toEqual(['This campaign builds single-class characters']);
  });

  it('asks for the feat of every level that gives one, and no other', () => {
    expect(errors({ ...fighter, level: 4 })).toEqual(['Level 4 gives a feat: choose them']);
    expect(errors({ ...fighter, improvements: [{ level: 3, feat: 'Grappler' }] })).toEqual(['Level 3 gives no feat or ability score points']);
  });

  it('checks a feat’s prerequisites, its points and that it is taken once', () => {
    const at4 = { ...fighter, level: 4 };
    expect(errors({ ...at4, improvements: [{ level: 4, feat: 'Boon of Fate', featPoints: { str: 1 } }] })).toEqual(['Boon of Fate needs level 19']);
    expect(errors({ ...at4, improvements: [{ level: 4, feat: 'Savage Attacker' }] })).toEqual(['Savage Attacker can be taken once']);
    expect(errors({ ...at4, improvements: [{ level: 4, feat: 'Grappler', featPoints: { con: 1 } }] })).toEqual([
      'Grappler at level 4 gives 1 to Strength or Dexterity, to at most 20',
    ]);
    expect(errors({ ...at4, improvements: [{ level: 4, feat: 'Ability Score Improvement', featPoints: { str: 2 }, abilityPoints: { con: 2 } }] })).toEqual([
      'Level 4 gives a feat, and no other ability score points',
    ]);
    const wizard = { ...fighter, classes: ['Wizard' as const], skills: ['arcana' as const, 'history' as const], level: 4 };
    expect(errors({ ...wizard, improvements: [{ level: 4, feat: 'Archery' }] })).toEqual(['Archery needs the Fighting Style feature']);
    expect(errors({ ...wizard, abilityScores: { ...fighter.abilityScores, str: 8, dex: 10 }, backgroundIncreases: { con: 2, str: 1 }, improvements: [{ level: 4, feat: 'Grappler', featPoints: { str: 1 } }] })).toEqual([
      'Grappler needs Strength or Dexterity 13+',
    ]);
  });

  it('stops ability scores at 20', () => {
    const strong = { ...fighter, level: 4, abilityScores: { ...fighter.abilityScores, str: 18 } };
    expect(errors({ ...strong, improvements: [{ level: 4, feat: 'Ability Score Improvement', featPoints: { str: 2 } }] })).toEqual([
      'Ability Score Improvement at level 4 gives 2 to ability scores, to at most 20',
    ]);
    expect(built({ ...strong, improvements: [{ level: 4, feat: 'Ability Score Improvement', featPoints: { dex: 1, con: 1 } }] }).summary.scores).toMatchObject({ str: 20, dex: 14, con: 16 });
  });
});

describe('the house rules', () => {
  const gestalt: CharacterChoices = {
    ...fighter,
    classes: ['Fighter', 'Wizard'],
    level: 4,
    backgroundIncreases: { int: 2, str: 1 },
    originFeat: 'Alert',
    skills: ['arcana', 'perception'],
    improvements: [{ level: 4, feat: 'Grappler', featPoints: { str: 1 }, abilityPoints: { int: 2 } }],
  };

  it('build a gestalt character with the features, Hit Die, saves and spell slots of both classes', () => {
    const { sheet, summary } = built(gestalt, house);
    expect(sheet.class).toBe('Fighter / Wizard');
    // d10: 10 + 2 at level 1, then 6 + 2 a level, and Dwarven Toughness's 1 a level.
    expect(summary.hitPoints).toBe(12 + 8 * 3 + 4);
    // Alert: the Proficiency Bonus on Initiative, Dexterity 13 giving +1.
    expect(sheet).toMatchObject({ initiative: 1 + 2, initiativeBonus: 2 });
    const saves = sheet.savingThrows as Record<string, { proficient: boolean }>;
    expect(['strength', 'constitution', 'intelligence', 'wisdom'].every((save) => saves[save].proficient)).toBe(true);
    const names = (sheet.featuresAndTraits as Array<{ name: string }>).map((entry) => entry.name);
    expect(names).toEqual(expect.arrayContaining(['Action Surge (Fighter 2)', 'Arcane Recovery (Wizard 1)', 'Alert (Origin feat)', 'Grappler (General feat)']));
    expect(names.filter((name) => name.startsWith('Ability Score Improvement'))).toHaveLength(1);
    expect((sheet.spellcasting as { slots: Record<string, { total: number }> }).slots).toMatchObject({ '1': { total: 4 }, '2': { total: 3 }, '3': { total: 0 } });
    expect(dnd5eCharacterDataSchema.safeParse(sheet).success).toBe(true);
  });

  it('give a feat and two points at level 4, with the feat’s own point on top', () => {
    // Strength 15 + 1 (background) + 1 (Grappler); Intelligence 8 + 2 (background) + 2 (level 4).
    expect(built(gestalt, house).summary.scores).toMatchObject({ str: 17, int: 12 });
    expect(errors({ ...gestalt, improvements: [{ level: 4, feat: 'Grappler', featPoints: { str: 1 } }] }, house)).toEqual([
      'Level 4 gives 2 ability score points, to at most 22: 2 to one score or 1 to two',
    ]);
    expect(errors({ ...gestalt, improvements: [{ level: 4, feat: 'Grappler', featPoints: { str: 1 }, abilityPoints: { int: 1, wis: 1, cha: 1 } }] }, house)).toHaveLength(1);
  });

  it('free the background’s scores and feat', () => {
    expect(errors(gestalt, { ...house, freeBackgroundAbilityScores: false })).toEqual(['Soldier raises only Strength, Dexterity, Constitution']);
    expect(errors(gestalt, { ...house, freeOriginFeat: false })).toEqual(['Soldier gives the Savage Attacker feat']);
  });

  it('let a score reach 22 and no more', () => {
    const strong: CharacterChoices = {
      ...fighter, level: 8, abilityScores: { ...fighter.abilityScores, str: 18 },
      improvements: [
        { level: 4, feat: 'Ability Score Improvement', featPoints: { con: 2 }, abilityPoints: { str: 2 } },
        { level: 6, feat: 'Grappler', featPoints: { dex: 1 }, abilityPoints: { dex: 2 } },
        { level: 8, feat: 'Ability Score Improvement', featPoints: { wis: 2 }, abilityPoints: { str: 1, wis: 1 } },
      ],
    };
    // 18 + 2 (background) + 2 at level 4 = 22; one more at level 8 is refused.
    expect(errors(strong, house)).toEqual(['Level 8 gives 2 ability score points, to at most 22: 2 to one score or 1 to two']);
    const fine = { ...strong, improvements: [...strong.improvements.slice(0, 2), { level: 8, feat: 'Ability Score Improvement', featPoints: { wis: 2 }, abilityPoints: { wis: 2 } }] };
    expect(built(fine, house).summary.scores.str).toBe(22);
  });

  it('give the Epic Boon at 19 and the pair again at 20', () => {
    const levels = [4, 6, 8, 12, 14, 16, 20];
    const high: CharacterChoices = {
      ...fighter,
      level: 20,
      abilityScores: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
      improvements: [
        ...levels.map((level) => ({ level, feat: 'Ability Score Improvement', featPoints: { int: 2 }, abilityPoints: { cha: 1, wis: 1 } })),
        { level: 19, feat: 'Boon of Fate', featPoints: { str: 1 } },
      ],
    };
    const { sheet, summary } = built(high, house);
    expect(summary.feats).toContain('Boon of Fate');
    expect(summary.scores).toMatchObject({ int: 22, cha: 15, wis: 15 });
    expect(dnd5eCharacterDataSchema.safeParse(sheet).success).toBe(true);
  });
});

describe('feats that raise a score', () => {
  it('know how many points, among which scores, to what cap', () => {
    expect(featPointsRule(findFeat('Ability Score Improvement')!, written)).toEqual({ total: 2, among: ['str', 'dex', 'con', 'int', 'wis', 'cha'], cap: 20 });
    expect(featPointsRule(findFeat('Grappler')!, house)).toEqual({ total: 1, among: ['str', 'dex'], cap: 22 });
    expect(featPointsRule(findFeat('Boon of Spell Recall')!, house)).toEqual({ total: 1, among: ['int', 'wis', 'cha'], cap: 30 });
    expect(featPointsRule(findFeat('Alert')!, house)).toBeNull();
  });
});
