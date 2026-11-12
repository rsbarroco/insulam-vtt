// ============================================
// The classes, from the System Reference Document 5.2.1
//
// `data/srd-5.2.1-classes.json` holds the twelve classes as the document
// gives them, built by `scripts/srd-classes.py`: core traits, the columns of
// each features table, the features by level, the lists of options (Metamagic,
// Eldritch Invocations) and the one subclass the document has for each. The
// SRD is published by Wizards of the Coast under CC-BY-4.0; see
// SRD_ATTRIBUTION.md.
//
// The numbers a build is computed from are in advancement.ts; this is the
// text a player reads, and the table columns that say how many Rages or
// Sorcery Points a level gives.
// ============================================

import catalogue from './data/srd-5.2.1-classes.json';
import { CLASS_NAMES, MAX_LEVEL, type ClassName, type Tracks } from './advancement';

export interface ClassFeature {
  /** The class level that gives it. */
  level: number;
  name: string;
  /** A paragraph at a time. Small tables inside a feature are not kept. */
  text: string[];
}

export interface ClassOption {
  name: string;
  cost: string | null;
  prerequisite: string | null;
  text: string[];
}

export interface CharacterClass {
  id: string;
  name: ClassName;
  /** The Core Traits table: "Hit Point Die", "Skill Proficiencies", "Starting Equipment" and the rest, as written. */
  coreTraits: Record<string, string>;
  /** The names in the Class Features column, one list per level, level 1 first. */
  featuresByLevel: string[][];
  /** The other columns of the features table by heading, twenty values each, level 1 first. "—" is none. */
  columns: Record<string, string[]>;
  features: ClassFeature[];
  optionLists: Array<{ name: string; description: string; options: ClassOption[] }>;
  subclass: { name: string; description: string; features: ClassFeature[] };
}

const CLASSES = catalogue.classes as unknown as readonly CharacterClass[];
const BY_NAME = new Map(CLASSES.map((entry) => [entry.name.toLowerCase(), entry]));

export const allClasses = (): readonly CharacterClass[] => CLASSES;

export function findClass(name: string | null | undefined): CharacterClass | null {
  return name ? (BY_NAME.get(name.trim().toLowerCase()) ?? null) : null;
}

const clamp = (level: number) => Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));

/** The features a class has given by a level, its subclass's among them, in level order. */
export function featuresUpTo(name: ClassName, level: number, withSubclass = true): ClassFeature[] {
  const found = findClass(name);
  if (!found) return [];
  const all = withSubclass ? [...found.features, ...found.subclass.features] : found.features;
  return all.filter((feature) => feature.level <= clamp(level)).sort((a, b) => a.level - b.level);
}

/** One column of a class's features table at a level: its Rages, its Sneak Attack dice. Null when the class has no such column. */
export function columnAt(name: ClassName, column: string, level: number): string | null {
  return findClass(name)?.columns[column]?.[clamp(level) - 1] ?? null;
}

/**
 * Everything a character's classes have given it by a level. A gestalt
 * character has the features of both; a feature both classes give under the
 * same name at once (Extra Attack, Ability Score Improvement, Epic Boon) is
 * listed once, from the first class, as the campaign's gestalt rule has it.
 */
export function buildFeatures(tracks: Tracks, level: number): Array<ClassFeature & { from: ClassName }> {
  const seen = new Set<string>();
  const out: Array<ClassFeature & { from: ClassName }> = [];
  for (const name of tracks) {
    for (const feature of featuresUpTo(name, level)) {
      const once = ONCE.has(feature.name) ? feature.name : `${name}:${feature.name}:${feature.level}`;
      if (seen.has(once)) continue;
      seen.add(once);
      out.push({ ...feature, from: name });
    }
  }
  return out.sort((a, b) => a.level - b.level);
}

/** Features that do not stack when two classes give them. */
const ONCE: ReadonlySet<string> = new Set(['Ability Score Improvement', 'Epic Boon', 'Extra Attack']);

export { CLASS_NAMES };
