// ============================================
// Building a character from its choices, by the D&D rules and the campaign's
//
// A player chooses a species, a background, one class or two, ability
// scores, feats and skills. This checks the choices against the rules as the
// campaign has them (utils/characterRules.ts) and works out the sheet they
// make: scores, Hit Points, saving throws, skills, spell slots, and the
// features of the species, the feats and the classes, written out.
//
// Pure: the caller stores what comes back. What is not worked out is said in
// docs/TACTICAL_MODE.md: equipment, Armor Class beyond 10 + Dexterity, most
// numbers a species trait or a feature changes, and which spells are known.
// Two are worked out: Alert adds the Proficiency Bonus to Initiative, and a
// Dwarf's Dwarven Toughness adds 1 Hit Point a level.
// ============================================

import { abilityScoreCap, type CharacterRules } from '../../utils/characterRules';
import type { Ability } from './conditions';
import {
  casterLevel, CLASSES, fixedHitPoints, hitDie, improvements, MAX_LEVEL, pactMagic, proficiencyBonus, savingThrowProficiencies,
  spellSlots, tracksRefusal, type ClassName, type Improvement, type Tracks,
} from './advancement';
import { buildFeatures, findClass } from './classes';
import { backgroundIncreaseRefusal, findBackground, findFeat, findSpecies, originFeatChoices, type Feat } from './origins';

