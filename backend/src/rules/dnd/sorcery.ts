// ============================================
// A Sorcerer's own magic, by the D&D rules (SRD 5.2.1)
//
//   • Font of Magic (Sorcerer 2). Creating Spell Slots: a Bonus Action turns
//     Sorcery Points into one spell slot of level 1 to 5 (2, 3, 5, 6 and 7
//     points; Sorcerer level 2, 3, 5, 7 and 9 at least). A slot created this
//     way vanishes on a Long Rest. Converting Spell Slots: a spell slot is
//     expended for Sorcery Points equal to its level, with no action; the
//     points never go above the table's number.
//   • Innate Sorcery (Sorcerer 1): a Bonus Action, twice until a Long Rest.
//     For 1 minute the spell save DC of its Sorcerer spells is 1 higher and
//     its Sorcerer spell attack rolls have Advantage.
//   • Sorcery Incarnate (Sorcerer 7): with no use of Innate Sorcery left, it
//     is used for 2 Sorcery Points.
//   • Sorcerous Restoration (Sorcerer 5): as a Short Rest ends, expended
//     Sorcery Points come back, half the Sorcerer level (round down) at most;
//     once until a Long Rest.
//   • Draconic Resilience (Draconic Sorcery 3): the Hit Point maximum is 3
//     higher, and 1 more for each Sorcerer level after; the Armor Class is in
//     `utils/srdArmor`.
//   • Elemental Affinity (Draconic Sorcery 6): Resistance to the chosen
//     damage type (Acid, Cold, Fire, Lightning or Poison), and the Charisma
//     modifier added to one damage roll of a spell that deals that type. The
//     type is read from the feature's name: "Elemental Affinity: Fire".
//
// A sheet keeps the slots it created in `createdSlots`: { "2": 1 }.
// Pure: a sheet in, the sheet as the feature leaves it out.
// ============================================

import type { CombatAction, DamageComponent } from './actions';
import type { DamageType } from './damage';
import { readFeatures } from './featureEffects';
import { abilityModifier, classLevel, resourcesOf, spendResource } from './resources';

type Sheet = Record<string, unknown>;
type Slots = Record<string, { total?: number; expended?: number } | undefined>;
type Refusal = { ok: false; reason: string };

/** Creating Spell Slots: what a slot of each level costs, and the Sorcerer level it asks for. */
export const CREATED_SLOTS: Readonly<Record<number, { cost: number; minLevel: number }>> = {
  1: { cost: 2, minLevel: 2 },
  2: { cost: 3, minLevel: 3 },
  3: { cost: 5, minLevel: 5 },
  4: { cost: 6, minLevel: 7 },
  5: { cost: 7, minLevel: 9 },
};

/** The most slots of one level a sheet holds, as its schema bounds them. */
const SLOTS_MAX = 20;

/** How many of a Sorcerer's own turns Innate Sorcery lasts in a fight: 1 minute. */
export const INNATE_SORCERY_TURNS = 10;

const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

const slotsOf = (sheet: Sheet): Slots => ({ ...(((sheet.spellcasting ?? {}) as { slots?: Slots | null }).slots ?? {}) });

const withSlots = (sheet: Sheet, slots: Slots): Sheet => ({ ...sheet, spellcasting: { ...((sheet.spellcasting ?? {}) as object), slots } });

/** The slots a sheet created with Font of Magic and still holds, by level. */
export function createdSlotsOf(sheet: Sheet): Record<string, number> {
  const written = (sheet.createdSlots ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(written)
      .map(([level, count]) => [level, whole(count)] as const)
      .filter(([, count]) => count > 0)
  );
}

const points = (count: number) => `${count} Sorcery ${count === 1 ? 'Point' : 'Points'}`;

/** Sorcery Points given back: `amount` of those spent, no more. */
function regainPoints(sheet: Sheet, amount: number): { sheet: Sheet; regained: number; left: number } {
  const pool = resourcesOf(sheet).find((entry) => entry.name === 'Sorcery Points');
  if (!pool) return { sheet, regained: 0, left: 0 };
  const regained = Math.min(amount, pool.used);
  const uses = { ...((sheet.featureUses ?? {}) as Record<string, unknown>), 'Sorcery Points': pool.used - regained };
  return { sheet: { ...sheet, featureUses: uses }, regained, left: pool.max - pool.used + regained };
}

