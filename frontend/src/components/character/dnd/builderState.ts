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
  DndFeatureChoice,
  DndFeatureOption,
  DndImprovement,
  DndPoints,
  DndRulesCatalogue,
  DndSpellSummary,
} from '@/types';
import { findSrdWeapon, proficientWith } from '@/utils/srdWeapons';

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
  /** The options of features, by choice id: one label for each to take, '' for one not chosen yet. */
  featureChoices: Record<string, string[]>;
  /** The option letter of the first class's starting equipment, and of the background's; '' for none yet. */
  classEquipment: string;
  backgroundEquipment: string;
  /** The kinds of weapons carried whose mastery the character uses. */
  masteries: string[];
  /** By casting class, the spells picked. */
  spells: Record<string, SpellState>;
}

export interface SpellState {
  cantrips: string[];
  prepared: string[];
  /** A Wizard's spellbook. */
  spellbook: string[];
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
    featureChoices: {},
    classEquipment: '',
    backgroundEquipment: '',
    masteries: [],
    spells: {},
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

/** A choice a feature or the species gives the character, and how many options of it. */
export interface DueChoice {
  choice: DndFeatureChoice;
  count: number;
}

/**
 * The choices the character's species and classes give at its level, in the
 * order the rules list them. One the build works out by itself is not asked.
 */
export function dueChoices(state: BuilderState, catalogue: DndRulesCatalogue): DueChoice[] {
  const classes = [state.classA, state.classB].filter(Boolean);
  return (catalogue.featureChoices ?? []).flatMap((choice) => {
    if (!choice.asked) return [];
    const count = choice.species
      ? choice.species === state.species
        ? 1
        : 0
      : choice.class && classes.includes(choice.class)
        ? (choice.counts[state.level - 1] ?? 0)
        : 0;
    return count > 0 ? [{ choice, count }] : [];
  });
}

/** The labels picked for a choice, one entry per option to take. */
export function choicePicks(state: BuilderState, due: DueChoice): string[] {
  const picks = state.featureChoices[due.choice.id] ?? [];
  return Array.from({ length: due.count }, (_, index) => picks[index] ?? '');
}

/**
 * What one slot of a choice may take: not an option another slot has, nor
 * what another choice already wrote (the same Fighting Style feat), nor one
 * above the character's level or without the option it needs.
 */
export function choiceOptions(
  state: BuilderState,
  catalogue: DndRulesCatalogue,
  due: DueChoice,
  slot: number
): DndFeatureOption[] {
  const find = (choice: DndFeatureChoice, label: string) =>
    choice.options.find((option) => option.label === label);
  const others = choicePicks(state, due)
    .filter((_, index) => index !== slot)
    .flatMap((label) => find(due.choice, label) ?? []);
  const elsewhere = new Set(
    dueChoices(state, catalogue)
      .filter((other) => other.choice.id !== due.choice.id)
      .flatMap((other) =>
        choicePicks(state, other).map((label) => find(other.choice, label)?.name)
      )
  );
  return due.choice.options.filter(
    (option) =>
      (option.minLevel ?? 1) <= state.level &&
      !elsewhere.has(option.name) &&
      !others.includes(option) &&
      (!option.group || option.repeatable || !others.some((other) => other.group === option.group)) &&
      (!option.needs || others.some((other) => other.group === option.needs))
  );
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
  const featureChoices: Record<string, string[]> = {};
  for (const due of dueChoices(state, catalogue)) {
    const picks = choicePicks(state, due).filter(Boolean);
    if (picks.length > 0) featureChoices[due.choice.id] = picks;
  }
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
    ...(Object.keys(featureChoices).length > 0 ? { featureChoices } : {}),
    ...(state.classEquipment && state.backgroundEquipment
      ? { equipment: { class: state.classEquipment, background: state.backgroundEquipment } }
      : {}),
    ...(masteryCount(state, catalogue) > 0 && state.masteries.length > 0
      ? {
          masteries: state.masteries
            .filter((name) => masteryWeapons(state, catalogue).includes(name))
            .slice(0, masteryCount(state, catalogue)),
        }
      : {}),
    ...(spellAllowances(state, catalogue).length > 0
      ? {
          spells: spellAllowances(state, catalogue).map((allowance) => {
            const picks = spellPicks(state, catalogue, allowance);
            return {
              class: allowance.class,
              cantrips: picks.cantrips,
              prepared: picks.prepared,
              ...(allowance.spellbook !== null ? { spellbook: picks.spellbook } : {}),
            };
          }),
        }
      : {}),
  };
}

