/**
 * The table of feature options against the functions that read them: every
 * name the builder writes for an option must be the one its reader takes.
 * A reader that changes how it matches, or an option renamed here, fails.
 */

import { RULES_AS_WRITTEN as written } from '../../../utils/characterRules';
import { findSrdWeapon } from '../../../utils/srdWeapons';
import type { CombatAction } from '../actions';
import type { ClassName } from '../advancement';
import { buildCharacter, type CharacterChoices } from '../buildCharacter';
import { blessedStrikesOf } from '../cleric';
import { elementalFury, landType } from '../druid';
import { applyChoices, choiceCatalogue, choiceCount, FEATURE_CHOICES, findChoice, type ChoiceOption, type FeatureChoice } from '../featureChoices';
import { hasFeat, overwhelmingStrike } from '../feats';
import { featureName } from '../featureEffects';
import { hasTwoWeaponFighting } from '../extraAttacks';
import { invocationCantrips } from '../invocations';
import { AFTER_ROLL_METAMAGIC, knowsMetamagic, METAMAGIC } from '../metamagic';
import { defensiveTactic, huntersPrey } from '../ranger';
import { elementalAffinity } from '../sorcery';
import { speciesResistances } from '../species';
import { findSpell } from '../spells';
import { fiendishResilience, isPactWeapon, warlockHas } from '../warlock';

type Sheet = Record<string, unknown>;

/** A sheet of the choice's class, at level 20, that lists the option the way the builder writes it. */
const sheetWith = (choice: FeatureChoice, option: ChoiceOption): Sheet => ({
  class: choice.class ?? 'Fighter',
  level: 20,
  race: choice.writes === 'race' ? option.name : 'Human',
  featuresAndTraits: choice.writes === 'race' ? [] : [{ name: option.name, description: option.text.join('\n\n') }],
});

const attackWith = (name: string): CombatAction => ({ name, source: 'sheet', attack: { kind: 'melee', bonus: 5, damage: [{ roll: { count: 1, sides: 8 }, type: 'slashing' }] } }) as CombatAction;

const METAMAGIC_KEYS = Object.fromEntries(
  [...Object.entries(METAMAGIC), ...Object.entries(AFTER_ROLL_METAMAGIC)].map(([key, value]) => [value.name, key])
) as Record<string, Parameters<typeof knowsMetamagic>[1]>;

/** What the reader of each choice must make of a sheet that lists one of its options. */
const READERS: Record<string, (sheet: Sheet, option: ChoiceOption) => void> = {
  draconicAncestry: (sheet, option) => {
    // Its Damage Resistance is of the ancestor's type, which the option's text gives.
    expect(speciesResistances(sheet).map((type) => `${type} damage.`)).toEqual([option.text[0].toLowerCase()]);
  },
  fiendishLegacy: (sheet, option) => {
    const expected = { Abyssal: 'poison', Chthonic: 'necrotic', Infernal: 'fire' }[option.label];
    expect(speciesResistances(sheet)).toEqual([expected]);
  },
  blessedStrikes: (sheet, option) => {
    expect(blessedStrikesOf(sheet)).toBe(option.label === 'Divine Strike' ? 'divineStrike' : 'potentSpellcasting');
  },
  landType: (sheet, option) => {
    expect(landType(sheet)).toBe(option.label.toLowerCase());
  },
  elementalFury: (sheet, option) => {
    expect(elementalFury(sheet)).toBe(option.label === 'Primal Strike' ? 'primal' : 'potent');
  },
  huntersPrey: (sheet, option) => {
    expect(huntersPrey(sheet)).toBe(option.label === 'Colossus Slayer' ? 'colossus' : 'horde');
  },
  defensiveTactics: (sheet, option) => {
    expect(defensiveTactic(sheet)).toBe(option.label === 'Escape the Horde' ? 'escape' : 'multiattack');
  },
  metamagic: (sheet, option) => {
    const key = METAMAGIC_KEYS[option.label];
    // Extended, Subtle and Twinned Spell are the table's to apply, so nothing reads them.
    if (key) expect(knowsMetamagic(sheet, key)).toBe(true);
    else expect(['Extended Spell', 'Subtle Spell', 'Twinned Spell']).toContain(option.label);
  },
  elementalAffinity: (sheet, option) => {
    expect(elementalAffinity(sheet)).toBe(option.label.toLowerCase());
  },
  eldritchInvocations: (sheet, option) => {
    expect(warlockHas(sheet, option.group!)).toBe(true);
    const detail = /\((.+)\)$/.exec(option.name)?.[1];
    if (option.group === 'Pact of the Blade') {
      expect(isPactWeapon(sheet, attackWith(detail ?? 'Pact Longsword'))).toBe(true);
      if (detail) expect(findSrdWeapon(detail)?.kind).toBe('melee');
    } else if (detail) {
      expect(invocationCantrips(sheet, option.group!)).toEqual([detail.toLowerCase()]);
      const spell = findSpell(detail);
      expect(spell?.level).toBe(0);
      expect(spell?.classes).toContain('Warlock');
    } else {
      expect(option.name).toBe(option.group);
    }
  },
  fiendishResilience: (sheet, option) => {
    expect(fiendishResilience(sheet)).toBe(option.label.toLowerCase());
  },
  irresistibleOffense: (sheet, option) => {
    const features = sheet.featuresAndTraits as Array<{ name: string }>;
    expect(hasFeat(features, 'Boon of Irresistible Offense')).toBe(true);
    // 18 Strength and 12 Dexterity: the extra damage is the named score, not the higher.
    const strike = overwhelmingStrike(features, { str: 18, dex: 12 }, attackWith('Longsword'), 20);
    expect(strike?.label).toBe(`Overwhelming Strike (+${option.label === 'Strength' ? 18 : 12})`);
  },
};

