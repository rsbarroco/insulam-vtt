// ============================================
// A Warlock's features and the Fiend Patron, by the D&D rules (SRD 5.2.1)
//
//   • Pact Magic: the Warlock's slots, all of one level, come back when it
//     finishes a Short Rest. A sheet keeps them with its other slots, at the
//     level the Warlock table gives.
//   • Magical Cunning (Warlock 2): a 1-minute rite gives back expended Pact
//     Magic slots, no more than half the maximum (round up); once, until a
//     Long Rest. Eldritch Master (Warlock 20): all of them.
//   • Pact of the Blade: the pact weapon can deal Necrotic, Psychic or
//     Radiant damage instead of its own type. Thirsting Blade: two attacks
//     with it in the Attack action; Devouring Blade: three.
//   • Eldritch Smite: once a turn, a hit with the pact weapon can expend a
//     Pact Magic slot for 1d8 Force damage, plus 1d8 for each level of the
//     slot, and knock a Huge or smaller target Prone.
//   • Lifedrinker: once a turn, a hit with the pact weapon can deal 1d6 more
//     Necrotic, Psychic or Radiant damage, and the Warlock can spend a Hit
//     Point Die to regain Hit Points.
//   • Fiendish Vigor: False Life on itself without a slot, its dice at their
//     highest: 12 Temporary Hit Points.
//   • Devil's Sight: sees normally in Darkness within 120 feet.
//   • Dark One's Blessing (Fiend 3): Temporary Hit Points of the Charisma
//     modifier plus the Warlock level (at least 1) when the Warlock reduces
//     an enemy to 0 Hit Points, or someone else does within 10 feet of it.
//   • Dark One's Own Luck (Fiend 6): 1d10 added to an ability check or a
//     saving throw once it is rolled; as many uses as the Charisma modifier
//     (at least one) until a Long Rest, one a roll.
//   • Fiendish Resilience (Fiend 10): Resistance to one damage type, not
//     Force, chosen as a rest ends.
//   • Hurl Through Hell (Fiend 14): once a turn, a hit with an attack roll;
//     the target makes a Charisma save against the spell save DC or takes
//     8d10 Psychic damage (not a Fiend) and is Incapacitated until the end of
//     the Warlock's next turn. Once until a Long Rest, or again for a Pact
//     Magic slot.
//
// The invocations and the subclass features are read by name from the
// sheet's features. The pact weapon is the attack the sheet's Pact of the
// Blade names in brackets, "Pact of the Blade (Longsword)", or an attack
// with "pact" in its own name; Fiendish Resilience's type is the one in its
// brackets, "Fiendish Resilience (Fire)". A sheet that names neither leaves
// it to the table. Charisma for the pact weapon's rolls is what the sheet
// writes in that attack's bonus and damage.
//
// Pure.
// ============================================

import type { CombatAction, DamageComponent } from './actions';
import { pactMagic } from './advancement';
import { DAMAGE_TYPES, type DamageType } from './damage';
import { readFeatures } from './featureEffects';
import { abilityModifier, classLevel, resourcesOf, spendResource } from './resources';

type Sheet = Record<string, unknown>;

