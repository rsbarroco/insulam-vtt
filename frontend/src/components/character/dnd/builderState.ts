// ============================================
// The state of the guided D&D character builder
//
// What the form holds while a player chooses, and how it becomes the choices
// the server builds a sheet from (POST …/rules/dnd/build). The server decides
// what is allowed; this only lays the choices out and says what is still
// missing so the form can show it.
//
// Pure: no React.
// ============================================

import type {
  DndAbility,
  DndCharacterChoices,
  DndClassSummary,
  DndFeat,
  DndImprovement,
  DndPoints,
  DndRulesCatalogue,
} from '@/types';

export const ABILITIES: readonly DndAbility[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_LABELS: Record<DndAbility, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

/** The eighteen skills as the sheet keys them, with the name the rules print. */
export const SKILL_LABELS: Record<string, string> = {
  acrobatics: 'Acrobatics',
  animalHandling: 'Animal Handling',
  arcana: 'Arcana',
  athletics: 'Athletics',
  deception: 'Deception',
  history: 'History',
  insight: 'Insight',
  intimidation: 'Intimidation',
  investigation: 'Investigation',
  medicine: 'Medicine',
  nature: 'Nature',
  perception: 'Perception',
  performance: 'Performance',
  persuasion: 'Persuasion',
  religion: 'Religion',
  sleightOfHand: 'Sleight of Hand',
  stealth: 'Stealth',
  survival: 'Survival',
};

export const STANDARD_ARRAY: Record<DndAbility, number> = {
  str: 15,
  dex: 14,
  con: 13,
  int: 12,
  wis: 10,
  cha: 8,
};

/** An ability picked for one point, or nothing picked yet. */
export type Pick = DndAbility | '';

export interface ImprovementState {
  feat: string;
  /** One entry per point the feat itself gives. */
  featPicks: Pick[];
  /** One entry per point the house rule adds beside the feat. */
  extraPicks: Pick[];
}

export interface BuilderState {
  species: string;
  background: string;
  classA: string;
  /** The second class of a gestalt character, or '' for none. */
  classB: string;
  level: number;
  scores: Record<DndAbility, number>;
  /** How the background's three points are spread. */
  backgroundSpread: '2+1' | '1+1+1';
  /** In `2+1`, the score that takes 2 and the one that takes 1; in `1+1+1`, the three. */
  backgroundPicks: Pick[];
  originFeat: string;
  skills: string[];
  /** By `level:kind`. */
  improvements: Record<string, ImprovementState>;
}

export function initialState(): BuilderState {
  return {
    species: '',
    background: '',
    classA: '',
    classB: '',
    level: 1,
    scores: { ...STANDARD_ARRAY },
    backgroundSpread: '2+1',
    backgroundPicks: ['', '', ''],
    originFeat: '',
    skills: [],
    improvements: {},
  };
}

export const improvementKey = (gain: DndImprovement) => `${gain.level}:${gain.kind}`;

const classesOf = (state: BuilderState, catalogue: DndRulesCatalogue): DndClassSummary[] =>
  [state.classA, state.classB]
    .map((name) => catalogue.classes.find((entry) => entry.name === name))
    .filter((entry): entry is DndClassSummary => entry !== undefined);

/**
 * The levels that give the character a feat or ability score points: those
 * of each of its classes, once where both give the same.
 */
export function dueImprovements(
  state: BuilderState,
  catalogue: DndRulesCatalogue
): DndImprovement[] {
  const byKey = new Map<string, DndImprovement>();
  for (const entry of classesOf(state, catalogue)) {
    for (const gain of entry.improvements) {
      if (gain.level <= state.level) byKey.set(improvementKey(gain), gain);
    }
  }
  return [...byKey.values()].sort((a, b) => a.level - b.level || a.kind.localeCompare(b.kind));
}

/** How many skills the character chooses, and from which. */
export function skillChoices(
  state: BuilderState,
  catalogue: DndRulesCatalogue
): { count: number; among: string[] } {
  const classes = classesOf(state, catalogue);
  const background = catalogue.backgrounds.find((entry) => entry.name === state.background);
  const taken = new Set(
    (background?.skillProficiencies ?? []).map((name) =>
      Object.keys(SKILL_LABELS).find((key) => SKILL_LABELS[key] === name)
    )
  );
  const any = classes.some((entry) => entry.skillChoices.among === 'any');
  const listed = classes.flatMap((entry) =>
    entry.skillChoices.among === 'any' ? [] : entry.skillChoices.among
  );
  const among = (any ? Object.keys(SKILL_LABELS) : [...new Set(listed)]).filter(
    (skill) => !taken.has(skill)
  );
  among.sort((a, b) => SKILL_LABELS[a].localeCompare(SKILL_LABELS[b]));
  return { count: classes[0]?.skillChoices.count ?? 0, among };
}

/** The abilities a background's points may go to under the campaign's rules. */
export function backgroundAbilities(
  state: BuilderState,
  catalogue: DndRulesCatalogue
): DndAbility[] {
  const background = catalogue.backgrounds.find((entry) => entry.name === state.background);
  if (!background || catalogue.characterRules.freeBackgroundAbilityScores) return [...ABILITIES];
  return ABILITIES.filter((ability) => background.abilityScores.includes(ABILITY_LABELS[ability]));
}

/** The origin feats the character may take under the campaign's rules. */
export function originFeats(state: BuilderState, catalogue: DndRulesCatalogue): DndFeat[] {
  const background = catalogue.backgrounds.find((entry) => entry.name === state.background);
  const origin = catalogue.feats.filter((feat) => feat.category === 'Origin');
  if (!background || catalogue.characterRules.freeOriginFeat) return origin;
  // "Magic Initiate (Cleric)" is the Magic Initiate feat.
  const given = background.feat.replace(/\s*\(.*\)\s*$/, '');
  return origin.filter((feat) => feat.name === given);
}

/** The feats a level's improvement may be spent on. */
export function featsFor(gain: DndImprovement, catalogue: DndRulesCatalogue): DndFeat[] {
  return catalogue.feats.filter((feat) => feat.category !== 'Epic Boon' || gain.level >= 19);
}

const toPoints = (picks: readonly Pick[]): DndPoints => {
  const points: DndPoints = {};
  for (const pick of picks) if (pick) points[pick] = (points[pick] ?? 0) + 1;
  return points;
};

/** The background's points as the form has them spread. */
export function backgroundPoints(state: BuilderState): DndPoints {
  if (state.backgroundSpread === '1+1+1') return toPoints(state.backgroundPicks.slice(0, 3));
  const [two, one] = state.backgroundPicks;
  const points: DndPoints = {};
  if (two) points[two] = 2;
  if (one) points[one] = (points[one] ?? 0) + 1;
  return points;
}

/** The six scores with everything chosen so far added, for the form to show as it goes. */
export function totalScores(
  state: BuilderState,
  catalogue: DndRulesCatalogue
): Record<DndAbility, number> {
  const totals = { ...state.scores };
  const add = (points: DndPoints) => {
    for (const ability of ABILITIES) totals[ability] += points[ability] ?? 0;
  };
  add(backgroundPoints(state));
  for (const gain of dueImprovements(state, catalogue)) {
    const chosen = state.improvements[improvementKey(gain)];
    if (!chosen) continue;
    add(toPoints(chosen.featPicks));
    add(toPoints(chosen.extraPicks));
  }
  return totals;
}

/** The choices as the server takes them. */
export function toChoices(
  name: string,
  state: BuilderState,
  catalogue: DndRulesCatalogue
): DndCharacterChoices {
  return {
    name: name.trim(),
    species: state.species,
    background: state.background,
    classes: [state.classA, state.classB].filter(Boolean),
    level: state.level,
    abilityScores: state.scores,
    backgroundIncreases: backgroundPoints(state),
    originFeat: state.originFeat,
    skills: state.skills,
    improvements: dueImprovements(state, catalogue).flatMap((gain) => {
      const chosen = state.improvements[improvementKey(gain)];
      if (!chosen?.feat) return [];
      const featPoints = toPoints(chosen.featPicks);
      const abilityPoints = toPoints(chosen.extraPicks);
      return [
        {
          level: gain.level,
          feat: chosen.feat,
          ...(Object.keys(featPoints).length > 0 ? { featPoints } : {}),
          ...(Object.keys(abilityPoints).length > 0 ? { abilityPoints } : {}),
        },
      ];
    }),
  };
}

/** What the form still lacks before it is worth asking the server, in the order it is laid out. */
export function missing(name: string, state: BuilderState, catalogue: DndRulesCatalogue): string[] {
  const out: string[] = [];
  if (name.trim().length < 2) out.push('a name');
  if (!state.species) out.push('a species');
  if (!state.background) out.push('a background');
  if (!state.classA) out.push('a class');
  const spread = state.backgroundSpread === '2+1' ? 2 : 3;
  if (state.backgroundPicks.slice(0, spread).some((pick) => !pick))
    out.push('the background’s ability scores');
  if (!state.originFeat) out.push('an origin feat');
  const { count } = skillChoices(state, catalogue);
  if (state.classA && state.skills.length !== count) out.push(`${count} skills`);
  for (const gain of dueImprovements(state, catalogue)) {
    const chosen = state.improvements[improvementKey(gain)];
    const unfinished =
      !chosen?.feat ||
      chosen.featPicks.some((pick) => !pick) ||
      chosen.extraPicks.some((pick) => !pick);
    if (unfinished)
      out.push(`the level ${gain.level} ${gain.kind === 'epicBoon' ? 'Epic Boon' : 'feat'}`);
  }
  return out;
}
