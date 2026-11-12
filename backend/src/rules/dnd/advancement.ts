// ============================================
// What a character gains by level, by the D&D rules and the campaign's own
//
// The numbers a character sheet is built from: Hit Dice and hit points,
// saving throw proficiencies, when a feat or an ability score improvement
// comes, and spell slots. Gestalt and the house rules a campaign switches
// (utils/characterRules.ts) change those numbers here, in one place.
//
// The class facts are from the System Reference Document 5.2.1 (CC-BY-4.0;
// see SRD_ATTRIBUTION.md). The fifth edition has no gestalt rule: the one
// here is the VTT's, written down in docs/TACTICAL_MODE.md.
// ============================================

import { abilityScoreCap, type CharacterRules } from '../../utils/characterRules';
import type { Ability } from './conditions';

export const CLASS_NAMES = [
  'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk',
  'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard',
] as const;
export type ClassName = (typeof CLASS_NAMES)[number];

export interface ClassFacts {
  hitDie: 6 | 8 | 10 | 12;
  saves: readonly [Ability, Ability];
  /** How fast its spell slots come: every level, every second, or its own Pact Magic. */
  caster: 'full' | 'half' | 'pact' | null;
  /** Class levels that give an Ability Score Improvement, besides the Epic Boon at 19. */
  improvements: readonly number[];
}

const STANDARD = [4, 8, 12, 16] as const;

export const CLASSES: Readonly<Record<ClassName, ClassFacts>> = {
  Barbarian: { hitDie: 12, saves: ['str', 'con'], caster: null, improvements: STANDARD },
  Bard: { hitDie: 8, saves: ['dex', 'cha'], caster: 'full', improvements: STANDARD },
  Cleric: { hitDie: 8, saves: ['wis', 'cha'], caster: 'full', improvements: STANDARD },
  Druid: { hitDie: 8, saves: ['int', 'wis'], caster: 'full', improvements: STANDARD },
  Fighter: { hitDie: 10, saves: ['str', 'con'], caster: null, improvements: [4, 6, 8, 12, 14, 16] },
  Monk: { hitDie: 8, saves: ['str', 'dex'], caster: null, improvements: STANDARD },
  Paladin: { hitDie: 10, saves: ['wis', 'cha'], caster: 'half', improvements: STANDARD },
  Ranger: { hitDie: 10, saves: ['str', 'dex'], caster: 'half', improvements: STANDARD },
  Rogue: { hitDie: 8, saves: ['dex', 'int'], caster: null, improvements: [4, 8, 10, 12, 16] },
  Sorcerer: { hitDie: 6, saves: ['con', 'cha'], caster: 'full', improvements: STANDARD },
  Warlock: { hitDie: 8, saves: ['wis', 'cha'], caster: 'pact', improvements: STANDARD },
  Wizard: { hitDie: 6, saves: ['int', 'wis'], caster: 'full', improvements: STANDARD },
};

export const MAX_LEVEL = 20;
/** The level every class gives an Epic Boon feat at. */
export const EPIC_BOON_LEVEL = 19;

/** The classes a character advances in: one, or two at once when gestalt. */
export type Tracks = readonly [ClassName] | readonly [ClassName, ClassName];

/** Why a choice of classes cannot be built, or null when it can. */
export function tracksRefusal(tracks: readonly ClassName[], rules: CharacterRules): string | null {
  if (tracks.length < 1 || tracks.length > 2) return 'A character has one class, or two when the campaign builds gestalt characters';
  if (tracks.some((name) => !(name in CLASSES))) return 'That is not a class of the reference document';
  if (tracks.length === 2 && !rules.gestalt) return 'This campaign builds single-class characters';
  if (tracks.length === 2 && tracks[0] === tracks[1]) return 'A gestalt character advances in two different classes';
  return null;
}

/** Proficiency Bonus by character level. */
export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, Math.min(MAX_LEVEL, level)) - 1) / 4);
}

/** The Hit Die a character rolls each level: the larger of its classes'. */
export function hitDie(tracks: Tracks): number {
  return Math.max(...tracks.map((name) => CLASSES[name].hitDie));
}

