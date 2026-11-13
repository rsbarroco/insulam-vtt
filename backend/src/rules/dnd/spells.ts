// ============================================
// The spell catalogue, from the System Reference Document 5.2.1
//
// `data/srd-5.2.1-spells.json` holds the spells of the SRD 5.2.1 as the
// document gives them, built by `scripts/srd-spells.py`. The SRD is published
// by Wizards of the Coast under CC-BY-4.0; see SRD_ATTRIBUTION.md.
//
// A spell says what it does in sentences. What the engine can run of one is
// read from those sentences here: a spell attack, a saving throw, the damage,
// the area. What cannot be read stays as text for the table.
// ============================================

import catalogue from './data/srd-5.2.1-spells.json';
import type { Ability } from './conditions';
import type { DamageRoll } from './damage';
import {
  ABILITY_NAMES,
  parseDamageRoll,
  parseDamageType,
  type ActionCost,
  type AreaOfEffect,
  type CombatAction,
  type DamageComponent,
} from './actions';

export interface Spell {
  /** The name in lower case with hyphens: "fire-bolt". */
  id: string;
  name: string;
  /** 0 for a cantrip. */
  level: number;
  school: string;
  classes: string[];
  castingTime: string;
  ritual: boolean;
  range: string;
  components: string[];
  material: string | null;
  duration: string;
  concentration: boolean;
  /** The description, a paragraph at a time. Tables are flattened into their text. */
  description: string[];
  /** "Using a Higher-Level Spell Slot" or "Cantrip Upgrade", when the spell has one. */
  higherLevels: string | null;
}

const SPELLS: readonly Spell[] = catalogue.spells;
const BY_KEY = new Map<string, Spell>();
const key = (name: string) => name.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
for (const spell of SPELLS) BY_KEY.set(spell.id, spell);

/** The attribution the licence asks for, as the document words it. */
export const SRD_ATTRIBUTION: string = catalogue.attribution;

/** Every spell of the catalogue, in the document's order. */
export function allSpells(): readonly Spell[] {
  return SPELLS;
}

/** A spell by its id or its name, whatever the case and apostrophes. */
export function findSpell(name: string | null | undefined): Spell | null {
  return name ? (BY_KEY.get(key(name)) ?? null) : null;
}

export interface SpellFilter {
  level?: number;
  /** A class that has the spell on its list. */
  class?: string;
  school?: string;
  /** Part of the name. */
  search?: string;
}

export function filterSpells(filter: SpellFilter): Spell[] {
  const search = filter.search?.trim().toLowerCase();
  const className = filter.class?.toLowerCase();
  const school = filter.school?.toLowerCase();
  return SPELLS.filter(
    (spell) =>
      (filter.level === undefined || spell.level === filter.level) &&
      (!className || spell.classes.some((name) => name.toLowerCase() === className)) &&
      (!school || spell.school.toLowerCase() === school) &&
      (!search || spell.name.toLowerCase().includes(search))
  );
}

/** What the engine can run of a spell, before the caster's own numbers. */
export interface SpellMechanics {
  cost: ActionCost | null;
  /** Null for a range that is not a distance: Sight, Unlimited, Special. Self and Touch are 0 and 5. */
  rangeFeet: number | null;
  attack: 'melee' | 'ranged' | null;
  save: Ability | null;
  /** The first damage the spell names, at the level it is first cast at. */
  damage: DamageComponent[];
  halfOnSuccess: boolean;
  area: AreaOfEffect | null;
  /** The dice added for each slot level above the spell's own. */
  perSlotLevel: DamageRoll | null;
  /** A cantrip's dice at character levels 5, 11 and 17. */
  cantripUpgrade: [DamageRoll, DamageRoll, DamageRoll] | null;
}

function costOf(castingTime: string): ActionCost | null {
  if (/^Bonus Action/.test(castingTime)) return 'bonusAction';
  if (/^Reaction/.test(castingTime)) return 'reaction';
  return /^Action/.test(castingTime) ? 'action' : null;
}

