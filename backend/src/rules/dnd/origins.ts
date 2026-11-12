// ============================================
// Backgrounds, species and feats, from the System Reference Document 5.2.1
//
// `data/srd-5.2.1-origins.json` holds them as the document gives them, built
// by `scripts/srd-origins.py`. The SRD is published by Wizards of the Coast
// under CC-BY-4.0; see SRD_ATTRIBUTION.md.
//
// What a campaign's house rules (utils/characterRules.ts) change about a
// character's origin is decided here: which ability scores a background may
// raise, and which origin feat a character may take.
// ============================================

import catalogue from './data/srd-5.2.1-origins.json';
import { abilityScoreCap, type CharacterRules } from '../../utils/characterRules';
import type { Ability } from './conditions';

export interface Background {
  id: string;
  name: string;
  /** The three ability scores it names, in full: "Strength". */
  abilityScores: string[];
  /** The origin feat it gives, as written: "Magic Initiate (Cleric)". */
  feat: string;
  skillProficiencies: string[];
  toolProficiency: string;
  equipment: string;
}

export interface Trait {
  name: string;
  text: string;
  /** The choices a trait offers, when it offers named ones. */
  options?: Trait[];
}

export interface Species {
  id: string;
  name: string;
  creatureType: string;
  size: string;
  speedFeet: number;
  traits: Trait[];
  /** The tables a trait refers to, by the table's title. */
  tables?: Record<string, Array<Record<string, string>>>;
}

export type FeatCategory = 'Origin' | 'General' | 'Fighting Style' | 'Epic Boon';

export interface Feat {
  id: string;
  name: string;
  category: FeatCategory;
  prerequisite: string | null;
  description: string;
  benefits: Trait[];
  /** What the feat says of taking it again, or null when it can be taken once. */
  repeatable: string | null;
}

const BACKGROUNDS = catalogue.backgrounds as readonly Background[];
const SPECIES = catalogue.species as readonly Species[];
const FEATS = catalogue.feats as readonly Feat[];

const key = (name: string) => name.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const finder = <T extends { id: string }>(list: readonly T[]) => {
  const byId = new Map(list.map((entry) => [entry.id, entry]));
  return (name: string | null | undefined): T | null => (name ? (byId.get(key(name)) ?? null) : null);
};

export const allBackgrounds = (): readonly Background[] => BACKGROUNDS;
export const allSpecies = (): readonly Species[] => SPECIES;
export const allFeats = (): readonly Feat[] => FEATS;
export const findBackground = finder(BACKGROUNDS);
export const findSpecies = finder(SPECIES);
/** A feat by name. "Magic Initiate (Cleric)" finds Magic Initiate. */
export const findFeat = (name: string | null | undefined): Feat | null => finder(FEATS)(name?.replace(/\s*\(.*\)\s*$/, ''));

export function featsOf(category: FeatCategory): Feat[] {
  return FEATS.filter((feat) => feat.category === category);
}

const ABILITY_BY_NAME: Readonly<Record<string, Ability>> = {
  Strength: 'str',
  Dexterity: 'dex',
  Constitution: 'con',
  Intelligence: 'int',
  Wisdom: 'wis',
  Charisma: 'cha',
};
const ALL_ABILITIES: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** The ability scores a background's increases may go to: its three, or any by the house rule. */
export function backgroundAbilities(background: Background, rules: CharacterRules): Ability[] {
  return rules.freeBackgroundAbilityScores ? [...ALL_ABILITIES] : background.abilityScores.map((name) => ABILITY_BY_NAME[name]);
}

/** The origin feats a character with this background may take: the background's, or any by the house rule. */
export function originFeatChoices(background: Background, rules: CharacterRules): Feat[] {
  if (rules.freeOriginFeat) return featsOf('Origin');
  const given = findFeat(background.feat);
  return given ? [given] : [];
}

/**
 * Why a background's ability score increases cannot be taken, or null when
 * they can. The rules give 2 to one score and 1 to another, or 1 to three,
 * among the scores the background allows, and none may pass the cap.
 */
export function backgroundIncreaseRefusal(
  increases: Partial<Record<Ability, number>>,
  scores: Readonly<Record<Ability, number>>,
  background: Background,
  rules: CharacterRules
): string | null {
  const taken = Object.entries(increases).filter(([, amount]) => amount !== undefined && amount !== 0) as Array<[Ability, number]>;
  const allowed = backgroundAbilities(background, rules);
  if (taken.some(([ability]) => !allowed.includes(ability))) {
    return `${background.name} raises only ${background.abilityScores.join(', ')}`;
  }
  const amounts = taken.map(([, amount]) => amount).sort((a, b) => b - a);
  const shape = amounts.join('+');
  if (shape !== '2+1' && shape !== '1+1+1') return 'A background gives +2 to one ability score and +1 to another, or +1 to three';
  const cap = abilityScoreCap(rules);
  const over = taken.find(([ability, amount]) => scores[ability] + amount > cap);
  return over ? `A background cannot raise an ability score above ${cap}` : null;
}