/** What the form still lacks before it is worth asking the server, in the order it is laid out. */
export function missing(name: string, state: BuilderState, catalogue: DndRulesCatalogue): string[] {
  const out: string[] = [];
  if (name.trim().length < 2) out.push('a name');
  if (!state.species) out.push('a species');
  const lacking = (due: DueChoice) => choicePicks(state, due).filter((pick) => !pick).length;
  const choices = dueChoices(state, catalogue);
  for (const due of choices.filter((entry) => entry.choice.species)) {
    if (lacking(due) > 0) out.push(`the ${due.choice.title}`);
  }
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
  for (const due of choices.filter((entry) => !entry.choice.species)) {
    const left = lacking(due);
    if (left > 0) out.push(due.count === 1 ? due.choice.title : `${left} of ${due.choice.title}`);
  }
  const packages = equipmentPackages(state, catalogue);
  if (packages.fromClass.length > 0 && !state.classEquipment)
    out.push(`the ${state.classA}'s starting equipment`);
  if (packages.fromBackground.length > 0 && !state.backgroundEquipment)
    out.push(`the ${state.background}'s starting equipment`);
  for (const allowance of spellAllowances(state, catalogue)) {
    const picks = spellPicks(state, catalogue, allowance);
    const short = (have: number, want: number, what: string) => {
      if (have !== want) out.push(`${want} ${what} for ${allowance.class}`);
    };
    short(picks.cantrips.length, allowance.cantrips, 'cantrips');
    if (allowance.spellbook !== null)
      short(picks.spellbook.length, allowance.spellbook, 'spells in the spellbook');
    short(picks.prepared.length, allowance.prepared, 'prepared spells');
  }
  return out;
}

// ── Starting equipment and Weapon Mastery ────────────────────────────────

/** The starting equipment the first class and the background offer. */
export function equipmentPackages(state: BuilderState, catalogue: DndRulesCatalogue) {
  const first = catalogue.classes.find((entry) => entry.name === state.classA);
  const background = catalogue.backgrounds.find((entry) => entry.name === state.background);
  return {
    fromClass: first?.startingEquipment ?? [],
    fromBackground: background?.startingEquipment ?? [],
  };
}

/** The SRD weapons in the packages chosen, once each, in their order. */
export function carriedWeapons(state: BuilderState, catalogue: DndRulesCatalogue): string[] {
  const { fromClass, fromBackground } = equipmentPackages(state, catalogue);
  const chosen = [
    fromClass.find((entry) => entry.option === state.classEquipment),
    fromBackground.find((entry) => entry.option === state.backgroundEquipment),
  ];
  const names = chosen.flatMap((entry) => entry?.items ?? []).flatMap((item) => item.weapon ?? []);
  return [...new Set(names)];
}

/** How many kinds of weapons the character's Weapon Mastery covers: the most its classes give. */
export function masteryCount(state: BuilderState, catalogue: DndRulesCatalogue): number {
  return Math.max(
    0,
    ...classesOf(state, catalogue).map((entry) => entry.weaponMastery?.[state.level - 1] ?? 0)
  );
}

/**
 * The carried weapons Weapon Mastery can take: ones the classes give
 * proficiency with, and melee ones when only a Barbarian has the feature.
 */
export function masteryWeapons(state: BuilderState, catalogue: DndRulesCatalogue): string[] {
  const classes = classesOf(state, catalogue);
  const proficiencies = classes
    .map((entry) => entry.coreTraits['Weapon Proficiencies'] ?? '')
    .join('; ');
  const masters = classes.filter((entry) => (entry.weaponMastery?.[state.level - 1] ?? 0) > 0);
  return carriedWeapons(state, catalogue).filter((name) => {
    const weapon = findSrdWeapon(name);
    if (!weapon || !proficientWith(weapon, proficiencies)) return false;
    return masters.some((entry) => entry.name !== 'Barbarian' || weapon.kind === 'melee');
  });
}