function rangeOf(range: string): number | null {
  if (range === 'Self') return 0;
  if (range === 'Touch') return 5;
  const feet = /^([\d,]+) feet$/.exec(range);
  if (feet) return Number(feet[1].replace(/,/g, ''));
  const miles = /^([\d,]+) miles?$/.exec(range);
  return miles ? Number(miles[1].replace(/,/g, '')) * 5280 : null;
}

const SHAPES = 'Sphere|Cone|Cube|Line|Cylinder|Emanation';

function areaOf(text: string): AreaOfEffect | null {
  const found =
    new RegExp(`(\\d+)-foot(?:-radius)?(?:, \\d+-foot-high)? (${SHAPES})`).exec(text) ??
    new RegExp(`(\\d+)-foot-long(?:, \\d+-foot-wide)? (${SHAPES})`).exec(text);
  return found ? { shape: found[2].toLowerCase() as AreaOfEffect['shape'], sizeFeet: Number(found[1]) } : null;
}

/** "8d6 Fire damage", "1d8 + 4 Necrotic damage" and "2d8 Radiant damage" as components. */
function damageOf(sentence: string): DamageComponent[] {
  const found = /(\d+d\d+(?: [+−-] \d+)?) (?:([A-Z][a-z]+) )?damage/.exec(sentence);
  const roll = found ? parseDamageRoll(found[1]) : null;
  return roll ? [{ roll, type: parseDamageType(found![2]) }] : [];
}

export function spellMechanics(spell: Spell): SpellMechanics {
  const text = spell.description.join(' ');
  const attack = /\b(melee|ranged) spell attack/i.exec(text);
  const save = new RegExp(`(${Object.keys(ABILITY_NAMES).join('|')}) saving throw`, 'i').exec(text);
  const higher = spell.higherLevels ?? '';
  const perSlot = /increases by (\d+d\d+) for each spell slot level above/.exec(higher);
  const upgrades = [...higher.matchAll(/\((\d+d\d+)\)/g)].map((match) => parseDamageRoll(match[1]));

  return {
    cost: costOf(spell.castingTime),
    rangeFeet: rangeOf(spell.range),
    attack: attack ? (attack[1].toLowerCase() as 'melee' | 'ranged') : null,
    save: save ? ABILITY_NAMES[save[1].toLowerCase()] : null,
    damage: damageOf(text),
    halfOnSuccess: /half as much damage on a successful (one|save)/i.test(text),
    area: areaOf(text),
    perSlotLevel: perSlot ? parseDamageRoll(perSlot[1]) : null,
    cantripUpgrade:
      spell.level === 0 && upgrades.length === 3 && upgrades.every(Boolean)
        ? (upgrades as [DamageRoll, DamageRoll, DamageRoll])
        : null,
  };
}

/** The caster's numbers a spell is cast with. */
export interface Caster {
  spellAttackBonus: number;
  spellSaveDC: number;
  /** Character level, which is what makes a cantrip stronger. */
  level?: number;
  /** The spellcasting ability modifier, which a healing spell adds. */
  abilityModifier?: number;
}

/**
 * The healing a spell restores to one creature, cast with a slot of
 * `slotLevel`: "regains Hit Points equal to 2d8 plus your spellcasting ability
 * modifier", and "The healing increases by 2d8 for each spell slot level above
 * 1". Null for a spell that heals some other way.
 */
export function spellHealing(spell: Spell, slotLevel: number, modifier: number): { roll: { count: number; sides: number }; bonus: number } | null {
  const text = spell.description.join(' ');
  const base = /regains? (?:a number of )?Hit Points equal to (\d+)d(\d+) plus your spellcasting ability modifier/i.exec(text);
  if (!base) return null;
  const sides = Number(base[2]);
  let count = Number(base[1]);
  const more = /healing increases by (\d+)d(\d+) for each spell slot level above (\d)/i.exec(spell.higherLevels ?? '');
  if (more && Number(more[2]) === sides) count += Number(more[1]) * Math.max(0, slotLevel - Number(more[3]));
  return { roll: { count, sides }, bonus: modifier };
}