/** A Fighting Style: the feat, read as a feat; or the class's own option, which nothing reads. */
const fightingStyle = (sheet: Sheet, option: ChoiceOption) => {
  const features = sheet.featuresAndTraits as Array<{ name: string }>;
  if (/Warrior$/.test(option.label)) return expect(featureName(option.name)).toBe(`Fighting Style: ${option.label}`);
  expect(hasFeat(features, option.label)).toBe(true);
  expect(hasTwoWeaponFighting(features)).toBe(option.label === 'Two-Weapon Fighting');
};
for (const id of ['fightingStyleFighter', 'additionalFightingStyle', 'fightingStylePaladin', 'fightingStyleRanger']) READERS[id] = fightingStyle;

describe('every option is written under a name its reader takes', () => {
  it('has a reader for each choice of the table, and no other', () => {
    expect(Object.keys(READERS).sort()).toEqual(FEATURE_CHOICES.map((choice) => choice.id).sort());
  });

  for (const choice of FEATURE_CHOICES) {
    it(`${choice.title} (${choice.class ?? choice.species ?? 'feat'})`, () => {
      expect(choice.options.length).toBeGreaterThan(1);
      expect(new Set(choice.options.map((option) => option.label.toLowerCase())).size).toBe(choice.options.length);
      for (const option of choice.options) {
        expect(option.text.join('')).not.toBe('');
        READERS[choice.id](sheetWith(choice, option), option);
      }
    });
  }

  it('offers every Metamagic option and Eldritch Invocation of the reference document', () => {
    expect(findChoice('metamagic')!.options).toHaveLength(10);
    expect(new Set(findChoice('eldritchInvocations')!.options.map((option) => option.group)).size).toBe(28);
  });

  it('counts the options by level', () => {
    const at = (id: string, name: ClassName, level: number) => choiceCount(findChoice(id)!, { classes: [name], level, species: 'Human', feats: [] });
    expect([1, 2, 5, 18].map((level) => at('eldritchInvocations', 'Warlock', level))).toEqual([1, 3, 5, 10]);
    expect([1, 2, 10, 17].map((level) => at('metamagic', 'Sorcerer', level))).toEqual([0, 2, 4, 6]);
    expect([6, 7].map((level) => at('blessedStrikes', 'Cleric', level))).toEqual([0, 1]);
    expect(at('blessedStrikes', 'Druid', 20)).toBe(0);
    expect(choiceCount(findChoice('draconicAncestry')!, { classes: ['Bard'], level: 1, species: 'Dragonborn', feats: [] })).toBe(1);
  });

  it('gives a client the table without the rules text', () => {
    const listed = choiceCatalogue();
    expect(listed.map((choice) => choice.id)).toEqual(FEATURE_CHOICES.map((choice) => choice.id));
    expect(listed.every((choice) => choice.options.every((option) => !('text' in option)))).toBe(true);
  });
});