/**
 * Creating Spell Slots: the sheet with the Sorcery Points spent and one more
 * slot of `level` to cast with, or why not. An expended slot of that level
 * comes back first; with none expended the sheet gains one, noted in
 * `createdSlots` so that a Long Rest takes it away.
 */
export function createSpellSlot(sheet: Sheet, level: number): { ok: true; sheet: Sheet; left: number; summary: string } | Refusal {
  const sorcerer = classLevel(sheet, 'Sorcerer');
  if (sorcerer < 2) return { ok: false, reason: 'The sheet has no Font of Magic' };
  const priced = CREATED_SLOTS[level];
  if (!priced) return { ok: false, reason: 'Font of Magic creates a spell slot of level 1 to 5' };
  if (sorcerer < priced.minLevel) return { ok: false, reason: `A level ${level} spell slot is created from Sorcerer level ${priced.minLevel}` };
  const spent = spendResource(sheet, 'Sorcery Points', priced.cost);
  if (!spent.ok) return { ok: false, reason: `A level ${level} spell slot costs ${points(priced.cost)}` };
  const slots = slotsOf(sheet);
  const slot = slots[String(level)];
  const expended = whole(slot?.expended);
  let next: Sheet;
  if (expended > 0) {
    slots[String(level)] = { ...slot, expended: expended - 1 };
    next = withSlots(spent.sheet, slots);
  } else {
    const total = whole(slot?.total);
    if (total >= SLOTS_MAX) return { ok: false, reason: `The sheet holds no more level ${level} spell slots` };
    slots[String(level)] = { ...(slot ?? {}), total: total + 1, expended: 0 };
    const created = createdSlotsOf(sheet);
    next = { ...withSlots(spent.sheet, slots), createdSlots: { ...created, [String(level)]: (created[String(level)] ?? 0) + 1 } };
  }
  return { ok: true, sheet: next, left: spent.left, summary: `Font of Magic: a level ${level} spell slot created for ${points(priced.cost)} (${spent.left} left)` };
}

/**
 * Converting Spell Slots: the sheet with one slot of `level` expended and
 * that many Sorcery Points back, no more than it has spent; or why not.
 */
export function convertSpellSlot(sheet: Sheet, level: number): { ok: true; sheet: Sheet; left: number; summary: string } | Refusal {
  if (classLevel(sheet, 'Sorcerer') < 2) return { ok: false, reason: 'The sheet has no Font of Magic' };
  const slots = slotsOf(sheet);
  const slot = slots[String(level)];
  const expended = whole(slot?.expended);
  if (!slot || whole(slot.total) - expended <= 0) return { ok: false, reason: `No level ${level} spell slot left to convert` };
  const pool = resourcesOf(sheet).find((entry) => entry.name === 'Sorcery Points');
  if (!pool || pool.used === 0) return { ok: false, reason: 'No Sorcery Points are spent: the slot would be lost for nothing' };
  slots[String(level)] = { ...slot, expended: expended + 1 };
  const back = regainPoints(withSlots(sheet, slots), level);
  return {
    ok: true,
    sheet: back.sheet,
    left: back.left,
    summary: `Font of Magic: a level ${level} spell slot converted into ${points(back.regained)} (${back.left} left)`,
  };
}

/** A sheet as a Long Rest leaves its created slots: gone. */
export function withoutCreatedSlots(sheet: Sheet): Sheet {
  if (sheet.createdSlots === undefined) return sheet;
  const created = createdSlotsOf(sheet);
  const slots = slotsOf(sheet);
  for (const [level, count] of Object.entries(created)) {
    const slot = slots[level];
    if (!slot) continue;
    const total = Math.max(0, whole(slot.total) - count);
    slots[level] = { ...slot, total, expended: Math.min(total, whole(slot.expended)) };
  }
  const next = withSlots(sheet, slots);
  delete next.createdSlots;
  return next;
}

/**
 * Innate Sorcery used: one of its two uses or, with none left, 2 Sorcery
 * Points from Sorcerer level 7 (Sorcery Incarnate). `left` is the uses left.
 */