/** The damage of a spell cast with a slot of `slotLevel` by a caster of `casterLevel`. */
export function spellDamage(spell: Spell, mechanics: SpellMechanics, slotLevel: number, casterLevel = 1): DamageComponent[] {
  const [first, ...rest] = mechanics.damage;
  if (!first) return [];
  if (mechanics.cantripUpgrade) {
    if (casterLevel < 5) return mechanics.damage;
    const upgraded = mechanics.cantripUpgrade[casterLevel >= 17 ? 2 : casterLevel >= 11 ? 1 : 0];
    return [{ ...first, roll: { ...first.roll, ...upgraded } }, ...rest];
  }
  const above = Math.max(0, Math.min(9, slotLevel) - spell.level);
  if (!mechanics.perSlotLevel || above === 0 || mechanics.perSlotLevel.sides !== first.roll.sides) return mechanics.damage;
  return [{ ...first, roll: { ...first.roll, count: first.roll.count + above * mechanics.perSlotLevel.count } }, ...rest];
}

/**
 * A spell as an action the engine can run, for a caster. Null for a spell
 * that takes longer than a turn to cast. A spell with neither an attack roll
 * nor a saving throw comes back with its text alone.
 */
export function actionFromSpell(spell: Spell, caster: Caster, slotLevel: number = spell.level): CombatAction | null {
  const mechanics = spellMechanics(spell);
  if (!mechanics.cost) return null;
  const damage = spellDamage(spell, mechanics, slotLevel, caster.level);
  const action: CombatAction = {
    name: spell.name,
    cost: mechanics.cost,
    source: 'spell',
    spell: { id: spell.id, level: spell.level },
    text: spell.description.join('\n\n'),
  };
  if (mechanics.rangeFeet !== null) action.rangeFeet = mechanics.rangeFeet;
  if (mechanics.area) action.area = mechanics.area;
  const healing = spellHealing(spell, slotLevel, caster.abilityModifier ?? 0);
  if (healing) {
    action.heal = healing;
    if (action.rangeFeet === undefined) action.rangeFeet = 5;
    return action;
  }
  if (mechanics.attack === 'melee') {
    action.attack = { kind: 'melee', bonus: caster.spellAttackBonus, reachFeet: Math.max(5, mechanics.rangeFeet ?? 5), damage };
  } else if (mechanics.attack === 'ranged' && mechanics.rangeFeet !== null) {
    action.attack = { kind: 'ranged', bonus: caster.spellAttackBonus, rangeFeet: { normal: mechanics.rangeFeet, long: null }, damage };
  } else if (mechanics.save) {
    action.save = { ability: mechanics.save, dc: caster.spellSaveDC, damage, halfOnSuccess: mechanics.halfOnSuccess };
  }
  return action;
}

/** The spellcasting ability modifier a sheet implies: its spell attack bonus less its Proficiency Bonus. */
function castingModifier(data: SheetSpellcasting | null | undefined): number {
  const attack = data?.spellcasting?.spellAttackBonus ?? 0;
  const proficiency = typeof data?.proficiencyBonus === 'number' ? data.proficiencyBonus : 2 + Math.floor((Math.max(1, data?.level ?? 1) - 1) / 4);
  return attack - proficiency;
}

/** The part of a D&D 5e sheet that spells are cast from. */
export interface SheetSpellcasting {
  level?: number;
  proficiencyBonus?: number;
  spellcasting?: {
    spellSaveDC?: number;
    spellAttackBonus?: number;
    cantrips?: readonly string[];
    spells?: ReadonlyArray<{ name: string; level: number; prepared?: boolean }>;
    slots?: Partial<Record<string, { total?: number; expended?: number } | undefined>> | null;
  } | null;
}

/**
 * The spells on a sheet that the catalogue knows and that can be cast in a
 * turn: its cantrips and its prepared spells, each at its own level. A sheet
 * lists a spell by name, so one the catalogue does not have is left out, as
 * is everything when the sheet has no spell attack bonus and save DC.
 */
