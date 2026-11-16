// ============================================
// A Ranger's features and the Hunter subclass, by the D&D rules (SRD 5.2.1)
//
// Ranger:
//   • Tireless (10): a Magic action gives Temporary Hit Points of 1d8 plus the
//     Wisdom modifier (at least 1), as many times as the Wisdom modifier (at
//     least once) until a Long Rest; and a Short Rest takes off one level of
//     Exhaustion.
//   • Relentless Hunter (13): damage cannot break Concentration on Hunter's
//     Mark.
//   • Nature's Veil (14): a Bonus Action gives the Invisible condition until
//     the end of the Ranger's next turn, as many times as the Wisdom modifier
//     (at least once) until a Long Rest.
//   • Precise Hunter (17): Advantage on attack rolls against the creature
//     marked by Hunter's Mark.
//   • Foe Slayer (20): Hunter's Mark's damage die is a d10.
//
// Hunter:
//   • Hunter's Lore (3): the Immunities, Resistances and Vulnerabilities of
//     the creature marked by Hunter's Mark are known.
//   • Hunter's Prey (3), one of: Colossus Slayer (once per turn, a weapon hit
//     on a creature missing any Hit Points deals 1d8 more) or Horde Breaker
//     (once on each of its turns, another attack with the same weapon against
//     a different creature within 5 feet of the first target, in the weapon's
//     range, not yet attacked this turn).
//   • Defensive Tactics (7), one of: Escape the Horde (Opportunity Attacks
//     against it have Disadvantage) or Multiattack Defense (a creature that
//     hits it has Disadvantage on its other attack rolls against it this
//     turn).
//   • Superior Hunter's Prey (11): once per turn, damage dealt to the marked
//     creature also deals Hunter's Mark's extra damage to a different creature
//     within 30 feet of it.
//   • Superior Hunter's Defense (15): a Reaction when it takes damage gives
//     Resistance to that damage's type until the end of the turn.
//
// A class feature is read from the sheet's class and level, or from a feature
// of its name. The option chosen for Hunter's Prey and Defensive Tactics is
// read from a feature's name, which must say it ("Hunter's Prey: Colossus
// Slayer", or just "Colossus Slayer"): the feature's own text names both.
//
// Deft Explorer, Roving and Feral Senses change the sheet's own numbers
// (skills, Speed, senses) and are the sheet's to carry.
//
// Pure: a sheet in, what the feature gives out.
// ============================================

import type { CombatAction, DamageComponent } from './actions';
import { rollDie, type RollDie } from './d20';
import type { DamageType, Defences } from './damage';
import { featureName, readFeatures } from './featureEffects';
import { abilityModifier, classLevel } from './resources';

type Sheet = Record<string, unknown>;