export function useInnateSorcery(sheet: Sheet): { ok: true; sheet: Sheet; left: number; incarnate: boolean } | Refusal {
  const uses = resourcesOf(sheet).find((entry) => entry.name === 'Innate Sorcery');
  if (!uses) return { ok: false, reason: 'The sheet has no Innate Sorcery' };
  if (uses.used < uses.max) {
    const spent = spendResource(sheet, 'Innate Sorcery');
    return spent.ok ? { ok: true, sheet: spent.sheet, left: spent.left, incarnate: false } : { ok: false, reason: spent.reason };
  }
  if (classLevel(sheet, 'Sorcerer') < 7) return { ok: false, reason: 'No uses of Innate Sorcery left until a Long Rest' };
  const spent = spendResource(sheet, 'Sorcery Points', 2);
  if (!spent.ok) return { ok: false, reason: 'No uses of Innate Sorcery left: Sorcery Incarnate costs 2 Sorcery Points' };
  return { ok: true, sheet: spent.sheet, left: 0, incarnate: true };
}

/** A spell as Innate Sorcery casts it: its save DC 1 higher. (Advantage on its attack roll is the attack's to give.) */
export function withInnateSorcery(action: CombatAction): CombatAction {
  if (action.source !== 'spell' || !action.save) return action;
  return { ...action, save: { ...action.save, dc: action.save.dc + 1 } };
}

/** Sorcerous Restoration: the sheet with Sorcery Points back as a Short Rest ends and its use spent, or why not. */
export function sorcerousRestoration(sheet: Sheet): { ok: true; sheet: Sheet; summary: string } | Refusal {
  const uses = resourcesOf(sheet).find((entry) => entry.name === 'Sorcerous Restoration');
  if (!uses) return { ok: false, reason: 'The sheet has no Sorcerous Restoration' };
  if (uses.used >= uses.max) return { ok: false, reason: 'Sorcerous Restoration is used until a Long Rest' };
  const back = regainPoints(sheet, Math.floor(classLevel(sheet, 'Sorcerer') / 2));
  if (back.regained === 0) return { ok: false, reason: 'No Sorcery Points are spent to regain' };
  const spent = spendResource(back.sheet, 'Sorcerous Restoration');
  if (!spent.ok) return { ok: false, reason: spent.reason };
  return { ok: true, sheet: spent.sheet, summary: `Sorcerous Restoration: ${points(back.regained)} regained` };
}

/** The Hit Points Draconic Resilience adds to the maximum: 3 at Sorcerer level 3 and 1 more each level after, so the level. */
export function draconicResilienceHitPoints(sorcererLevel: number): number {
  return sorcererLevel >= 3 ? sorcererLevel : 0;
}

const AFFINITY_TYPES: readonly DamageType[] = ['acid', 'cold', 'fire', 'lightning', 'poison'];

/** The damage type of a sheet's Elemental Affinity, read from the feature's name ("Elemental Affinity: Fire"); null without one. */
export function elementalAffinity(sheet: Sheet | null): DamageType | null {
  for (const feature of readFeatures(sheet)) {
    if (!/\belemental affinity\b/i.test(feature.name)) continue;
    const named = AFFINITY_TYPES.find((type) => new RegExp(`\\b${type}\\b`, 'i').test(feature.name));
    if (named) return named;
  }
  return null;
}

/**
 * A spell with Elemental Affinity: the Charisma modifier added to its first
 * damage roll of the affinity's type. Unchanged for another action, another
 * type, or a modifier of 0 or less.
 */
export function withElementalAffinity(action: CombatAction, sheet: Sheet | null): CombatAction {
  const type = sheet ? elementalAffinity(sheet) : null;
  const bonus = sheet ? abilityModifier(sheet, 'charisma') : 0;
  if (!type || bonus <= 0 || action.source !== 'spell') return action;
  const add = (damage: readonly DamageComponent[]): DamageComponent[] | null => {
    const at = damage.findIndex((part) => part.type === type);
    if (at === -1) return null;
    return damage.map((part, index) => (index === at ? { ...part, roll: { ...part.roll, bonus: (part.roll.bonus ?? 0) + bonus } } : part));
  };
  const attack = action.attack ? add(action.attack.damage) : null;
  if (attack) return { ...action, attack: { ...action.attack!, damage: attack } };
  const save = action.save ? add(action.save.damage) : null;
  if (save) return { ...action, save: { ...action.save!, damage: save } };
  return action;
}