/**
 * Hit points at a level with the fixed value for each level after the
 * first: the whole die at level 1, then half the die plus one, each with the
 * Constitution modifier, and never less than 1 a level.
 */
export function fixedHitPoints(tracks: Tracks, level: number, conModifier: number): number {
  const die = hitDie(tracks);
  const first = Math.max(1, die + conModifier);
  const later = Math.max(1, die / 2 + 1 + conModifier);
  return first + later * (Math.max(1, Math.min(MAX_LEVEL, level)) - 1);
}

/** Saving throw proficiencies: the two each class gives at level 1. */
export function savingThrowProficiencies(tracks: Tracks): Ability[] {
  return [...new Set(tracks.flatMap((name) => CLASSES[name].saves))];
}

/** What a level gives towards feats and ability scores. */
export interface Improvement {
  level: number;
  /**
   * `both`: a feat and ability score points, by the house rule.
   * `feat`: the Ability Score Improvement of the rules, which is a feat (the
   * feat of that name gives the points).
   * `epicBoon`: the Epic Boon feat of level 19.
   */
  kind: 'both' | 'feat' | 'epicBoon';
  /** Points to add to ability scores besides the feat's own: 2 to one score or 1 to two. */
  abilityPoints: number;
}

/**
 * The levels up to `level` that give a feat or ability score points.
 *
 * As written, a class gives an Ability Score Improvement feat at its own
 * levels. With the house rule, every fourth character level gives a feat and
 * 2 ability score points together, and so does any other level a class gives
 * an improvement at. Two classes giving one at the same level give it once.
 */
export function improvements(tracks: Tracks, level: number, rules: CharacterRules): Improvement[] {
  const upTo = Math.max(1, Math.min(MAX_LEVEL, level));
  const fromClasses = new Set(tracks.flatMap((name) => CLASSES[name].improvements));
  const everyFourth = new Set([4, 8, 12, 16, 20]);
  const out: Improvement[] = [];
  for (let at = 1; at <= upTo; at++) {
    if (rules.featAndAbilityScores && (everyFourth.has(at) || fromClasses.has(at))) {
      out.push({ level: at, kind: 'both', abilityPoints: 2 });
    } else if (!rules.featAndAbilityScores && fromClasses.has(at)) {
      out.push({ level: at, kind: 'feat', abilityPoints: 0 });
    }
    if (at === EPIC_BOON_LEVEL) out.push({ level: at, kind: 'epicBoon', abilityPoints: 0 });
  }
  return out;
}

/** Whether an ability score may be raised to `score` by a level's improvement. */
export function scoreWithinCap(score: number, rules: CharacterRules): boolean {
  return Number.isInteger(score) && score >= 1 && score <= abilityScoreCap(rules);
}

/** Spell slots of levels 1 to 9 by caster level, the multiclass spellcaster table. */
const SLOT_TABLE: ReadonlyArray<readonly number[]> = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/**
 * The caster level spell slots are read at: each full caster's levels, half
 * of each half caster's rounded up, added together, and never above the
 * character's level. Pact Magic is apart and adds nothing here.
 */
export function casterLevel(tracks: Tracks, level: number): number {
  const at = Math.max(1, Math.min(MAX_LEVEL, level));
  const sum = tracks.reduce((total, name) => {
    const caster = CLASSES[name].caster;
    return total + (caster === 'full' ? at : caster === 'half' ? Math.ceil(at / 2) : 0);
  }, 0);
  return Math.min(at, sum);
}

/** Spell slots by slot level (index 0 is level 1), nine entries. */
export function spellSlots(tracks: Tracks, level: number): number[] {
  const caster = casterLevel(tracks, level);
  const row = caster > 0 ? SLOT_TABLE[caster - 1] : [];
  return Array.from({ length: 9 }, (_, index) => row[index] ?? 0);
}

/** Pact Magic by Warlock level: how many slots, and their level. */
export function pactMagic(tracks: Tracks, level: number): { slots: number; slotLevel: number } | null {
  if (!tracks.includes('Warlock')) return null;
  const at = Math.max(1, Math.min(MAX_LEVEL, level));
  return { slots: at >= 17 ? 4 : at >= 11 ? 3 : at >= 2 ? 2 : 1, slotLevel: Math.min(5, Math.ceil(at / 2)) };
}
