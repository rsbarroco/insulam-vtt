// ============================================
// The spells a new character chooses, by the D&D rules
//
// SRD 5.2.1, each casting class's Spellcasting (Pact Magic for a Warlock):
//
//   • Cantrips: as many as the Cantrips column of the class table gives at
//     the class's level, from the class's spell list.
//   • Prepared spells: as many as the Prepared Spells column gives, from the
//     class's list, each of a level the class has spell slots for (its own
//     table's slots; a Warlock's Pact Magic slot level).
//   • A Wizard's spellbook: six level 1 Wizard spells, and two more for each
//     Wizard level after the first, each of a level the Wizard had slots for
//     when it learned it. Its prepared spells are chosen from the book. The
//     sheet lists the book as its spells, the ones not prepared with
//     `prepared: false`.
//   • Spells a feature makes always prepared do not count against the
//     number: those a class feature names ("you always have the Hunter's
//     Mark spell prepared") and those of the subclass's spell table (Life
//     Domain Spells, Oath of Devotion Spells, Draconic Spells, Fiend Spells),
//     at the class levels the table gives them: 3, 5, 7 and 9, a Paladin's
//     3, 5, 9, 13 and 17. The document's tables lose those level headings,
//     so they are written here.
//
// Left to the sheet: spells a feature lets the player choose and keep
// always prepared (Magical Discoveries, Spell Mastery, Signature Spells),
// a Circle of the Land Druid's spells (which change with the land chosen on
// each Long Rest), a Warlock's Mystic Arcanum, an extra cantrip of a Divine
// Order or Primal Order, and the spells of feats and species (Magic
// Initiate, an Elf's lineage).
//
// Under gestalt, each casting class chooses its own, by its own table.
//
// Pure.
// ============================================

import type { ClassName } from './advancement';
import { columnAt, featuresUpTo, findClass } from './classes';
import { allSpells, findSpell, type Spell } from './spells';

export interface ClassSpellcasting {
  /** By class level, level 1 first. */
  cantrips: number[];
  prepared: number[];
  /** The highest level of spell the class has slots for, by class level. */
  maxSpellLevel: number[];
  /** A Wizard's spellbook size by level; null for every other class. */
  spellbook: number[] | null;
  /** The spells features make always prepared, and the class level each comes at. */
  alwaysPrepared: Array<{ level: number; spell: string }>;
}

const LEVELS = Array.from({ length: 20 }, (_, index) => index + 1);
const count = (text: string | null) => (text && /^\d+$/.test(text) ? Number(text) : 0);

/** The class level each row of a subclass's spell table comes at. */
const TABLE_LEVELS: Partial<Record<ClassName, number[]>> = { Paladin: [3, 5, 9, 13, 17] };
const DEFAULT_TABLE_LEVELS = [3, 5, 7, 9];

