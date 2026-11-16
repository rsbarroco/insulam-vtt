// ============================================
// A Druid's class features and the Circle of the Land's, by the D&D rules
// (SRD 5.2.1). Wild Shape itself is in wildShape.ts.
//
//   • Wild Companion (Druid 2): as a Magic action, a spell slot or a use of
//     Wild Shape casts Find Familiar. The server spends it; the familiar is
//     the table's.
//   • Land's Aid (Land 3): as a Magic action, a use of Wild Shape fills a
//     10-foot-radius Sphere centred on a point within 60 feet. Each creature of
//     the Druid's choice in it makes a Constitution save against the spell
//     save DC: 2d6 Necrotic damage, half on a success. One creature of its
//     choice in the area regains 2d6 Hit Points. 3d6 at Druid 10, 4d6 at 14.
//   • Wild Resurgence (Druid 5): once on each of its turns, with no use of
//     Wild Shape left, a spell slot gives one use. And once until a Long Rest,
//     a use of Wild Shape gives a level 1 spell slot.
//   • Natural Recovery (Land 6): as a Short Rest ends, expended slots of a
//     combined level up to half the Druid level (round up), none of level 6
//     or higher, once until a Long Rest. (Its Circle spell cast without a
//     slot is the table's.)
//   • Elemental Fury (Druid 7), one of two. Potent Spellcasting: the Wisdom
//     modifier is added to the damage of a Druid cantrip; from Druid 15 a
//     Druid cantrip with a range of 10 feet or more reaches 300 feet farther.
//     Primal Strike: once on each of its turns, a hit with a weapon or with a
//     Beast form's attack deals an extra 1d8 Cold, Fire, Lightning or Thunder
//     damage (2d8 from Druid 15), the type chosen on the hit.
//   • Nature's Ward (Land 10): immunity to the Poisoned condition, and
//     Resistance by the land chosen: Arid Fire, Polar Cold, Temperate
//     Lightning, Tropical Poison.
//   • Beast Spells (Druid 18): spells can be cast in a Wild Shape form.
//
// The option of Elemental Fury is read from the sheet: a feature whose name
// has "Primal Strike" or "Potent Spellcasting" in it. The land is read from
// the name of the Nature's Ward or Circle of the Land Spells feature:
// "Nature's Ward (Polar)".
// ============================================

import type { CombatAction } from './actions';
import { arcaneRecovery, recoverSlots } from './arcaneRecovery';
import type { DamageType } from './damage';
import { readFeatures } from './featureEffects';
import { withInvocations } from './invocations';
import { abilityModifier, classLevel, resourcesOf, spendResource } from './resources';
import { findSpell, spellActionsFromSheet, withSlotSpent, type SheetSpellcasting } from './spells';

type Sheet = Record<string, unknown>;
type Change = { ok: true; sheet: Sheet; summary: string } | { ok: false; reason: string };