export function spellActionsFromSheet(data: SheetSpellcasting | null | undefined): CombatAction[] {
  const casting = data?.spellcasting;
  if (!casting || typeof casting.spellAttackBonus !== 'number' || typeof casting.spellSaveDC !== 'number') return [];
  const caster: Caster = { spellAttackBonus: casting.spellAttackBonus, spellSaveDC: casting.spellSaveDC, level: data?.level, abilityModifier: castingModifier(data) };
  const names = [
    ...(casting.cantrips ?? []),
    ...(casting.spells ?? []).filter((entry) => entry.prepared !== false).map((entry) => entry.name),
  ];
  const actions: CombatAction[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const spell = findSpell(name);
    if (!spell || seen.has(spell.id)) continue;
    seen.add(spell.id);
    const action = actionFromSpell(spell, caster);
    if (action) actions.push(action);
  }
  return actions;
}

/** The concentration spells a sheet has ready: its cantrips and prepared spells that need Concentration, by name. */
export function concentrationSpellsOf(data: SheetSpellcasting | null | undefined): string[] {
  const casting = data?.spellcasting;
  const names = [
    ...(casting?.cantrips ?? []),
    ...(casting?.spells ?? []).filter((entry) => entry.prepared !== false).map((entry) => entry.name),
  ];
  return [...new Set(names.map((name) => findSpell(name)).filter((spell) => spell?.concentration).map((spell) => spell!.name))];
}

/** The spell slots a sheet has left, by level. Levels with none left are absent. */
export function slotsLeft(data: SheetSpellcasting | null | undefined): Record<number, number> {
  const left: Record<number, number> = {};
  for (let level = 1; level <= 9; level++) {
    const slot = data?.spellcasting?.slots?.[String(level)];
    const remaining = Math.max(0, Math.floor(slot?.total ?? 0) - Math.floor(slot?.expended ?? 0));
    if (remaining > 0) left[level] = remaining;
  }
  return left;
}

/**
 * A spell action of a sheet as it is cast with a slot of `slotLevel`: the
 * same action with the damage of that slot. A cantrip takes no slot. Refuses
 * a slot below the spell's level, and a level the sheet has no slot left at.
 * `slotLevel` left out means the spell's own level.
 */
export function castWithSlot(
  data: SheetSpellcasting | null | undefined,
  action: CombatAction,
  slotLevel?: number
): { action: CombatAction; slotLevel: number | null } | { error: string } {
  const cast = action.spell;
  const spell = cast ? findSpell(cast.id) : null;
  const casting = data?.spellcasting;
  if (!spell || !casting || typeof casting.spellAttackBonus !== 'number' || typeof casting.spellSaveDC !== 'number') {
    return slotLevel === undefined ? { action, slotLevel: null } : { error: `${action.name} is not a spell, and takes no spell slot` };
  }
  if (spell.level === 0) {
    return slotLevel === undefined || slotLevel === 0 ? { action, slotLevel: null } : { error: `${spell.name} is a cantrip, and takes no spell slot` };
  }
  const level = slotLevel ?? spell.level;
  if (level < spell.level) return { error: `${spell.name} needs a spell slot of level ${spell.level} or higher` };
  if (!slotsLeft(data)[level]) return { error: `No level ${level} spell slot left to cast ${spell.name}` };
  const caster: Caster = { spellAttackBonus: casting.spellAttackBonus, spellSaveDC: casting.spellSaveDC, level: data?.level, abilityModifier: castingModifier(data) };
  return { action: actionFromSpell(spell, caster, level) ?? action, slotLevel: level };
}

/**
 * The sheet with one slot of `level` spent, or null when it has none left
 * there. Changes nothing but that slot's `expended`.
 */
export function withSlotSpent<T extends SheetSpellcasting>(data: T, level: number): T | null {
  const slot = data.spellcasting?.slots?.[String(level)];
  if (!data.spellcasting || !slot || !slotsLeft(data)[level]) return null;
  return {
    ...data,
    spellcasting: {
      ...data.spellcasting,
      slots: { ...data.spellcasting.slots, [String(level)]: { ...slot, expended: Math.floor(slot.expended ?? 0) + 1 } },
    },
  };
}