export const ABILITIES: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_NAMES = { str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' } as const;
const label = (ability: Ability) => ABILITY_NAMES[ability][0].toUpperCase() + ABILITY_NAMES[ability].slice(1);

/** The eighteen skills as the sheet keys them, with the ability each uses. */
export const SKILLS = {
  acrobatics: 'dex', animalHandling: 'wis', arcana: 'int', athletics: 'str', deception: 'cha', history: 'int',
  insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
  performance: 'cha', persuasion: 'cha', religion: 'int', sleightOfHand: 'dex', stealth: 'dex', survival: 'wis',
} as const satisfies Record<string, Ability>;
export type Skill = keyof typeof SKILLS;

/** "Sleight of Hand" as the sheet's key, or null for a name that is not a skill. */
export function skillKey(name: string): Skill | null {
  const key = name.trim().toLowerCase().replace(/\s+(\w)/g, (_, letter: string) => letter.toUpperCase());
  return key in SKILLS ? (key as Skill) : null;
}

export type Scores = Record<Ability, number>;
export type Points = Partial<Record<Ability, number>>;

export interface ImprovementChoice {
  /** The level the improvement comes at. */
  level: number;
  /** The feat taken. */
  feat: string;
  /** The ability score points the feat itself gives, where it gives any. */
  featPoints?: Points;
  /** The 2 points the house rule adds beside the feat: 2 to one score or 1 to two. */
  abilityPoints?: Points;
}

export interface CharacterChoices {
  name: string;
  species: string;
  background: string;
  classes: readonly ClassName[];
  level: number;
  /** The six scores before anything is added, each 3 to 18: how they were generated is the table's. */
  abilityScores: Scores;
  /** The background's increases: 2 and 1, or 1 three times. */
  backgroundIncreases: Points;
  originFeat: string;
  /** Skill proficiencies chosen from the classes' lists, as the sheet keys them. */
  skills: readonly Skill[];
  /** One for each level that gives a feat or ability score points, in any order. */
  improvements: readonly ImprovementChoice[];
}

export type BuildResult = { ok: true; sheet: Record<string, unknown>; summary: BuildSummary } | { ok: false; errors: string[] };

export interface BuildSummary {
  scores: Scores;
  hitPoints: number;
  proficiencyBonus: number;
  feats: string[];
}

const entries = (points: Points | undefined) =>
  (Object.entries(points ?? {}) as Array<[Ability, number]>).filter(([, amount]) => amount !== 0 && amount !== undefined);
const total = (points: Points | undefined) => entries(points).reduce((sum, [, amount]) => sum + amount, 0);
const modifier = (score: number) => Math.floor((score - 10) / 2);

/** How many skills each class lets its character choose: the "Choose 2:" of its Core Traits. */
export function classSkillChoices(name: ClassName): { count: number; among: Skill[] | 'any' } {
  const text = findClass(name)?.coreTraits['Skill Proficiencies'] ?? '';
  const count = Number(/Choose (?:any )?(\d)/.exec(text)?.[1] ?? 0);
  const list = /Choose \d: (.*)$/.exec(text);
  if (!list) return { count, among: 'any' };
  const among = list[1].split(/,\s*(?:or\s+)?|\s+or\s+/).map(skillKey).filter((skill): skill is Skill => skill !== null);
  return { count, among };
}

/** The ability score points a feat gives of itself: how many, among which scores, and up to what score. */
export function featPointsRule(feat: Feat, rules: CharacterRules): { total: number; among: Ability[]; cap: number } | null {
  const cap = feat.category === 'Epic Boon' ? 30 : abilityScoreCap(rules);
  if (feat.name === 'Ability Score Improvement') return { total: 2, among: [...ABILITIES], cap };
  const benefit = feat.benefits.find((entry) => entry.name === 'Ability Score Increase');
  if (!benefit) return null;
  const named = ABILITIES.filter((ability) => new RegExp(`\\b${label(ability)}\\b`).test(benefit.text));
  return { total: 1, among: named.length > 0 ? named : [...ABILITIES], cap };
}

/** Why a character cannot take a feat now, or null when it can. */
function prerequisiteRefusal(feat: Feat, at: { level: number; tracks: Tracks; scores: Scores }): string | null {
  for (const part of (feat.prerequisite ?? '').split(',').map((text) => text.trim()).filter(Boolean)) {
    const level = /^Level (\d+)\+$/.exec(part);
    const score = /^(.*) (\d+)\+$/.exec(part);
    if (level) {
      if (at.level < Number(level[1])) return `${feat.name} needs level ${level[1]}`;
    } else if (part === 'Fighting Style Feature') {
      const has = at.tracks.some((name) => (name === 'Fighter' && at.level >= 1) || ((name === 'Paladin' || name === 'Ranger') && at.level >= 2));
      if (!has) return `${feat.name} needs the Fighting Style feature`;
    } else if (part === 'Spellcasting Feature') {
      if (casterLevel(at.tracks, at.level) === 0 && !pactMagic(at.tracks, at.level)) return `${feat.name} needs the Spellcasting feature`;
    } else if (score) {
      const among = ABILITIES.filter((ability) => score[1].includes(label(ability)));
      if (!among.some((ability) => at.scores[ability] >= Number(score[2]))) return `${feat.name} needs ${part}`;
    }
  }
  return null;
}

export function buildCharacter(choices: CharacterChoices, rules: CharacterRules): BuildResult {
  const errors: string[] = [];
  const species = findSpecies(choices.species);
  const background = findBackground(choices.background);
  if (!species) errors.push('Choose a species of the reference document');
  if (!background) errors.push('Choose a background of the reference document');
  const classRefusal = tracksRefusal(choices.classes, rules);
  if (classRefusal) errors.push(classRefusal);
  if (!Number.isInteger(choices.level) || choices.level < 1 || choices.level > MAX_LEVEL) errors.push('A character is level 1 to 20');
  if (!choices.name.trim()) errors.push('A character needs a name');
  for (const ability of ABILITIES) {
    const score = choices.abilityScores[ability];
    if (!Number.isInteger(score) || score < 3 || score > 18) errors.push(`${label(ability)} starts between 3 and 18`);
  }
  if (errors.length > 0 || !species || !background) return { ok: false, errors };

  const tracks = choices.classes as unknown as Tracks;
  const level = choices.level;
  const scores: Scores = { ...choices.abilityScores };
  const add = (points: Points | undefined) => {
    for (const [ability, amount] of entries(points)) scores[ability] += amount;
  };

  // ── Origin ─────────────────────────────────────────────────────────────
  const increase = backgroundIncreaseRefusal(choices.backgroundIncreases, scores, background, rules);
  if (increase) errors.push(increase);
  else add(choices.backgroundIncreases);

  const taken: Feat[] = [];
  const origin = originFeatChoices(background, rules).find((feat) => feat.id === findFeat(choices.originFeat)?.id);
  if (!origin) {
    errors.push(rules.freeOriginFeat ? 'Choose an origin feat' : `${background.name} gives the ${background.feat} feat`);
  } else {
    taken.push(origin);
  }

  // ── Feats and ability scores, level by level ───────────────────────────
  const due: Improvement[] = improvements(tracks, level, rules);
  const chosen = [...choices.improvements].sort((a, b) => a.level - b.level);
  const unexpected = chosen.filter((choice) => !due.some((gain) => gain.level === choice.level));
  if (unexpected.length > 0) errors.push(`Level ${unexpected[0].level} gives no feat or ability score points`);
  for (const gain of due) {
    const picks = chosen.filter((choice) => choice.level === gain.level);
    // Level 19 gives an Epic Boon, and with the house rule nothing else; a level never gives two of the same kind.
    const pick = picks[due.filter((other) => other.level === gain.level).indexOf(gain)];
    if (!pick) {
      errors.push(`Level ${gain.level} gives a feat${gain.abilityPoints ? ` and ${gain.abilityPoints} ability score points` : ''}: choose them`);
      continue;
    }
    const feat = findFeat(pick.feat);
    if (!feat) {
      errors.push(`"${pick.feat}" is not a feat of the reference document`);
      continue;
    }
    const refusal =
      prerequisiteRefusal(feat, { level: gain.level, tracks, scores }) ??
      (feat.category === 'Origin' || feat.category === 'General' || feat.category === 'Fighting Style' || gain.level >= 19
        ? null
        : `${feat.name} is an Epic Boon, which level ${gain.level} does not give`) ??
      (!feat.repeatable && taken.some((other) => other.id === feat.id) ? `${feat.name} can be taken once` : null);
    if (refusal) {
      errors.push(refusal);
      continue;
    }
    taken.push(feat);

    const rule = featPointsRule(feat, rules);
    const featPoints = entries(pick.featPoints);
    if (!rule && featPoints.length > 0) errors.push(`${feat.name} gives no ability score points`);
    if (rule) {
      const wrong =
        total(pick.featPoints) !== rule.total ||
        featPoints.some(([ability, amount]) => amount < 1 || !rule.among.includes(ability)) ||
        featPoints.some(([ability, amount]) => scores[ability] + amount > rule.cap);
      if (wrong) errors.push(`${feat.name} at level ${gain.level} gives ${rule.total} to ${rule.among.length === 6 ? 'ability scores' : rule.among.map(label).join(' or ')}, to at most ${rule.cap}`);
      else add(pick.featPoints);
    }

    const extra = entries(pick.abilityPoints);
    if (gain.abilityPoints === 0 && extra.length > 0) errors.push(`Level ${gain.level} gives a feat, and no other ability score points`);
    if (gain.abilityPoints > 0) {
      const cap = abilityScoreCap(rules);
      const wrong = total(pick.abilityPoints) !== gain.abilityPoints || extra.some(([ability, amount]) => amount < 1 || scores[ability] + amount > cap);
      if (wrong) errors.push(`Level ${gain.level} gives ${gain.abilityPoints} ability score points, to at most ${cap}: 2 to one score or 1 to two`);
      else add(pick.abilityPoints);
    }
  }

  // ── Skills ─────────────────────────────────────────────────────────────
  const fromBackground = background.skillProficiencies.map(skillKey).filter((skill): skill is Skill => skill !== null);
  const picks = [...new Set(choices.skills)];
  if (picks.length !== choices.skills.length || picks.some((skill) => !(skill in SKILLS))) errors.push('Each skill is chosen once, from the eighteen');
  // The first class gives its full choice of skills. A second class adds none: gestalt widens the list, not the count.
  const allowance = classSkillChoices(tracks[0]).count;
  const lists = tracks.map((name) => classSkillChoices(name).among);
  const open = lists.some((among) => among === 'any');
  const offered = new Set(lists.flatMap((among) => (among === 'any' ? [] : among)));
  if (picks.length !== allowance) errors.push(`${tracks[0]} chooses ${allowance} skills`);
  if (!open && picks.some((skill) => !offered.has(skill))) errors.push(`Choose skills from the list of ${tracks.join(' or ')}`);
  if (picks.some((skill) => fromBackground.includes(skill))) errors.push(`${background.name} already gives ${background.skillProficiencies.join(' and ')}`);

  if (errors.length > 0) return { ok: false, errors };

  // ── The sheet ──────────────────────────────────────────────────────────
  const bonus = proficiencyBonus(level);
  const mods = Object.fromEntries(ABILITIES.map((ability) => [ability, modifier(scores[ability])])) as Scores;
  const saves = savingThrowProficiencies(tracks);
  const proficient = new Set<Skill>([...fromBackground, ...picks]);
  const toughness = species.traits.some((trait) => trait.name === 'Dwarven Toughness') ? level : 0;
  const hitPoints = fixedHitPoints(tracks, level, mods.con) + toughness;
  const alert = taken.some((feat) => feat.name === 'Alert') ? bonus : 0;
  const slots = spellSlots(tracks, level);
  const pact = pactMagic(tracks, level);
  if (pact) slots[pact.slotLevel - 1] += pact.slots;
  const classes = tracks.map((name) => findClass(name)!);
  const core = (key: string) => [...new Set(classes.map((entry) => entry.coreTraits[key]).filter((text) => text && text !== 'None'))].join('; ');
  const casts = slots.some((count) => count > 0);

  const sheet: Record<string, unknown> = {
    characterName: choices.name.trim(),
    class: tracks.join(' / '),
    level,
    race: species.name,
    background: background.name,
    experiencePoints: 0,
    inspiration: false,
    proficiencyBonus: bonus,
    stats: Object.fromEntries(ABILITIES.map((ability) => [ABILITY_NAMES[ability], { score: scores[ability], modifier: mods[ability] }])),
    savingThrows: Object.fromEntries(
      ABILITIES.map((ability) => [ABILITY_NAMES[ability], { proficient: saves.includes(ability), bonus: mods[ability] + (saves.includes(ability) ? bonus : 0) }])
    ),
    skills: Object.fromEntries(
      (Object.keys(SKILLS) as Skill[]).map((skill) => [
        skill,
        { proficient: proficient.has(skill), expertise: false, bonus: mods[SKILLS[skill]] + (proficient.has(skill) ? bonus : 0) },
      ])
    ),
    passivePerception: 10 + mods.wis + (proficient.has('perception') ? bonus : 0),
    armorClass: Math.max(1, 10 + mods.dex),
    initiative: mods.dex + alert,
    initiativeBonus: alert,
    speed: species.speedFeet,
    hp: { maximum: hitPoints, current: hitPoints, temporary: 0 },
    conditions: [],
    exhaustionLevel: 0,
    hitDice: [{ class: tracks.join(' / '), die: `d${hitDie(tracks)}`, maximum: level, remaining: level }],
    deathSaves: { successes: 0, failures: 0 },
    attacks: [],
    proficiencies: {
      armor: core('Armor Training'),
      weapons: core('Weapon Proficiencies'),
      tools: [core('Tool Proficiencies'), background.toolProficiency].filter(Boolean).join('; '),
      languages: '',
    },
    featuresAndTraits: [
      ...species.traits.map((trait) => ({
        name: `${trait.name} (${species.name})`,
        description: [trait.text, ...(trait.options ?? []).map((option) => `${option.name}. ${option.text}`)].join('\n\n'),
      })),
      ...taken.map((feat) => ({
        name: `${feat.name} (${feat.category} feat)`,
        description: [feat.description, ...feat.benefits.map((benefit) => `${benefit.name}. ${benefit.text}`), feat.repeatable ? `Repeatable. ${feat.repeatable}` : '']
          .filter(Boolean)
          .join('\n\n'),
      })),
      ...buildFeatures(tracks, level).map((feature) => ({
        name: `${feature.name} (${feature.from} ${feature.level})`,
        description: feature.text.join('\n\n'),
      })),
    ],
    ...(casts
      ? {
          spellcasting: {
            class: tracks.filter((name) => CLASSES[name].caster).join(' / '),
            cantrips: [],
            spells: [],
            slots: Object.fromEntries(slots.map((count, index) => [String(index + 1), { total: count, expended: 0 }])),
          },
        }
      : {}),
  };

  return { ok: true, sheet, summary: { scores, hitPoints, proficiencyBonus: bonus, feats: taken.map((feat) => feat.name) } };
}
