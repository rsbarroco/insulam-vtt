// ============================================
// The options a feature makes a character choose, and the name each is
// written under
//
// Several features give one of a few options (Blessed Strikes, Hunter's
// Prey), a list to pick from (Metamagic, Eldritch Invocations, a Fighting
// Style feat) or a type (Elemental Affinity, Fiendish Resilience, a
// Dragonborn's ancestor). The rules modules read which one a character took
// from the sheet: a feature's name, or the species written as `race`. This is
// the one table of those choices: what is offered, at which level, and the
// exact name the sheet gets for each option.
//
// The guided builder asks from it and writes from it (buildCharacter.ts), and
// the sheet editor offers the same names for a feature already on a sheet.
// `__tests__/featureChoices.test.ts` holds every name here against the
// function that reads it, so a reader and this table cannot drift apart.
//
// Only what a reader looks for is here. A choice the server does nothing with
// (an Elf's lineage, a Divine Order, the weapons of Weapon Mastery) stays the
// sheet's to carry.
//
// Pure.
// ============================================

import { SRD_WEAPONS } from '../../utils/srdWeapons';
import { MAX_LEVEL, type ClassName } from './advancement';
import { columnAt, findClass } from './classes';
import { DAMAGE_TYPES } from './damage';
import { featsOf, findFeat, findSpecies } from './origins';

export interface ChoiceOption {
  /** What the form shows and sends back: "Divine Strike". One of a kind within its choice. */
  label: string;
  /** What the sheet gets, in full: "Blessed Strikes: Divine Strike (Cleric 7)". */
  name: string;
  /** The rule's own text, for the feature's description. */
  text: string[];
  /** What it is a variant of, when several options are one thing with a detail: "Agonizing Blast". */
  group?: string;
  /** Whether more than one option of the group can be taken. */
  repeatable?: boolean;
  /** The class level it needs. */
  minLevel?: number;
  /** The group of another option of the same choice that must be taken with it. */
  needs?: string;
}

export interface FeatureChoice {
  id: string;
  /** What the form heads it with. */
  title: string;
  /** What gives it: a class at a level, a feat, or a species. */
  class?: ClassName;
  feat?: string;
  species?: string;
  /** The class level it first comes at; 1 for a feat or a species. */
  level: number;
  /** How many options a character has taken by each level, level 1 first. */
  counts: number[];
  /**
   * Where an option goes: over the name of the feature that gives it
   * (`renames`), beside it as a feature of its own (`adds`), or after the
   * species as the sheet's `race`.
   */
  writes: 'renames' | 'adds' | 'race';
  /** The feature a `renames` choice renames, as the class or the feat names it. */
  feature?: string;
  /** False when the builder works it out from another choice instead of asking. */
  asked: boolean;
  options: ChoiceOption[];
}