// ── Spells ───────────────────────────────────────────────────────────────

/** What one casting class chooses at the character's level, as the server counts it. */
export interface SpellAllowance {
  class: string;
  cantrips: number;
  prepared: number;
  maxSpellLevel: number;
  spellbook: number | null;
  alwaysPrepared: string[];
}

/** The class's cantrips (level 0) or its spells of levels 1 to `maxLevel`. */
export function classSpells(
  catalogue: DndRulesCatalogue,
  name: string,
  kind: 'cantrip' | 'spell',
  maxLevel = 9
): DndSpellSummary[] {
  return (catalogue.spells ?? []).filter(
    (spell) =>
      spell.classes.includes(name) &&
      (kind === 'cantrip' ? spell.level === 0 : spell.level >= 1 && spell.level <= maxLevel)
  );
}

/** Each casting class of the character, with what its table lets it choose. */
export function spellAllowances(
  state: BuilderState,
  catalogue: DndRulesCatalogue
): SpellAllowance[] {
  const at = state.level - 1;
  return classesOf(state, catalogue).flatMap((entry) => {
    const casting = entry.spellcasting;
    if (!casting) return [];
    const alwaysPrepared = [
      ...new Set(
        casting.alwaysPrepared.filter((one) => one.level <= state.level).map((one) => one.spell)
      ),
    ];
    const maxSpellLevel = casting.maxSpellLevel[at] ?? 0;
    const pool = classSpells(catalogue, entry.name, 'spell', maxSpellLevel).filter(
      (spell) => !alwaysPrepared.includes(spell.name)
    ).length;
    const spellbook = casting.spellbook ? Math.min(casting.spellbook[at] ?? 0, pool) : null;
    return [
      {
        class: entry.name,
        cantrips: Math.min(
          casting.cantrips[at] ?? 0,
          classSpells(catalogue, entry.name, 'cantrip').length
        ),
        prepared: Math.min(casting.prepared[at] ?? 0, spellbook ?? pool),
        maxSpellLevel,
        spellbook,
        alwaysPrepared,
      },
    ];
  });
}

/**
 * What can be picked for a class: its cantrips, its spells of levels it has
 * slots for less the ones always prepared, and, for a Wizard, the prepared
 * spells from among those in its book.
 */
export function spellOptions(
  state: BuilderState,
  catalogue: DndRulesCatalogue,
  allowance: SpellAllowance
): { cantrips: DndSpellSummary[]; spells: DndSpellSummary[]; prepared: DndSpellSummary[] } {
  const cantrips = classSpells(catalogue, allowance.class, 'cantrip');
  const spells = classSpells(catalogue, allowance.class, 'spell', allowance.maxSpellLevel).filter(
    (spell) => !allowance.alwaysPrepared.includes(spell.name)
  );
  const book = state.spells[allowance.class]?.spellbook ?? [];
  const prepared =
    allowance.spellbook === null ? spells : spells.filter((spell) => book.includes(spell.name));
  return { cantrips, spells, prepared };
}

/** The picks of a class that its options still allow, at most as many as it takes. */
export function spellPicks(
  state: BuilderState,
  catalogue: DndRulesCatalogue,
  allowance: SpellAllowance
): SpellState {
  const picked = state.spells[allowance.class] ?? { cantrips: [], prepared: [], spellbook: [] };
  const options = spellOptions(state, catalogue, allowance);
  const keep = (names: string[], among: DndSpellSummary[], max: number) =>
    names.filter((name) => among.some((spell) => spell.name === name)).slice(0, max);
  return {
    cantrips: keep(picked.cantrips, options.cantrips, allowance.cantrips),
    spellbook:
      allowance.spellbook === null
        ? []
        : keep(picked.spellbook, options.spells, allowance.spellbook),
    prepared: keep(picked.prepared, options.prepared, allowance.prepared),
  };
}
