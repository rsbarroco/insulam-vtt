// ============================================
// A Wizard's Arcane Recovery, by the D&D rules (SRD 5.2.1)
//
// When it finishes a Short Rest, a Wizard can recover expended spell slots
// of a combined level of no more than half its Wizard level (round up), none
// of level 6 or higher; once, until it finishes a Long Rest.
// ============================================

import { classLevel, resourcesOf, spendResource, type ResourceName } from './resources';

type Sheet = Record<string, unknown>;

/** The combined level of slots a Wizard can recover: half its Wizard level, rounded up; 0 for another class. */
export function arcaneRecoveryBudget(sheet: Sheet): number {
  return Math.ceil(classLevel(sheet, 'Wizard') / 2);
}

/**
 * The sheet with the slots of these levels recovered and the use of a feature
 * that recovers them as a Short Rest ends spent (Arcane Recovery, a Land
 * Druid's Natural Recovery), or why not: a combined level of `budget` at most,
 * none of level 6 or higher.
 */
export function recoverSlots(
  sheet: Sheet,
  levels: readonly number[],
  name: Extract<ResourceName, 'Arcane Recovery' | 'Natural Recovery'>,
  budget: number
): { ok: true; sheet: Sheet; summary: string } | { ok: false; reason: string } {
  const uses = resourcesOf(sheet).find((entry) => entry.name === name);
  if (!uses) return { ok: false, reason: `The sheet has no ${name}` };
  if (uses.used >= uses.max) return { ok: false, reason: `${name} is used until a Long Rest` };
  if (levels.length === 0) return { ok: false, reason: 'Choose the spell slots to recover' };
  if (levels.some((level) => level >= 6)) return { ok: false, reason: `${name} recovers no slot of level 6 or higher` };
  const combined = levels.reduce((sum, level) => sum + level, 0);
  if (combined > budget) return { ok: false, reason: `Those slots come to level ${combined}; ${name} recovers ${budget} at most` };

  const casting = (sheet.spellcasting ?? {}) as { slots?: Record<string, { total?: number; expended?: number }> };
  const slots = { ...(casting.slots ?? {}) };
  for (const level of levels) {
    const slot = slots[String(level)];
    const expended = Math.floor(slot?.expended ?? 0);
    if (!slot || expended <= 0) return { ok: false, reason: `No level ${level} spell slot is expended to recover` };
    slots[String(level)] = { ...slot, expended: expended - 1 };
  }
  const spent = spendResource({ ...sheet, spellcasting: { ...casting, slots } }, name);
  if (!spent.ok) return { ok: false, reason: spent.reason };
  const named = [...levels].sort((a, b) => a - b).map((level) => `level ${level}`).join(', ');
  return { ok: true, sheet: spent.sheet, summary: `${name}: ${levels.length === 1 ? 'a' : levels.length} spell ${levels.length === 1 ? 'slot' : 'slots'} recovered (${named})` };
}

/** The sheet with the slots of these levels recovered and the use of Arcane Recovery spent, or why not. */
export function arcaneRecovery(
  sheet: Sheet,
  levels: readonly number[]
): { ok: true; sheet: Sheet; summary: string } | { ok: false; reason: string } {
  return recoverSlots(sheet, levels, 'Arcane Recovery', arcaneRecoveryBudget(sheet));
}