describe('picks that cannot be made', () => {
  const warlock = { classes: ['Warlock'] as ClassName[], level: 5, species: 'Human', feats: [] };
  const refused = (picks: Record<string, string[]>, who = warlock) => applyChoices(who, picks).errors;

  it('refuses an option of another class, an unknown one, and more than the level gives', () => {
    expect(refused({ blessedStrikes: ['Divine Strike'] })).toEqual(['This character has no Blessed Strikes to choose']);
    expect(refused({ nothing: ['x'] })).toEqual(['"nothing" is not a choice a feature gives']);
    expect(refused({ eldritchInvocations: ['Armor of Shadows', 'Eldritch Mind', 'Pact of the Tome', 'Pact of the Chain', 'Devil’s Sight', 'Misty Visions'] })).toEqual([
      'Eldritch Invocations gives 5 options at level 5',
    ]);
    expect(refused({ eldritchInvocations: ['Second Wind'] })).toEqual(['"Second Wind" is not an option of Eldritch Invocations']);
  });

  it('holds an invocation to its level and to the invocation it needs', () => {
    expect(refused({ eldritchInvocations: ['Thirsting Blade'] })).toEqual(['Thirsting Blade needs Pact of the Blade']);
    expect(refused({ eldritchInvocations: ['Pact of the Blade (Longsword)', 'Thirsting Blade'] })).toEqual([]);
    expect(refused({ eldritchInvocations: ['Pact of the Blade (Longsword)', 'Lifedrinker'] })).toEqual(['Lifedrinker needs level 9']);
    expect(refused({ eldritchInvocations: ['Pact of the Blade', 'Pact of the Blade (Longsword)'] })).toEqual(['Pact of the Blade can be taken once']);
    // Agonizing Blast is repeatable, for another cantrip each time.
    expect(refused({ eldritchInvocations: ['Agonizing Blast (Eldritch Blast)', 'Agonizing Blast (Chill Touch)'] })).toEqual([]);
    expect(refused({ eldritchInvocations: ["devil's sight", "Devil's Sight"] })).toEqual(['Devil’s Sight is chosen twice']);
  });

  it('refuses the same Fighting Style feat from two features', () => {
    const fighter = { classes: ['Fighter', 'Paladin'] as ClassName[], level: 7, species: 'Human', feats: [] };
    expect(refused({ fightingStyleFighter: ['Archery'], fightingStylePaladin: ['Archery'] }, fighter)).toEqual(['Archery is chosen twice']);
    expect(refused({ fightingStyleFighter: ['Archery'], additionalFightingStyle: ['Defense'], fightingStylePaladin: ['Blessed Warrior'] }, fighter)).toEqual([]);
  });
});