const titled = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const plain = (name: string) => name.trim().toLowerCase().replace(/[’']/g, "'");
const from = (level: number, count = 1) => Array.from({ length: MAX_LEVEL }, (_, index) => (index + 1 >= level ? count : 0));

/** A class feature's paragraphs, its subclass's among them. */
function featureText(name: ClassName, feature: string): string[] {
  const found = findClass(name);
  const all = found ? [...found.features, ...found.subclass.features] : [];
  return all.find((entry) => plain(entry.name) === plain(feature))?.text ?? [];
}

/** The paragraph of a feature that starts with an option's name: "Divine Strike. Once on each of your turns…". */
const optionText = (text: readonly string[], option: string) => text.filter((paragraph) => plain(paragraph).startsWith(`${plain(option)}.`));

/**
 * One of a class feature's options, written over the feature's name:
 * "Blessed Strikes: Divine Strike (Cleric 7)". With `bare`, the option goes
 * in brackets and nothing follows it, "Fiendish Resilience (Fire)": the
 * Warlock's reader takes what the brackets hold, and only at the name's end.
 */
function oneOf(id: string, name: ClassName, level: number, feature: string, options: readonly string[], bare = false): FeatureChoice {
  const text = featureText(name, feature);
  return {
    id,
    title: feature,
    class: name,
    level,
    counts: from(level),
    writes: 'renames',
    feature,
    asked: true,
    options: options.map((option) => {
      const own = optionText(text, option);
      return {
        label: option,
        name: bare ? `${feature} (${option})` : `${feature}: ${option} (${name} ${level})`,
        text: own.length > 0 ? own : text,
      };
    }),
  };
}

const featText = (name: string): string[] => {
  const feat = findFeat(name);
  return feat ? [feat.description, ...feat.benefits.map((benefit) => `${benefit.name}. ${benefit.text}`)].filter(Boolean) : [];
};

/** A Fighting Style feat, listed as the builder lists any feat; or the option a Paladin or a Ranger can take instead. */
function fightingStyle(id: string, name: ClassName, level: number, feature: string, instead?: string): FeatureChoice {
  const text = featureText(name, 'Fighting Style');
  return {
    id,
    title: feature,
    class: name,
    level,
    counts: from(level),
    writes: 'adds',
    asked: true,
    options: [
      ...featsOf('Fighting Style').map((feat) => ({ label: feat.name, name: `${feat.name} (Fighting Style feat)`, text: featText(feat.name) })),
      ...(instead ? [{ label: instead, name: `Fighting Style: ${instead} (${name} ${level})`, text: optionText(text, instead) }] : []),
    ],
  };
}

/** The Warlock cantrips of the reference document an invocation can be taken for. */
const BLAST_CANTRIPS: Readonly<Record<string, readonly string[]>> = {
  // A Warlock cantrip that deals damage.
  'Agonizing Blast': ['Eldritch Blast', 'Chill Touch', 'Poison Spray'],
  // The same, through an attack roll.
  'Repelling Blast': ['Eldritch Blast', 'Chill Touch', 'Poison Spray'],
};

/**
 * The Eldritch Invocations, each under its own name with nothing after it,
 * as the Warlock's readers take them. Agonizing Blast and Repelling Blast
 * name their cantrip in brackets; Pact of the Blade can name the weapon.
 */
function invocations(): FeatureChoice {
  const list = findClass('Warlock')?.optionLists.find((entry) => /invocation/i.test(entry.name))?.options ?? [];
  const options: ChoiceOption[] = [];
  for (const entry of list) {
    const level = /Level (\d+)\+ Warlock/.exec(entry.prerequisite ?? '');
    const other = /,\s*(.+?) Invocation$/.exec(entry.prerequisite ?? '');
    const shared = {
      text: entry.text,
      ...(level ? { minLevel: Number(level[1]) } : {}),
      ...(other ? { needs: other[1] } : {}),
    };
    const cantrips = BLAST_CANTRIPS[entry.name];
    if (cantrips) {
      for (const cantrip of cantrips) {
        const name = `${entry.name} (${cantrip})`;
        options.push({ label: name, name, group: entry.name, repeatable: true, ...shared });
      }
    } else if (entry.name === 'Pact of the Blade') {
      // Without a weapon, the pact weapon is the attack with "pact" in its own name.
      options.push({ label: entry.name, name: entry.name, group: entry.name, ...shared });
      for (const weapon of SRD_WEAPONS.filter((candidate) => candidate.kind === 'melee')) {
        const name = `${entry.name} (${weapon.name})`;
        options.push({ label: name, name, group: entry.name, ...shared });
      }
    } else {
      options.push({ label: entry.name, name: entry.name, group: entry.name, ...shared });
    }
  }
  return {
    id: 'eldritchInvocations',
    title: 'Eldritch Invocations',
    class: 'Warlock',
    level: 1,
    counts: Array.from({ length: MAX_LEVEL }, (_, index) => Number(columnAt('Warlock', 'Eldritch Invocations', index + 1)) || 0),
    writes: 'adds',
    asked: true,
    options,
  };
}

/** Metamagic: two options at Sorcerer level 2, two more at 10 and at 17, each listed as "Metamagic: Careful Spell". */
function metamagic(): FeatureChoice {
  const list = findClass('Sorcerer')?.optionLists.find((entry) => /metamagic/i.test(entry.name))?.options ?? [];
  return {
    id: 'metamagic',
    title: 'Metamagic',
    class: 'Sorcerer',
    level: 2,
    counts: Array.from({ length: MAX_LEVEL }, (_, index) => (index + 1 >= 17 ? 6 : index + 1 >= 10 ? 4 : index + 1 >= 2 ? 2 : 0)),
    writes: 'adds',
    asked: true,
    options: list.map((entry) => ({
      label: entry.name,
      name: `Metamagic: ${entry.name}`,
      text: [...(entry.cost ? [`Cost: ${entry.cost}`] : []), ...entry.text],
    })),
  };
}

/** What a species chooses, written after it as the sheet's `race`: "Dragonborn (Red)". */
function speciesChoice(id: string, species: string, title: string, table: string, key: 'dragon' | 'name'): FeatureChoice {
  const rows = (findSpecies(species)?.tables?.[table] ?? []) as Array<Record<string, string | undefined>>;
  return {
    id,
    title,
    species,
    level: 1,
    counts: from(1),
    writes: 'race',
    asked: true,
    options: rows.flatMap((row) => {
      const value = row[key];
      if (!value) return [];
      const text = row.damageType ? `${row.damageType} damage.` : (row.level1 ?? '');
      return [{ label: value, name: `${species} (${value})`, text: text ? [text] : [] }];
    }),
  };
}

const IRRESISTIBLE_OFFENSE = 'Boon of Irresistible Offense';

/** Every choice, in the order the form asks them. */
export const FEATURE_CHOICES: readonly FeatureChoice[] = [
  speciesChoice('draconicAncestry', 'Dragonborn', 'Draconic Ancestry', 'Draconic Ancestors', 'dragon'),
  speciesChoice('fiendishLegacy', 'Tiefling', 'Fiendish Legacy', 'Fiendish Legacies', 'name'),
  oneOf('blessedStrikes', 'Cleric', 7, 'Blessed Strikes', ['Divine Strike', 'Potent Spellcasting']),
  { ...oneOf('landType', 'Druid', 3, 'Circle of the Land Spells', ['Arid', 'Polar', 'Temperate', 'Tropical']), title: 'Circle of the Land: land' },
  oneOf('elementalFury', 'Druid', 7, 'Elemental Fury', ['Potent Spellcasting', 'Primal Strike']),
  fightingStyle('fightingStyleFighter', 'Fighter', 1, 'Fighting Style'),
  fightingStyle('additionalFightingStyle', 'Fighter', 7, 'Additional Fighting Style'),
  fightingStyle('fightingStylePaladin', 'Paladin', 2, 'Fighting Style', 'Blessed Warrior'),
  fightingStyle('fightingStyleRanger', 'Ranger', 2, 'Fighting Style', 'Druidic Warrior'),
  oneOf('huntersPrey', 'Ranger', 3, 'Hunter’s Prey', ['Colossus Slayer', 'Horde Breaker']),
  oneOf('defensiveTactics', 'Ranger', 7, 'Defensive Tactics', ['Escape the Horde', 'Multiattack Defense']),
  metamagic(),
  oneOf('elementalAffinity', 'Sorcerer', 6, 'Elemental Affinity', ['Acid', 'Cold', 'Fire', 'Lightning', 'Poison']),
  invocations(),
  oneOf('fiendishResilience', 'Warlock', 10, 'Fiendish Resilience', DAMAGE_TYPES.filter((type) => type !== 'force').map(titled), true),
  {
    id: 'irresistibleOffense',
    title: IRRESISTIBLE_OFFENSE,
    feat: IRRESISTIBLE_OFFENSE,
    level: 1,
    counts: from(1),
    writes: 'renames',
    feature: IRRESISTIBLE_OFFENSE,
    // The score the boon increased, which the builder already asks for.
    asked: false,
    options: ['Strength', 'Dexterity'].map((ability) => ({
      label: ability,
      name: `${IRRESISTIBLE_OFFENSE} (${ability}) (Epic Boon feat)`,
      text: featText(IRRESISTIBLE_OFFENSE),
    })),
  },
];

export const findChoice = (id: string): FeatureChoice | null => FEATURE_CHOICES.find((choice) => choice.id === id) ?? null;

/** The table as a client reads it: everything but the rules' text, which the server writes onto the sheet itself. */
export function choiceCatalogue(): Array<Omit<FeatureChoice, 'options'> & { options: Array<Omit<ChoiceOption, 'text'>> }> {
  return FEATURE_CHOICES.map((choice) => ({
    ...choice,
    options: choice.options.map((option) => ({
      label: option.label,
      name: option.name,
      ...(option.group ? { group: option.group } : {}),
      ...(option.repeatable ? { repeatable: true } : {}),
      ...(option.minLevel ? { minLevel: option.minLevel } : {}),
      ...(option.needs ? { needs: option.needs } : {}),
    })),
  }));
}

export interface Chooser {
  classes: readonly ClassName[];
  level: number;
  species: string;
  /** The feats taken, by name. */
  feats: readonly string[];
}

/** How many options of a choice a character has, 0 for one it does not get. */
export function choiceCount(choice: FeatureChoice, who: Chooser): number {
  if (choice.class) return who.classes.includes(choice.class) ? (choice.counts[Math.max(1, Math.min(MAX_LEVEL, who.level)) - 1] ?? 0) : 0;
  if (choice.species) return plain(who.species) === plain(choice.species) ? 1 : 0;
  return choice.feat && who.feats.some((feat) => plain(feat) === plain(choice.feat!)) ? 1 : 0;
}

export interface AppliedChoices {
  errors: string[];
  /** The sheet's `race`, when the species made a choice. */
  race: string | null;
  /** The new name of a class feature, by `class:feature` in lower case; of a feat, by `feat:name`. */
  renamed: Map<string, string>;
  /** Features to list after the classes' own. */
  added: Array<{ name: string; description: string }>;
}

/** The key a renamed feature is looked up by. */
export const renameKey = (source: string, feature: string) => `${plain(source)}:${plain(feature)}`;

/**
 * What a character's picks write onto its sheet, by choice id and option
 * label. A choice left unanswered writes nothing: the feature keeps the name
 * its class gives it, and the option stays the table's to apply until the
 * sheet names it. A pick the character cannot make is an error.
 */
export function applyChoices(who: Chooser, picks: Readonly<Record<string, readonly string[]>>): AppliedChoices {
  const out: AppliedChoices = { errors: [], race: null, renamed: new Map(), added: [] };
  const written = new Set<string>();
  for (const id of Object.keys(picks)) {
    const choice = findChoice(id);
    const labels = picks[id];
    if (labels.length === 0) continue;
    const count = choice ? choiceCount(choice, who) : 0;
    if (!choice || count === 0) {
      out.errors.push(choice ? `This character has no ${choice.title} to choose` : `"${id}" is not a choice a feature gives`);
      continue;
    }
    if (labels.length > count) {
      out.errors.push(`${choice.title} gives ${count} ${count === 1 ? 'option' : 'options'} at level ${who.level}`);
      continue;
    }
    const taken: ChoiceOption[] = [];
    for (const label of labels) {
      const option = choice.options.find((entry) => plain(entry.label) === plain(label));
      if (!option) out.errors.push(`"${label}" is not an option of ${choice.title}`);
      else if (taken.includes(option)) out.errors.push(`${option.label} is chosen twice`);
      else if (option.group && !option.repeatable && taken.some((other) => other.group === option.group)) out.errors.push(`${option.group} can be taken once`);
      else taken.push(option);
    }
    for (const option of taken) {
      if (option.minLevel && who.level < option.minLevel) out.errors.push(`${option.label} needs level ${option.minLevel}`);
      if (option.needs && !taken.some((other) => other.group === option.needs)) out.errors.push(`${option.label} needs ${option.needs}`);
      if (written.has(plain(option.name))) out.errors.push(`${option.label} is chosen twice`);
      written.add(plain(option.name));
      if (choice.writes === 'race') out.race = option.name;
      else if (choice.writes === 'renames') out.renamed.set(renameKey(choice.class ?? 'feat', choice.feature ?? choice.title), option.name);
      else out.added.push({ name: option.name, description: option.text.join('\n\n') });
    }
  }
  return out;
}