const plain = (name: string) => name.trim().toLowerCase().replace(/[’']/g, "'");

/** Whether the sheet lists a feature with this name in its own: "Land’s Aid (Druid 3)" lists Land's Aid. */
function lists(sheet: Sheet, name: string): boolean {
  const wanted = plain(name);
  return readFeatures(sheet).some((feature) => plain(feature.name).includes(wanted));
}

/** The Druid's spell save DC: the sheet's, or 8 + Wisdom modifier + Proficiency Bonus. */
function spellSaveDC(sheet: Sheet): number {
  const written = (sheet.spellcasting as { spellSaveDC?: unknown } | null | undefined)?.spellSaveDC;
  if (typeof written === 'number') return written;
  const proficiency = typeof sheet.proficiencyBonus === 'number' ? sheet.proficiencyBonus : 2;
  return 8 + abilityModifier(sheet, 'wisdom') + proficiency;
}

// ---------- Land's Aid ----------

export const LANDS_AID = "Land's Aid";
export const LANDS_AID_HEALING = "Land's Aid (healing only)";
const LANDS_AID_RANGE_FEET = 60;
const LANDS_AID_RADIUS_FEET = 10;

/** The d6s Land's Aid rolls, for its damage and for its healing, at a Druid level. */
export function landsAidDice(level: number): number {
  return level >= 14 ? 4 : level >= 10 ? 3 : 2;
}

/**
 * The ways a Land Druid's sheet can use Land's Aid now: none without the
 * feature or a use of Wild Shape left. The first is the whole feature: the
 * saves of the creatures chosen, and the creature named with them regains Hit
 * Points. The second only restores Hit Points, for when nobody is to save.
 */
export function landsAidActions(sheet: Sheet): CombatAction[] {
  const level = classLevel(sheet, 'Druid');
  if (level < 3 || !lists(sheet, LANDS_AID)) return [];
  const uses = resourcesOf(sheet).find((entry) => entry.name === 'Wild Shape');
  if (!uses || uses.used >= uses.max) return [];
  const count = landsAidDice(level);
  const text = `A use of Wild Shape: a 10-foot-radius Sphere centred on a point within 60 feet. Each creature of your choice in it makes a Constitution save, taking ${count}d6 Necrotic damage, half on a success. One creature of your choice in the area regains ${count}d6 Hit Points.`;
  const base = { cost: 'action' as const, source: 'sheet' as const, channel: 'Wild Shape' as const, text };
  return [
    {
      ...base,
      name: LANDS_AID,
      rangeFeet: LANDS_AID_RANGE_FEET,
      area: { shape: 'sphere', sizeFeet: LANDS_AID_RADIUS_FEET },
      save: { ability: 'con', dc: spellSaveDC(sheet), halfOnSuccess: true, damage: [{ roll: { count, sides: 6 }, type: 'necrotic' }] },
      areaHeal: { count, sides: 6 },
    },
    // The creature healed stands in the Sphere, so within its radius of a point 60 feet away.
    { ...base, name: LANDS_AID_HEALING, rangeFeet: LANDS_AID_RANGE_FEET + LANDS_AID_RADIUS_FEET, heal: { roll: { count, sides: 6 }, bonus: 0 } },
  ];
}

// ---------- Elemental Fury ----------

/** The option of Elemental Fury a Druid's sheet lists (from Druid 7), or null when it names neither. */
export function elementalFury(sheet: Sheet): 'primal' | 'potent' | null {
  if (classLevel(sheet, 'Druid') < 7) return null;
  if (lists(sheet, 'Primal Strike')) return 'primal';
  if (lists(sheet, 'Potent Spellcasting')) return 'potent';
  return null;
}

export const PRIMAL_STRIKE_TYPES = ['cold', 'fire', 'lightning', 'thunder'] as const satisfies readonly DamageType[];
export type PrimalStrikeType = (typeof PRIMAL_STRIKE_TYPES)[number];

const titled = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

/** What the Druid's player is offered on a hit: "Primal Strike (Cold)" and the rest. */
export const PRIMAL_STRIKE_OPTIONS: readonly string[] = PRIMAL_STRIKE_TYPES.map((type) => `Primal Strike (${titled(type)})`);

/** The damage type an answer to that offer names, or null. */
export function primalStrikeChoice(choice: string | null | undefined): PrimalStrikeType | null {
  const index = choice ? PRIMAL_STRIKE_OPTIONS.indexOf(choice) : -1;
  return index >= 0 ? PRIMAL_STRIKE_TYPES[index] : null;
}

/**
 * The dice Primal Strike adds to a hit with this action, or null when the
 * sheet has no Primal Strike or the attack is not one it rides: a weapon
 * attack (not an Unarmed Strike or a spell), or in a Wild Shape form one of
 * the Beast's attacks.
 */
export function primalStrikeDice(sheet: Sheet, action: CombatAction, inForm: boolean): { count: number; sides: number } | null {
  if (elementalFury(sheet) !== 'primal' || !action.attack || action.unarmed) return null;
  if (plain(action.name) === 'unarmed strike') return null;
  if (action.source !== (inForm ? 'statBlock' : 'sheet')) return null;
  return { count: classLevel(sheet, 'Druid') >= 15 ? 2 : 1, sides: 8 };
}

const LAND_CANTRIPS: Readonly<Record<LandType, string>> = {
  arid: 'fire bolt',
  polar: 'ray of frost',
  temperate: 'shocking grasp',
  tropical: 'acid splash',
};

/** Whether a cantrip is a Druid spell for this sheet: one of the Druid list, or the cantrip its Circle of the Land Spells give. */
function druidCantrip(sheet: Sheet, action: CombatAction): boolean {
  if (action.spell?.level !== 0) return false;
  if (findSpell(action.spell.id)?.classes.includes('Druid')) return true;
  if (!lists(sheet, 'Circle of the Land Spells')) return false;
  const land = landType(sheet);
  const name = plain(action.name);
  return land ? LAND_CANTRIPS[land] === name : Object.values(LAND_CANTRIPS).includes(name);
}

/** How much farther a Druid cantrip reaches with Improved Elemental Fury, when its range is 10 feet or more. */
const POTENT_RANGE_FEET = 300;

/**
 * A sheet's spell actions with Potent Spellcasting: the Wisdom modifier added
 * to the damage of each Druid cantrip, and from Druid 15 its range 300 feet
 * longer when it is 10 feet or more. Unchanged for a sheet without the option.
 */
export function withPotentSpellcasting(sheet: Sheet, actions: readonly CombatAction[]): CombatAction[] {
  if (elementalFury(sheet) !== 'potent') return [...actions];
  const wisdom = abilityModifier(sheet, 'wisdom');
  const farther = classLevel(sheet, 'Druid') >= 15;
  return actions.map((action) => {
    if (!druidCantrip(sheet, action)) return action;
    let changed = action;
    if (wisdom !== 0) {
      const add = (damage: NonNullable<CombatAction['attack']>['damage']) =>
        damage.map((line, index) => (index === 0 ? { ...line, roll: { ...line.roll, bonus: (line.roll.bonus ?? 0) + wisdom } } : line));
      if (changed.attack && changed.attack.damage.length > 0) changed = { ...changed, attack: { ...changed.attack, damage: add(changed.attack.damage) } };
      if (changed.save && changed.save.damage.length > 0) changed = { ...changed, save: { ...changed.save, damage: add(changed.save.damage) } };
    }
    if (farther && changed.rangeFeet !== undefined && changed.rangeFeet >= 10) {
      changed = { ...changed, rangeFeet: changed.rangeFeet + POTENT_RANGE_FEET };
      if (changed.attack?.rangeFeet) {
        changed = { ...changed, attack: { ...changed.attack, rangeFeet: { ...changed.attack.rangeFeet, normal: changed.attack.rangeFeet.normal + POTENT_RANGE_FEET } } };
      }
    }
    return changed;
  });
}

/**
 * A Druid's actions as its features change them. Out of a Wild Shape form:
 * its own, with Potent Spellcasting on its cantrips, and Land's Aid. In a
 * form (`actions` are the Beast's): Land's Aid, which is no spell, and from
 * Druid 18 (Beast Spells) the sheet's spells.
 */
export function withDruidFeatures(sheet: Sheet, actions: readonly CombatAction[], inForm: boolean): CombatAction[] {
  if (classLevel(sheet, 'Druid') === 0) return [...actions];
  if (!inForm) return [...withPotentSpellcasting(sheet, actions), ...landsAidActions(sheet)];
  const spells =
    classLevel(sheet, 'Druid') >= 18 ? withPotentSpellcasting(sheet, withInvocations(sheet, spellActionsFromSheet(sheet as SheetSpellcasting))) : [];
  return [...actions, ...spells, ...landsAidActions(sheet)];
}

// ---------- Wild Resurgence, Wild Companion ----------

const usesLeft = (sheet: Sheet) => {
  const uses = resourcesOf(sheet).find((entry) => entry.name === 'Wild Shape');
  return uses ? { ...uses, left: uses.max - uses.used } : null;
};

/**
 * Wild Resurgence. With a `slotLevel`: a spell slot of that level is expended
 * for one use of Wild Shape, when none is left. Without: a use of Wild Shape
 * is expended for a level 1 spell slot, once until a Long Rest; the sheet
 * counts slots as expended out of a total, so one must be expended to come back.
 */
export function wildResurgence(sheet: Sheet, slotLevel?: number): Change {
  if (classLevel(sheet, 'Druid') < 5) return { ok: false, reason: 'The sheet has no Wild Resurgence' };
  const uses = usesLeft(sheet);
  if (!uses) return { ok: false, reason: 'The sheet has no Wild Shape' };
  if (slotLevel !== undefined) {
    if (uses.left > 0) return { ok: false, reason: 'Wild Resurgence gives a use of Wild Shape when none is left' };
    const spent = withSlotSpent(sheet as SheetSpellcasting, slotLevel) as Sheet | null;
    if (!spent) return { ok: false, reason: `No level ${slotLevel} spell slot left to expend` };
    const featureUses = { ...((spent.featureUses ?? {}) as Record<string, unknown>), 'Wild Shape': uses.used - 1 };
    return { ok: true, sheet: { ...spent, featureUses }, summary: `Wild Resurgence: a level ${slotLevel} spell slot expended for a use of Wild Shape` };
  }
  const once = resourcesOf(sheet).find((entry) => entry.name === 'Wild Resurgence');
  if (!once || once.used >= once.max) return { ok: false, reason: 'Wild Resurgence has given its spell slot until a Long Rest' };
  if (uses.left <= 0) return { ok: false, reason: 'No uses of Wild Shape left until a rest' };
  const casting = (sheet.spellcasting ?? {}) as { slots?: Record<string, { total?: number; expended?: number }> };
  const slot = casting.slots?.['1'];
  const expended = Math.floor(slot?.expended ?? 0);
  if (!slot || expended <= 0) return { ok: false, reason: 'No level 1 spell slot is expended to give back' };
  const back = { ...sheet, spellcasting: { ...casting, slots: { ...casting.slots, '1': { ...slot, expended: expended - 1 } } } };
  const shape = spendResource(back, 'Wild Shape');
  if (!shape.ok) return { ok: false, reason: shape.reason };
  const marked = spendResource(shape.sheet, 'Wild Resurgence');
  if (!marked.ok) return { ok: false, reason: marked.reason };
  return { ok: true, sheet: marked.sheet, summary: `Wild Resurgence: a use of Wild Shape expended for a level 1 spell slot (${shape.left} ${shape.left === 1 ? 'use' : 'uses'} of Wild Shape left)` };
}

/** Wild Companion: Find Familiar cast with a spell slot of `slotLevel`, or with a use of Wild Shape when none is given. */
export function wildCompanion(sheet: Sheet, slotLevel?: number): Change {
  if (classLevel(sheet, 'Druid') < 2) return { ok: false, reason: 'The sheet has no Wild Companion' };
  if (slotLevel !== undefined) {
    const spent = withSlotSpent(sheet as SheetSpellcasting, slotLevel) as Sheet | null;
    if (!spent) return { ok: false, reason: `No level ${slotLevel} spell slot left to expend` };
    return { ok: true, sheet: spent, summary: `Wild Companion: Find Familiar cast with a level ${slotLevel} spell slot` };
  }
  const shape = spendResource(sheet, 'Wild Shape');
  if (!shape.ok) return { ok: false, reason: shape.reason };
  return { ok: true, sheet: shape.sheet, summary: `Wild Companion: Find Familiar cast with a use of Wild Shape (${shape.left} left)` };
}

// ---------- Natural Recovery ----------

/** The combined level of slots Natural Recovery recovers: half the Druid level, rounded up. */
export function naturalRecoveryBudget(sheet: Sheet): number {
  return Math.ceil(classLevel(sheet, 'Druid') / 2);
}

/** The sheet with the slots of these levels recovered and the use of Natural Recovery spent, or why not. */
export function naturalRecovery(sheet: Sheet, levels: readonly number[]): Change {
  return recoverSlots(sheet, levels, 'Natural Recovery', naturalRecoveryBudget(sheet));
}

/**
 * The slots a character recovers as a Short Rest ends: a Wizard's Arcane
 * Recovery, or a Land Druid's Natural Recovery. A sheet with both (a gestalt)
 * uses Arcane Recovery first, and Natural Recovery once that is spent.
 */
export function shortRestRecovery(sheet: Sheet, levels: readonly number[]): Change {
  const of = (name: string) => resourcesOf(sheet).find((entry) => entry.name === name);
  const arcane = of('Arcane Recovery');
  if (of('Natural Recovery') && (!arcane || arcane.used >= arcane.max)) return naturalRecovery(sheet, levels);
  return arcaneRecovery(sheet, levels);
}

// ---------- Nature's Ward ----------

export type LandType = 'arid' | 'polar' | 'temperate' | 'tropical';

const WARD_RESISTANCE: Readonly<Record<LandType, DamageType>> = {
  arid: 'fire',
  polar: 'cold',
  temperate: 'lightning',
  tropical: 'poison',
};

/** The land a Land Druid's sheet names with its Nature's Ward or Circle of the Land Spells feature: "Nature's Ward (Polar)". */
export function landType(sheet: Sheet): LandType | null {
  for (const feature of readFeatures(sheet)) {
    const name = plain(feature.name);
    if (!name.includes("nature's ward") && !name.includes('circle of the land')) continue;
    const found = /\b(arid|polar|temperate|tropical)\b/.exec(name);
    if (found) return found[1] as LandType;
  }
  return null;
}

/**
 * Nature's Ward, for a Land Druid of level 10 whose sheet lists it: immunity
 * to the Poisoned condition, and the Resistance of the land its sheet names
 * (null when it names none). Null without the feature.
 */
export function naturesWard(sheet: Sheet | null): { resistance: DamageType | null } | null {
  if (!sheet || classLevel(sheet, 'Druid') < 10 || !lists(sheet, "Nature's Ward")) return null;
  const land = landType(sheet);
  return { resistance: land ? WARD_RESISTANCE[land] : null };
}
