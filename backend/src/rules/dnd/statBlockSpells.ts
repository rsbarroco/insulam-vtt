// ============================================
// Spells of a stat block, by the D&D rules (SRD 5.2.1)
//
// A 2024 stat block casts with a "Spellcasting" action: "The mage casts one
// of the following spells, using Intelligence as the spellcasting ability
// (spell save DC 14): At Will: Detect Magic, Light … 2/Day Each: Fireball
// (level 4 version), Invisibility 1/Day Each: Cone of Cold, Fly". It uses no
// spell slots: a spell listed "At Will" is cast as often as the creature
// likes, one listed "2/Day Each" twice a day. "Requiring no Material
// components" (or no spell components at all) is the cast as Counterspell
// sees it.
//
// Some stat blocks also cast a spell as a Reaction: the Mage's "Protective
// Magic (3/Day). The mage casts Counterspell or Shield in response to the
// spell's trigger, using the same spellcasting ability as Spellcasting." Its
// uses are the entry's own "(3/Day)"; one with none written (the Lich's) is
// at will.
//
// The uses spent are kept on the token's metadata (`dailyUses`, by the name
// of the action or reaction that spends them) until the DM resets them.
// ============================================

import { ABILITY_NAMES, perDayOf, type CombatAction } from './actions';
import { actionFromSpell, findSpell, type Spell } from './spells';

/** The token metadata key the spent daily uses are kept under. */
export const DAILY_USES = 'dailyUses';

type Entry = { name: string; description?: string };
type Entries = ReadonlyArray<Entry> | undefined;

/** The parts of a stat block read here. */
export interface SpellcastingStatBlock {
  abilities?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>;
  actions?: Entries;
  bonusActions?: Entries;
  reactions?: Entries;
}

/** One spell of a Spellcasting list. */
export interface ListedSpell {
  spell: Spell;
  /** The level it is cast at: its "(level 4 version)", or its own. */
  level: number;
  /** Its uses a day, or null at will. */
  perDay: number | null;
}

export interface StatBlockSpellcasting {
  /** The Spellcasting entry's name. */
  entry: string;
  spellSaveDC: number | null;
  spellAttackBonus: number | null;
  /** The spellcasting ability modifier, which a healing spell adds. */
  abilityModifier: number;
  /** The components its spells keep ("requiring no Material components" drops M). */
  components: Array<'V' | 'S' | 'M'>;
  spells: ListedSpell[];
}

/** A list split on its commas, but not on those inside parentheses. */
function splitList(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      items.push(current);
      current = '';
    } else current += char;
  }
  items.push(current);
  return items.map((item) => item.trim().replace(/\.$/, '').trim()).filter(Boolean);
}

/** A listed spell, "Fireball (level 4 version)", as the catalogue's spell and the level it is cast at. */
function listedSpell(item: string, perDay: number | null): ListedSpell | null {
  const spell = findSpell(item.replace(/\s*\(.*\)\s*$/, ''));
  if (!spell) return null;
  const version = /\blevel (\d) version\b/i.exec(item);
  return { spell, level: version ? Math.max(spell.level, Number(version[1])) : spell.level, perDay };
}

/** A stat block's Spellcasting entry, read; null when it has none. */
export function statBlockSpellcasting(statBlock: SpellcastingStatBlock | null | undefined): StatBlockSpellcasting | null {
  const entry = [...(statBlock?.actions ?? []), ...(statBlock?.bonusActions ?? []), ...(statBlock?.reactions ?? [])].find((e) =>
    /^spellcasting\b/i.test(e.name.trim())
  );
  if (!entry) return null;
  const text = entry.description ?? '';
  const dc = /spell save DC\s*(\d{1,2})/i.exec(text);
  const attack = /([+-]\d{1,2}) to hit with spell attacks/i.exec(text);
  const abilityName = /using (\w+) as (?:the )?spellcasting ability/i.exec(text)?.[1]?.toLowerCase();
  const ability = abilityName ? ABILITY_NAMES[abilityName] : undefined;
  const score = ability ? statBlock?.abilities?.[ability] : undefined;
  const abilityModifier = typeof score === 'number' ? Math.floor((score - 10) / 2) : 0;
  // "requiring no spell components", "requiring no Material components", "requiring no Somatic or Material components".
  let components: Array<'V' | 'S' | 'M'> = ['V', 'S', 'M'];
  if (/requiring no spell components/i.test(text)) components = [];
  else {
    const dropped = /requiring no ([a-z ,]+?) components/i.exec(text)?.[1]?.toLowerCase() ?? '';
    components = components.filter(
      (c) => !dropped.includes(c === 'V' ? 'verbal' : c === 'S' ? 'somatic' : 'material')
    );
  }
  const spells: ListedSpell[] = [];
  const markers = [...text.matchAll(/(At Will|(\d+)\/Day(?: Each)?):/gi)];
  for (const [index, marker] of markers.entries()) {
    const end = markers[index + 1]?.index ?? text.length;
    const list = text.slice(marker.index + marker[0].length, end);
    const perDay = marker[2] ? Number(marker[2]) : null;
    for (const item of splitList(list)) {
      const listed = listedSpell(item, perDay);
      if (listed && !spells.some((known) => known.spell.id === listed.spell.id)) spells.push(listed);
    }
  }
  const spellSaveDC = dc ? Number(dc[1]) : null;
  return {
    entry: entry.name,
    spellSaveDC,
    spellAttackBonus: attack ? Number(attack[1]) : spellSaveDC !== null ? spellSaveDC - 8 : null,
    abilityModifier,
    components,
    spells,
  };
}