describe('a built character lists its options the way the server reads them', () => {
  const base: CharacterChoices = {
    name: 'Ilse',
    species: 'Human',
    background: 'Soldier',
    classes: ['Ranger'],
    level: 7,
    abilityScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
    backgroundIncreases: { str: 2, con: 1 },
    originFeat: 'Savage Attacker',
    skills: ['perception', 'survival', 'stealth'],
    improvements: [{ level: 4, feat: 'Ability Score Improvement', featPoints: { str: 2 } }],
  };
  const build = (choices: CharacterChoices) => {
    const result = buildCharacter(choices, written);
    if (!result.ok) throw new Error(result.errors.join(' | '));
    return result.sheet;
  };
  const names = (sheet: Sheet) => (sheet.featuresAndTraits as Array<{ name: string }>).map((entry) => entry.name);

  it('renames the feature a Ranger chose an option of, and lists its Fighting Style feat', () => {
    const sheet = build({ ...base, featureChoices: { huntersPrey: ['Horde Breaker'], defensiveTactics: ['Multiattack Defense'], fightingStyleRanger: ['Archery'] } });
    expect(names(sheet)).toEqual(expect.arrayContaining(['Hunter’s Prey: Horde Breaker (Ranger 3)', 'Defensive Tactics: Multiattack Defense (Ranger 7)', 'Archery (Fighting Style feat)']));
    expect(names(sheet)).not.toContain('Hunter’s Prey (Ranger 3)');
    expect(huntersPrey(sheet)).toBe('horde');
    expect(defensiveTactic(sheet)).toBe('multiattack');
    expect(hasFeat(sheet.featuresAndTraits as Array<{ name: string }>, 'Archery')).toBe(true);
    const archery = (sheet.featuresAndTraits as Array<{ name: string; description: string }>).find((entry) => entry.name.startsWith('Archery'));
    expect(archery?.description).toContain('+2 bonus to attack rolls');
  });

  it('leaves a feature under its own name when its option is not chosen', () => {
    const sheet = build(base);
    expect(names(sheet)).toContain('Hunter’s Prey (Ranger 3)');
    expect(huntersPrey(sheet)).toBeNull();
  });

  it('writes a species choice after the species', () => {
    const sheet = build({ ...base, species: 'Dragonborn', featureChoices: { draconicAncestry: ['Silver'] } });
    expect(sheet.race).toBe('Dragonborn (Silver)');
    expect(speciesResistances(sheet)).toEqual(['cold']);
  });

  it('lists a Warlock’s invocations and a Sorcerer’s Metamagic, and names their types', () => {
    const sheet = build({
      ...base,
      classes: ['Warlock'],
      level: 10,
      skills: ['arcana', 'deception'],
      improvements: [
        { level: 4, feat: 'Ability Score Improvement', featPoints: { cha: 2 } },
        { level: 8, feat: 'Ability Score Improvement', featPoints: { cha: 2 } },
      ],
      featureChoices: {
        eldritchInvocations: ['Pact of the Blade (Longsword)', 'Thirsting Blade', 'Agonizing Blast (Eldritch Blast)', 'Devil’s Sight'],
        fiendishResilience: ['Cold'],
      },
    });
    expect(names(sheet)).toEqual(expect.arrayContaining(['Pact of the Blade (Longsword)', 'Thirsting Blade', 'Agonizing Blast (Eldritch Blast)', 'Fiendish Resilience (Cold)']));
    expect(names(sheet)).not.toContain('Fiendish Resilience (Warlock 10)');
    expect(fiendishResilience(sheet)).toBe('cold');
    expect(isPactWeapon(sheet, attackWith('Longsword'))).toBe(true);
    expect(warlockHas(sheet, "Devil's Sight")).toBe(true);

    const sorcerer = build({
      ...base,
      classes: ['Sorcerer'],
      level: 6,
      skills: ['arcana', 'deception'],
      featureChoices: { metamagic: ['Careful Spell', 'Twinned Spell'], elementalAffinity: ['Lightning'] },
    });
    expect(names(sorcerer)).toEqual(expect.arrayContaining(['Metamagic: Careful Spell', 'Metamagic: Twinned Spell', 'Elemental Affinity: Lightning (Sorcerer 6)']));
    expect(knowsMetamagic(sorcerer, 'careful')).toBe(true);
    expect(elementalAffinity(sorcerer)).toBe('lightning');
  });

  it('names the score the Boon of Irresistible Offense increased, from the boon’s own point', () => {
    const sheet = build({
      ...base,
      classes: ['Fighter'],
      level: 19,
      skills: ['perception', 'survival'],
      improvements: [
        ...[4, 6, 8, 12, 14, 16].map((level) => ({ level, feat: 'Ability Score Improvement', featPoints: [{ str: 2 }, { str: 1, dex: 1 }, { con: 2 }, { con: 2 }, { wis: 2 }, { wis: 2 }][[4, 6, 8, 12, 14, 16].indexOf(level)] })),
        { level: 19, feat: 'Boon of Irresistible Offense', featPoints: { dex: 1 } },
      ],
    });
    expect(names(sheet)).toContain('Boon of Irresistible Offense (Dexterity) (Epic Boon feat)');
    const strike = overwhelmingStrike(sheet.featuresAndTraits as Array<{ name: string }>, { str: 20, dex: 16 }, attackWith('Longsword'), 20);
    expect(strike?.label).toBe('Overwhelming Strike (+16)');
  });

  it('refuses a pick the character cannot make, and a Fighting Style feat taken twice', () => {
    const refusal = buildCharacter({ ...base, featureChoices: { blessedStrikes: ['Divine Strike'] } }, written);
    expect(refusal).toEqual({ ok: false, errors: ['This character has no Blessed Strikes to choose'] });
    const twice = buildCharacter(
      { ...base, improvements: [{ level: 4, feat: 'Archery' }], featureChoices: { fightingStyleRanger: ['Archery'] } },
      written
    );
    expect(twice).toEqual({ ok: false, errors: ['Archery can be taken once'] });
  });
});

describe('a gestalt Cleric and Druid', () => {
  it('keeps each class’s Potent Spellcasting to that class', () => {
    const sheet = {
      class: 'Cleric / Druid',
      level: 7,
      featuresAndTraits: [
        { name: 'Blessed Strikes: Divine Strike (Cleric 7)' },
        { name: 'Elemental Fury: Potent Spellcasting (Druid 7)' },
      ],
    };
    expect(blessedStrikesOf(sheet)).toBe('divineStrike');
    expect(elementalFury(sheet)).toBe('potent');
    const swapped = {
      ...sheet,
      featuresAndTraits: [
        { name: 'Blessed Strikes: Potent Spellcasting (Cleric 7)' },
        { name: 'Elemental Fury: Primal Strike (Druid 7)' },
      ],
    };
    expect(blessedStrikesOf(swapped)).toBe('potentSpellcasting');
    expect(elementalFury(swapped)).toBe('primal');
  });
});