const SPELL_NAMES = [...allSpells()].map((spell) => spell.name).sort((a, b) => b.length - a.length);
const plain = (text: string) => text.replace(/[’']/g, "'");

/**
 * The rows of a subclass's spell table, read from the document's flattened
 * text: "… Prepared Spells Aid, Bless, Cure Wounds, Lesser Restoration Mass
 * Healing Word, Revivify …". Names in a row are joined by commas; a new row
 * starts where two names meet without one.
 */
export function spellTableRows(text: string): string[][] {
  const source = plain(text);
  const rows: string[][] = [];
  let at = 0;
  let lastEnd = -1;
  while (at < source.length) {
    const name = at === 0 || /\W/.test(source[at - 1]) ? SPELL_NAMES.find((candidate) => source.startsWith(plain(candidate), at) && !/\w/.test(source[at + candidate.length] ?? '')) : undefined;
    if (!name) {
      at += 1;
      continue;
    }
    const between = lastEnd >= 0 ? source.slice(lastEnd, at) : null;
    if (between !== null && /^,\s*$/.test(between)) rows[rows.length - 1].push(name);
    else rows.push([name]);
    lastEnd = at + name.length;
    at = lastEnd;
  }
  return rows;
}

function alwaysPreparedOf(name: ClassName): Array<{ level: number; spell: string }> {
  const found: Array<{ level: number; spell: string }> = [];
  for (const feature of featuresUpTo(name, 20)) {
    const text = feature.text.join(' ');
    const listed = /always have the listed spells prepared\.?/.exec(text);
    if (listed) {
      const table = text.slice(listed.index + listed[0].length);
      const levels = TABLE_LEVELS[name] ?? DEFAULT_TABLE_LEVELS;
      spellTableRows(table).forEach((row, index) => {
        for (const spell of row) found.push({ level: levels[index] ?? feature.level, spell });
      });
      continue;
    }
    for (const match of text.matchAll(/always have the (.+?) spells? prepared/g)) {
      for (const part of match[1].split(/\s+and\s+/)) {
        const spell = findSpell(part);
        if (spell) found.push({ level: feature.level, spell: spell.name });
      }
    }
  }
  return found;
}

const CACHE = new Map<ClassName, ClassSpellcasting | null>();

/** What a class's Spellcasting lets its character choose, level by level; null for a class that casts no spells. */
export function classSpellcasting(name: ClassName): ClassSpellcasting | null {
  if (CACHE.has(name)) return CACHE.get(name)!;
  const columns = findClass(name)?.columns ?? {};
  let result: ClassSpellcasting | null = null;
  if (columns['Prepared Spells']) {
    const maxSpellLevel = LEVELS.map((level) => {
      if (columns['Slot Level']) return count(columnAt(name, 'Slot Level', level));
      let highest = 0;
      for (let slot = 1; slot <= 9; slot++) if (count(columnAt(name, `Spell Slots Level ${slot}`, level)) > 0) highest = slot;
      return highest;
    });
    result = {
      cantrips: LEVELS.map((level) => count(columnAt(name, 'Cantrips', level))),
      prepared: LEVELS.map((level) => count(columnAt(name, 'Prepared Spells', level))),
      maxSpellLevel,
      spellbook: name === 'Wizard' ? LEVELS.map((level) => 6 + 2 * (level - 1)) : null,
      alwaysPrepared: alwaysPreparedOf(name),
    };
  }
  CACHE.set(name, result);
  return result;
}

/** The spells a class has on its list, cantrips (level 0) or of levels 1 to `maxLevel`. */
export function classSpellList(name: ClassName, kind: 'cantrip' | 'spell', maxLevel = 9): Spell[] {
  return allSpells().filter(
    (spell) => spell.classes.includes(name) && (kind === 'cantrip' ? spell.level === 0 : spell.level >= 1 && spell.level <= maxLevel)
  );
}

/** The spells a class's features make always prepared at a level. */
export function alwaysPreparedAt(name: ClassName, level: number): string[] {
  return [...new Set((classSpellcasting(name)?.alwaysPrepared ?? []).filter((entry) => entry.level <= level).map((entry) => entry.spell))];
}

/** What one casting class chooses at a level: how many of each, and from what. */
export interface SpellAllowance {
  class: ClassName;
  cantrips: number;
  prepared: number;
  maxSpellLevel: number;
  spellbook: number | null;
  alwaysPrepared: string[];
}

export function spellAllowance(name: ClassName, level: number): SpellAllowance | null {
  const casting = classSpellcasting(name);
  if (!casting) return null;
  const at = Math.max(1, Math.min(20, level)) - 1;
  const always = alwaysPreparedAt(name, level);
  const maxSpellLevel = casting.maxSpellLevel[at];
  // A count the list cannot fill is the list's size.
  const cantrips = Math.min(casting.cantrips[at], classSpellList(name, 'cantrip').length);
  const pool = classSpellList(name, 'spell', maxSpellLevel).filter((spell) => !always.includes(spell.name)).length;
  const spellbook = casting.spellbook ? Math.min(casting.spellbook[at], pool) : null;
  return { class: name, cantrips, prepared: Math.min(casting.prepared[at], spellbook ?? pool), maxSpellLevel, spellbook, alwaysPrepared: always };
}

export interface SpellPicks {
  class: ClassName;
  cantrips?: readonly string[];
  prepared?: readonly string[];
  /** A Wizard's spellbook, the prepared spells among them. */
  spellbook?: readonly string[];
}

/**
 * The most spells of level `spellLevel` or higher a Wizard's book can hold
 * at a level: two for each Wizard level after the first that had slots of
 * that level. The six of level 1 are level 1.
 */
export function spellbookCeiling(level: number, spellLevel: number): number {
  const casting = classSpellcasting('Wizard')!;
  if (spellLevel <= 1) return casting.spellbook![level - 1];
  return 2 * LEVELS.filter((at) => at >= 2 && at <= level && casting.maxSpellLevel[at - 1] >= spellLevel).length;
}

/** Everything wrong with the spells chosen for the casting classes of a character. */
export function spellPicksRefusals(tracks: readonly ClassName[], level: number, picks: readonly SpellPicks[]): string[] {
  const errors: string[] = [];
  for (const pick of picks) {
    if (!tracks.includes(pick.class)) errors.push(`${pick.class} is not one of this character's classes`);
    else if (!classSpellcasting(pick.class)) errors.push(`${pick.class} has no spells to choose`);
  }
  for (const name of tracks) {
    const allowance = spellAllowance(name, level);
    if (!allowance) continue;
    const entries = picks.filter((pick) => pick.class === name);
    if (entries.length !== 1) {
      errors.push(`Choose the spells of ${name} once`);
      continue;
    }
    const pick = entries[0];
    const check = (list: readonly string[] | undefined, what: string, wanted: number, allowed: (spell: Spell) => string | null) => {
      const spells = (list ?? []).map((written) => ({ written, spell: findSpell(written) }));
      const unknown = spells.find((entry) => !entry.spell);
      if (unknown) {
        errors.push(`"${unknown.written}" is not a spell of the reference document`);
        return [];
      }
      const found = spells.map((entry) => entry.spell!);
      if (new Set(found.map((spell) => spell.id)).size !== found.length) errors.push(`${name} chooses each of its ${what} once`);
      if (found.length !== wanted) errors.push(`${name} chooses ${wanted} ${what} at level ${level}`);
      for (const spell of found) {
        const refusal = allowed(spell);
        if (refusal) {
          errors.push(refusal);
          break;
        }
      }
      return found;
    };
    const onList = (spell: Spell) => (spell.classes.includes(name) ? null : `${spell.name} is not on the ${name} spell list`);
    check(pick.cantrips, 'cantrips', allowance.cantrips, (spell) => onList(spell) ?? (spell.level === 0 ? null : `${spell.name} is not a cantrip`));
    const leveled = (spell: Spell) =>
      onList(spell) ??
      (spell.level === 0 ? `${spell.name} is a cantrip` : null) ??
      (spell.level > allowance.maxSpellLevel ? `${name} has no spell slots of level ${spell.level} for ${spell.name}` : null) ??
      (allowance.alwaysPrepared.includes(spell.name) ? `${spell.name} is always prepared by a feature, and is not chosen` : null);
    if (allowance.spellbook !== null) {
      const book = check(pick.spellbook, 'spells for the spellbook', allowance.spellbook, leveled);
      for (let spellLevel = 2; spellLevel <= allowance.maxSpellLevel; spellLevel++) {
        const ceiling = spellbookCeiling(level, spellLevel);
        if (book.filter((spell) => spell.level >= spellLevel).length > ceiling) {
          errors.push(`A level ${level} Wizard's spellbook holds at most ${ceiling} spells of level ${spellLevel} or higher: two for each level that had those slots`);
          break;
        }
      }
      const inBook = new Set(book.map((spell) => spell.id));
      check(pick.prepared, 'prepared spells', allowance.prepared, (spell) => (inBook.has(spell.id) ? null : `${spell.name} is not in the spellbook`));
    } else {
      if ((pick.spellbook ?? []).length > 0) errors.push(`${name} keeps no spellbook`);
      check(pick.prepared, 'prepared spells', allowance.prepared, leveled);
    }
  }
  return errors;
}

export interface SheetSpell {
  name: string;
  level: number;
  prepared: boolean;
  ritual: boolean;
  concentration: boolean;
}

const sheetSpell = (spell: Spell, prepared: boolean): SheetSpell => ({
  name: spell.name,
  level: spell.level,
  prepared,
  ritual: spell.ritual,
  concentration: spell.concentration,
});

/**
 * The cantrips and spells the sheet lists for checked picks: each class's
 * always-prepared spells, its prepared spells, and a Wizard's spellbook with
 * those not prepared marked so. A spell two classes both have is listed once,
 * prepared if either prepares it.
 */
export function sheetSpellsOf(tracks: readonly ClassName[], level: number, picks: readonly SpellPicks[]): { cantrips: string[]; spells: SheetSpell[] } {
  const cantrips: string[] = [];
  const spells = new Map<string, SheetSpell>();
  const add = (spell: Spell | null, prepared: boolean) => {
    if (!spell) return;
    const known = spells.get(spell.id);
    spells.set(spell.id, sheetSpell(spell, prepared || (known?.prepared ?? false)));
  };
  for (const name of tracks) {
    if (!classSpellcasting(name)) continue;
    for (const spell of alwaysPreparedAt(name, level)) add(findSpell(spell), true);
    const pick = picks.find((entry) => entry.class === name);
    for (const written of pick?.cantrips ?? []) {
      const spell = findSpell(written);
      if (spell && !cantrips.includes(spell.name)) cantrips.push(spell.name);
    }
    const prepared = new Set((pick?.prepared ?? []).map((written) => findSpell(written)?.id));
    for (const written of pick?.spellbook ?? []) add(findSpell(written), prepared.has(findSpell(written)?.id));
    for (const written of pick?.prepared ?? []) add(findSpell(written), true);
  }
  return { cantrips, spells: [...spells.values()].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)) };
}