/** A name with its apostrophes written one way: a sheet writes "Hunter's" or "Hunter’s". */
const plain = (name: string) => name.toLowerCase().replace(/[’']/g, "'");

/** Whether the sheet lists a feature whose name is this, or says it ("Hunter's Prey: Colossus Slayer" says Colossus Slayer). */
function lists(sheet: Sheet, name: string): boolean {
  const wanted = plain(name);
  return readFeatures(sheet).some((feature) => {
    const listed = plain(feature.name);
    return plain(featureName(feature.name)) === wanted || new RegExp(`\\b${wanted}\\b`).test(listed);
  });
}

/** Whether the sheet's subclass is the Hunter. */
function isHunter(sheet: Sheet): boolean {
  return typeof sheet.subclass === 'string' && /\bhunter\b/i.test(sheet.subclass) && classLevel(sheet, 'Ranger') > 0;
}

export type RangerFeature = 'Tireless' | 'Relentless Hunter' | "Nature's Veil" | 'Precise Hunter' | 'Foe Slayer';

const RANGER_LEVELS: Readonly<Record<RangerFeature, number>> = {
  Tireless: 10,
  'Relentless Hunter': 13,
  "Nature's Veil": 14,
  'Precise Hunter': 17,
  'Foe Slayer': 20,
};

/** Whether the sheet has a Ranger feature: a Ranger of its level, or a sheet that lists it. */
export function hasRangerFeature(sheet: Sheet | null | undefined, feature: RangerFeature): boolean {
  if (!sheet) return false;
  return classLevel(sheet, 'Ranger') >= RANGER_LEVELS[feature] || lists(sheet, feature);
}

export type HunterFeature = "Hunter's Lore" | "Superior Hunter's Prey" | "Superior Hunter's Defense";

const HUNTER_LEVELS: Readonly<Record<HunterFeature, number>> = {
  "Hunter's Lore": 3,
  "Superior Hunter's Prey": 11,
  "Superior Hunter's Defense": 15,
};

/** Whether the sheet has a Hunter feature: a Hunter of its level, or a sheet that lists it. */
export function hasHunterFeature(sheet: Sheet | null | undefined, feature: HunterFeature): boolean {
  if (!sheet) return false;
  return (isHunter(sheet) && classLevel(sheet, 'Ranger') >= HUNTER_LEVELS[feature]) || lists(sheet, feature);
}

export type HuntersPrey = 'colossus' | 'horde';

/** The Hunter's Prey option a sheet names; null when no feature's name says one. Colossus Slayer when it names both. */
export function huntersPrey(sheet: Sheet | null | undefined): HuntersPrey | null {
  if (!sheet) return null;
  if (lists(sheet, 'Colossus Slayer')) return 'colossus';
  return lists(sheet, 'Horde Breaker') ? 'horde' : null;
}

export type DefensiveTactic = 'escape' | 'multiattack';

/** The Defensive Tactics option a sheet names; null when no feature's name says one. Escape the Horde when it names both. */
export function defensiveTactic(sheet: Sheet | null | undefined): DefensiveTactic | null {
  if (!sheet) return null;
  if (lists(sheet, 'Escape the Horde')) return 'escape';
  return lists(sheet, 'Multiattack Defense') ? 'multiattack' : null;
}

/** An attack made with a weapon: not a spell, not an Unarmed Strike. */
export function isWeaponAttack(action: CombatAction): boolean {
  return action.attack !== undefined && action.source !== 'spell' && action.source !== 'unarmed' && action.unarmed === undefined;
}

/** Whether Colossus Slayer adds its die to a hit: a weapon, against a creature missing any of its Hit Points. */
export function colossusSlayerApplies(action: CombatAction, targetHp: { current: number; max: number } | null | undefined): boolean {
  return isWeaponAttack(action) && !!targetHp && targetHp.current < targetHp.max;
}

/** Colossus Slayer's extra damage: 1d8 of the weapon's type. */
export function colossusSlayerDamage(action: CombatAction): DamageComponent {
  return { roll: { count: 1, sides: 8 }, type: action.attack?.damage[0]?.type ?? null };
}

/** The extra damage of Hunter's Mark on a hit: 1d6 Force, 1d10 with Foe Slayer. */
export function huntersMarkDamage(sheet: Sheet | null | undefined): DamageComponent & { type: DamageType } {
  return { roll: { count: 1, sides: hasRangerFeature(sheet, 'Foe Slayer') ? 10 : 6 }, type: 'force' };
}

/** Tireless: the Temporary Hit Points its Magic action gives, 1d8 plus the Wisdom modifier, at least 1. */
export function tirelessTemporaryHitPoints(sheet: Sheet, roll: RollDie = rollDie): { rolled: number; modifier: number; total: number } {
  const rolled = roll(8);
  const modifier = abilityModifier(sheet, 'wisdom');
  return { rolled, modifier, total: Math.max(1, rolled + modifier) };
}

/** Tireless: a Short Rest takes one level off a Ranger's Exhaustion. The sheet as it leaves it, and what to say. */
export function tirelessShortRest(sheet: Sheet): { sheet: Sheet; regained: string[] } {
  const level = typeof sheet.exhaustionLevel === 'number' && Number.isInteger(sheet.exhaustionLevel) ? sheet.exhaustionLevel : 0;
  if (level <= 0 || !hasRangerFeature(sheet, 'Tireless')) return { sheet, regained: [] };
  return { sheet: { ...sheet, exhaustionLevel: level - 1 }, regained: ['one level of Exhaustion off (Tireless)'] };
}

/** Hunter's Lore: what the Hunter knows of the creature it marks, in one line. */
export function huntersLore(name: string, defences: Defences | undefined): string {
  const parts = [
    ...(defences?.immunities?.length ? [`Immunities: ${defences.immunities.join(', ')}`] : []),
    ...(defences?.resistances?.length ? [`Resistances: ${defences.resistances.join(', ')}`] : []),
    ...(defences?.vulnerabilities?.length ? [`Vulnerabilities: ${defences.vulnerabilities.join(', ')}`] : []),
  ];
  return `Hunter's Lore: ${name} has ${parts.length > 0 ? parts.join('; ') : 'no Immunities, Resistances or Vulnerabilities'}`;
}

/** The option a Hunter is offered for a damage type it just took: "Superior Hunter's Defense (fire)". */
export const SUPERIOR_DEFENSE = "Superior Hunter's Defense";

export function superiorDefenseOptions(types: ReadonlyArray<DamageType | null>, defences: Defences | undefined): string[] {
  const known = new Set<DamageType>();
  for (const type of types) {
    if (type === null || defences?.resistances?.includes(type) || defences?.immunities?.includes(type)) continue;
    known.add(type);
  }
  return [...known].map((type) => `${SUPERIOR_DEFENSE} (${type})`);
}

/** The damage type a chosen Superior Hunter's Defense option names; null for another option. */
export function superiorDefenseType(choice: string | null): DamageType | null {
  const found = choice ? /^Superior Hunter's Defense \(([a-z]+)\)$/.exec(choice) : null;
  return found ? (found[1] as DamageType) : null;
}

/** Defences with a Resistance added. */
export function withResistance(defences: Defences | undefined, types: readonly DamageType[]): Defences | undefined {
  if (types.length === 0) return defences;
  return { ...(defences ?? {}), resistances: [...new Set([...(defences?.resistances ?? []), ...types])] };
}