/**
 * The spells of a stat block's Spellcasting list as actions, each at the
 * level its stat block casts it ("level 4 version"), with the DC and the
 * attack bonus its Spellcasting entry writes, the components it keeps, and
 * its uses a day. A spell the catalogue does not know, or that takes longer
 * than a turn, is left out; one cast without a DC or an attack bonus written
 * keeps its text alone.
 */
export function statBlockSpellActions(statBlock: SpellcastingStatBlock | null | undefined): CombatAction[] {
  const casting = statBlockSpellcasting(statBlock);
  if (!casting) return [];
  const actions: CombatAction[] = [];
  for (const listed of casting.spells) {
    const caster = { spellAttackBonus: casting.spellAttackBonus ?? 0, spellSaveDC: casting.spellSaveDC ?? 0, abilityModifier: casting.abilityModifier };
    const action = actionFromSpell(listed.spell, caster, listed.level);
    if (!action) continue;
    if (casting.spellSaveDC === null) delete action.save;
    if (casting.spellAttackBonus === null) delete action.attack;
    action.spell = { ...action.spell!, components: casting.components };
    if (listed.perDay !== null) action.perDay = listed.perDay;
    actions.push(action);
  }
  return actions;
}

/** The daily uses spent, by name, as a token's metadata keeps them. */
export function dailyUsesSpent(metadata: Record<string, unknown> | null | undefined): Record<string, number> {
  const kept = metadata?.[DAILY_USES];
  if (!kept || typeof kept !== 'object' || Array.isArray(kept)) return {};
  const spent: Record<string, number> = {};
  for (const [name, count] of Object.entries(kept as Record<string, unknown>)) {
    if (typeof count === 'number' && Number.isInteger(count) && count > 0) spent[name] = count;
  }
  return spent;
}

/** The uses left today of something used `perDay` times a day; null when it is at will. */
export function dailyUsesLeft(metadata: Record<string, unknown> | null | undefined, name: string, perDay: number | null | undefined): number | null {
  if (perDay === null || perDay === undefined) return null;
  return Math.max(0, perDay - (dailyUsesSpent(metadata)[name] ?? 0));
}

/** The daily uses with one more of `name` spent, for the token's metadata. */
export function withDailyUseSpent(metadata: Record<string, unknown> | null | undefined, name: string): Record<string, number> {
  const spent = dailyUsesSpent(metadata);
  return { ...spent, [name]: (spent[name] ?? 0) + 1 };
}

/** How a stat block can cast one Reaction spell. */
export interface StatBlockReactionCast {
  spell: string;
  /** The level it is cast at. */
  level: number;
  spellSaveDC: number | null;
  /** What spends a use: the reaction entry ("Protective Magic (3/Day)") or the spell's own name in the Spellcasting list. */
  via: string;
  /** Its uses a day, or null at will. */
  perDay: number | null;
  /** The uses left today, or null at will. */
  left: number | null;
}

/** The spells a reaction entry casts: "The mage casts Counterspell or Shield in response to …". */
function spellsCastBy(entry: Entry): string[] {
  const found = /\bcasts\s+(.+?)(?:\s+in response\b|\s+using\b|[.;:]|$)/i.exec(entry.description ?? '');
  if (!found) return [];
  return found[1]
    .split(/,\s*(?:or\s+)?|\s+or\s+/i)
    .map((name) => findSpell(name.trim())?.id)
    .filter((id): id is string => !!id);
}

/**
 * How the stat block can cast the Reaction spell now, or null: a reaction
 * entry that casts it (its "(N/Day)" uses, or at will), or the spell in its
 * Spellcasting list. A way cast at will comes first; one with no use left
 * today is not offered.
 */
export function statBlockReactionCast(
  statBlock: SpellcastingStatBlock | null | undefined,
  name: string,
  metadata: Record<string, unknown> | null | undefined
): StatBlockReactionCast | null {
  const spell = findSpell(name);
  if (!spell || !statBlock) return null;
  const casting = statBlockSpellcasting(statBlock);
  const listed = casting?.spells.find((entry) => entry.spell.id === spell.id);
  const ways: StatBlockReactionCast[] = [];
  for (const entry of statBlock.reactions ?? []) {
    if (/^spellcasting\b/i.test(entry.name.trim()) || !spellsCastBy(entry).includes(spell.id)) continue;
    const perDay = perDayOf(entry.name);
    ways.push({
      spell: spell.name,
      level: listed?.level ?? spell.level,
      spellSaveDC: casting?.spellSaveDC ?? null,
      via: entry.name,
      perDay,
      left: dailyUsesLeft(metadata, entry.name, perDay),
    });
  }
  if (listed) {
    ways.push({
      spell: spell.name,
      level: listed.level,
      spellSaveDC: casting!.spellSaveDC,
      via: spell.name,
      perDay: listed.perDay,
      left: dailyUsesLeft(metadata, spell.name, listed.perDay),
    });
  }
  const usable = ways.filter((way) => way.left === null || way.left > 0);
  return usable.find((way) => way.left === null) ?? usable[0] ?? null;
}

/** The prompt option for a stat block's cast: "Shield (Protective Magic, 2 of 3/Day left)", "Shield (at will)". */
export function statBlockCastOption(cast: StatBlockReactionCast): string {
  const via = cast.via.replace(/\s*\(\d+\/day(?:\s+each)?\)\s*$/i, '');
  const source = via.toLowerCase() === cast.spell.toLowerCase() ? '' : `${via}, `;
  return cast.perDay === null ? `${cast.spell} (${source}at will)` : `${cast.spell} (${source}${cast.left} of ${cast.perDay}/Day left)`;
}