const plain = (name: string) => name.trim().toLowerCase().replace(/[’']/g, "'");

/** What a Warlock's feature of this name carries in brackets or after a colon, for each time the sheet lists it; '' when it names nothing. */
function named(sheet: Sheet | null | undefined, feature: string): string[] {
  if (!sheet || classLevel(sheet, 'Warlock') === 0) return [];
  const wanted = plain(feature);
  return readFeatures(sheet).flatMap((entry) => {
    const found = /^([^(:]+?)\s*(?:\(([^)]*)\)|:\s*(.+))?\s*$/.exec(plain(entry.name));
    if (!found || found[1] !== wanted) return [];
    const inside = (found[2] ?? found[3] ?? '').trim();
    // Brackets that give where the feature came from ("Warlock 3", "Fiend Patron") name nothing.
    return [/^(warlock|fiend)\b/.test(inside) ? '' : inside];
  });
}

/** Whether a Warlock's sheet lists a feature or an invocation by name. */
export function warlockHas(sheet: Sheet | null | undefined, feature: string): boolean {
  return named(sheet, feature).length > 0;
}

/** A Warlock's Pact Magic: how many slots, and their level; null for another class. */
export function pactSlots(sheet: Sheet | null | undefined): { count: number; level: number } | null {
  const level = sheet ? classLevel(sheet, 'Warlock') : 0;
  const pact = level > 0 ? pactMagic(['Warlock'], level) : null;
  return pact ? { count: pact.slots, level: pact.slotLevel } : null;
}

type Slots = Record<string, { total?: number; expended?: number }>;

/** The sheet with up to `most` expended Pact Magic slots back, and how many came back. */
function withPactSlotsBack(sheet: Sheet, most: number): { sheet: Sheet; back: number } {
  const pact = pactSlots(sheet);
  const casting = (sheet.spellcasting ?? null) as { slots?: Slots } | null;
  const slot = pact ? casting?.slots?.[String(pact.level)] : undefined;
  const expended = Math.max(0, Math.floor(slot?.expended ?? 0));
  const back = pact ? Math.min(expended, pact.count, most) : 0;
  if (!pact || !casting || !slot || back <= 0) return { sheet, back: 0 };
  return {
    sheet: { ...sheet, spellcasting: { ...casting, slots: { ...casting.slots, [String(pact.level)]: { ...slot, expended: expended - back } } } },
    back,
  };
}

/** Pact Magic as a Short Rest ends: the expended Pact Magic slots come back. */
export function restorePactSlots(sheet: Sheet): { sheet: Sheet; regained: string[] } {
  const restored = withPactSlotsBack(sheet, Infinity);
  return { sheet: restored.sheet, regained: restored.back > 0 ? [`${restored.back} Pact Magic ${restored.back === 1 ? 'slot' : 'slots'}`] : [] };
}

/** How many Pact Magic slots Magical Cunning gives back at most: half the maximum, rounded up; all with Eldritch Master (level 20). */
export function magicalCunningSlots(sheet: Sheet): number {
  const pact = pactSlots(sheet);
  if (!pact || classLevel(sheet, 'Warlock') < 2) return 0;
  return classLevel(sheet, 'Warlock') >= 20 ? pact.count : Math.ceil(pact.count / 2);
}

/** The sheet after Magical Cunning: the slots back and its use spent, or why not. */
export function magicalCunning(sheet: Sheet): { ok: true; sheet: Sheet; summary: string } | { ok: false; reason: string } {
  const uses = resourcesOf(sheet).find((entry) => entry.name === 'Magical Cunning');
  if (!uses) return { ok: false, reason: 'The sheet has no Magical Cunning' };
  if (uses.used >= uses.max) return { ok: false, reason: 'Magical Cunning is used until a Long Rest' };
  const restored = withPactSlotsBack(sheet, magicalCunningSlots(sheet));
  if (restored.back === 0) return { ok: false, reason: 'No Pact Magic slot is expended to regain' };
  const spent = spendResource(restored.sheet, 'Magical Cunning');
  if (!spent.ok) return { ok: false, reason: spent.reason };
  return { ok: true, sheet: spent.sheet, summary: `Magical Cunning: ${restored.back} Pact Magic ${restored.back === 1 ? 'slot' : 'slots'} regained` };
}

/** Whether an action is an attack with the Warlock's pact weapon. */
export function isPactWeapon(sheet: Sheet | null | undefined, action: CombatAction): boolean {
  if (action.source !== 'sheet' || !action.attack || action.unarmed) return false;
  const weapons = named(sheet, 'Pact of the Blade');
  if (weapons.length === 0) return false;
  const name = plain(action.name);
  return /\bpact\b/.test(name) || weapons.includes(name);
}

/** How many attacks the Attack action makes with the pact weapon: two with Thirsting Blade, three with Devouring Blade too. */
export function pactWeaponAttacks(sheet: Sheet | null | undefined): number {
  if (!warlockHas(sheet, 'Pact of the Blade') || !warlockHas(sheet, 'Thirsting Blade')) return 1;
  return warlockHas(sheet, 'Devouring Blade') ? 3 : 2;
}

/** The damage types a pact weapon, and Lifedrinker, can deal by the Warlock's choice. */
export const PACT_DAMAGE_TYPES = ['necrotic', 'psychic', 'radiant'] as const;
export type PactDamageType = (typeof PACT_DAMAGE_TYPES)[number];

/** The pact weapon's attack dealing the chosen type instead of its own. */
export function withPactDamage(action: CombatAction, type: PactDamageType): CombatAction {
  if (!action.attack || action.attack.damage.length === 0) return action;
  const [first, ...rest] = action.attack.damage;
  return { ...action, attack: { ...action.attack, damage: [{ ...first, type }, ...rest] } };
}

/** The prompt's options for Eldritch Smite. */
export const ELDRITCH_SMITE = 'Eldritch Smite';
export const ELDRITCH_SMITE_PRONE = 'Eldritch Smite and Prone';

/** Eldritch Smite's extra damage with a Pact Magic slot of `slotLevel`: 1d8 Force, plus 1d8 for each level of the slot. */
export function eldritchSmiteDamage(slotLevel: number): DamageComponent {
  return { roll: { count: 1 + slotLevel, sides: 8 }, type: 'force' };
}

/** The prompt's options for Lifedrinker, and the damage type each one deals. */
export const LIFEDRINKER_OPTIONS: Readonly<Record<string, PactDamageType>> = {
  'Lifedrinker (Necrotic)': 'necrotic',
  'Lifedrinker (Psychic)': 'psychic',
  'Lifedrinker (Radiant)': 'radiant',
};

/** Lifedrinker's extra damage. */
export function lifedrinkerDamage(type: PactDamageType): DamageComponent {
  return { roll: { count: 1, sides: 6 }, type };
}

/** Fiendish Vigor: False Life's 2d4 + 4 Temporary Hit Points with the dice at their highest. */
export const FIENDISH_VIGOR_TEMPORARY_HIT_POINTS = 12;

/** Devil's Sight: how far the Warlock sees normally in Darkness, in feet; 0 without the invocation. */
export function devilsSightFeet(sheet: Sheet | null | undefined): number {
  return warlockHas(sheet, "Devil's Sight") ? 120 : 0;
}

/** Dark One's Blessing: the Temporary Hit Points it gives, the Charisma modifier plus the Warlock level, at least 1; 0 without the feature. */
export function darkOnesBlessing(sheet: Sheet | null | undefined): number {
  if (!sheet || !warlockHas(sheet, "Dark One's Blessing")) return 0;
  return Math.max(1, abilityModifier(sheet, 'charisma') + classLevel(sheet, 'Warlock'));
}

/** How far from the Warlock an enemy someone else reduces to 0 Hit Points still gives Dark One's Blessing, in feet. */
export const DARK_ONES_BLESSING_FEET = 10;

/** The die Dark One's Own Luck adds. */
export const DARK_ONES_OWN_LUCK = "Dark One's Own Luck";
export const DARK_ONES_OWN_LUCK_SIDES = 10;

/** Whether the sheet has a use of Dark One's Own Luck left. */
export function hasOwnLuckLeft(sheet: Sheet | null | undefined): boolean {
  const uses = sheet ? resourcesOf(sheet).find((entry) => entry.name === DARK_ONES_OWN_LUCK) : undefined;
  return uses !== undefined && uses.used < uses.max;
}

/** Fiendish Resilience: the damage type the sheet's feature names, never Force; null when it names none. */
export function fiendishResilience(sheet: Sheet | null | undefined): DamageType | null {
  for (const type of named(sheet, 'Fiendish Resilience')) {
    if (type !== 'force' && (DAMAGE_TYPES as readonly string[]).includes(type)) return type as DamageType;
  }
  return null;
}

/** The prompt's options for Hurl Through Hell: its use, or a Pact Magic slot that restores the use. */
export const HURL_THROUGH_HELL = 'Hurl Through Hell';
export const HURL_THROUGH_HELL_SLOT = 'Hurl Through Hell (Pact Magic slot)';

/** Hurl Through Hell's damage to a creature that is not a Fiend. */
export const HURL_THROUGH_HELL_DAMAGE: DamageComponent = { roll: { count: 8, sides: 10 }, type: 'psychic' };

/** Whether a creature type, as a stat block writes it ("Medium Fiend"), is a Fiend. */
export function isFiend(creatureType: string | null | undefined): boolean {
  return /\bfiend\b/i.test(creatureType ?? '');
}

/** A Warlock's spell save DC: the one its sheet keeps, or 8 plus its Proficiency Bonus and Charisma modifier. */
export function warlockSaveDC(sheet: Sheet): number {
  const written = (sheet.spellcasting as { spellSaveDC?: unknown } | undefined)?.spellSaveDC;
  if (typeof written === 'number') return written;
  return 8 + (typeof sheet.proficiencyBonus === 'number' ? sheet.proficiencyBonus : 2) + abilityModifier(sheet, 'charisma');
}
