// ============================================
// Starting equipment, and the attacks it gives, by the D&D rules
//
// SRD 5.2.1: a class's Core Traits and a background each offer a choice of
// starting equipment, "Choose A or B: (A) Greataxe, 4 Handaxes, Explorer's
// Pack, and 15 GP; or (B) 75 GP". The packages are read from that sentence
// here, and the build (buildCharacter.ts) writes the chosen ones into the
// sheet's inventory and gold.
//
// What the character carries is equipped as the rules let it wear and hold
// it: the body armor and the Shield its Armor Training covers, its best
// melee weapon in hand (one-handed with a Shield), and a second Light weapon
// beside a Light one when no Shield takes the other hand. Each weapon it
// carries becomes one row of the sheet's attacks, worked out as the sheet
// editor does (utils/srdWeapons.ts, `weaponAttack`): the ability modifier
// (Strength, Dexterity for a ranged weapon, the better with Finesse) plus the
// Proficiency Bonus when the classes give proficiency with it. A Monk weapon
// also takes the better of the two and the Martial Arts die when it is larger
// (Martial Arts). Fighting styles are not written in: the server adds Archery
// and the others when the attack is rolled (feats.ts), and the Unarmed Strike
// is every creature's without a row (unarmed.ts).
//
// Pure.
// ============================================

import { findSrdArmor, type SrdArmor } from '../../utils/srdArmor';
import { findSrdWeapon, hasWeaponProperty, proficientWith, weaponAttack, type SrdWeapon, type WeaponAttack } from '../../utils/srdWeapons';
import { columnAt, findClass } from './classes';
import type { ClassName } from './advancement';
import type { Background } from './origins';

export interface PackageItem {
  /** As the package names it, singular for a weapon of the reference document: "Handaxe", "Explorer’s Pack". */
  name: string;
  quantity: number;
  /** The SRD weapon it is, when it is one: "Quarterstaff" for an "Arcane Focus (Quarterstaff)". */
  weapon?: string;
  /** The SRD armor or Shield it is, when it is one. */
  armor?: string;
  /** What the package says beside the name: "Arcane Focus" for the Quarterstaff that is one. */
  notes?: string;
}

export interface EquipmentPackage {
  /** "A", "B" or "C". */
  option: string;
  items: PackageItem[];
  gold: number;
  /** The package as the document prints it. */
  text: string;
}

const singular = (name: string) => [name, name.replace(/es$/, ''), name.replace(/s$/, '')];

function itemOf(written: string): PackageItem {
  const counted = /^(\d+)\s+(.+)$/.exec(written);
  const quantity = counted ? Number(counted[1]) : 1;
  const name = counted ? counted[2] : written;
  // "Arcane Focus (Quarterstaff)", "Druidic Focus (Quarterstaff)": a staff that is also a Quarterstaff.
  const focus = /^(.*Focus)\s*\(([^)]+)\)$/.exec(name);
  if (focus && findSrdWeapon(focus[2])) return { name: findSrdWeapon(focus[2])!.name, quantity, weapon: findSrdWeapon(focus[2])!.name, notes: focus[1] };
  const weapon = singular(name).map(findSrdWeapon).find((found): found is SrdWeapon => found !== null);
  if (weapon) return { name: weapon.name, quantity, weapon: weapon.name };
  const armor = findSrdArmor(name);
  if (armor) return { name: armor.name, quantity, armor: armor.name };
  return { name, quantity };
}

/** The packages a "Choose A or B: (A) …; or (B) 75 GP" sentence offers. */
export function equipmentPackages(text: string | null | undefined): EquipmentPackage[] {
  const packages: EquipmentPackage[] = [];
  const pattern = /\(([A-Z])\)\s*(.*?)(?=;?\s*(?:or\s+)?\([A-Z]\)|$)/g;
  for (const match of (text ?? '').matchAll(pattern)) {
    const listed = match[2].trim().replace(/[;.]$/, '');
    const parts = listed.split(/,\s*(?:and\s+)?|\s+and\s+(?=\d+\s+GP$)/).map((part) => part.trim()).filter(Boolean);
    let gold = 0;
    const items: PackageItem[] = [];
    for (const part of parts) {
      const coins = /^(\d+)\s*GP$/i.exec(part);
      if (coins) gold += Number(coins[1]);
      else items.push(itemOf(part));
    }
    packages.push({ option: match[1], items, gold, text: listed });
  }
  return packages;
}

/** The starting equipment a class offers. */
export function classEquipment(name: ClassName): EquipmentPackage[] {
  return equipmentPackages(findClass(name)?.coreTraits['Starting Equipment']);
}

/** The starting equipment a background offers. */
export function backgroundEquipment(background: Background): EquipmentPackage[] {
  return equipmentPackages(background.equipment);
}

/** How many kinds of weapons a class's Weapon Mastery covers at a level: its table's column, or 2 where it has none. 0 without the feature. */
export function weaponMasteryCount(name: ClassName, level: number): number {
  const found = findClass(name);
  const feature = found?.features.find((entry) => entry.name === 'Weapon Mastery');
  if (!feature || feature.level > level) return 0;
  return Number(columnAt(name, 'Weapon Mastery', level) ?? 2);
}

/** Whether a class's Weapon Mastery can take a kind of weapon: a Barbarian's takes only melee ones. */
export function masteryAllows(name: ClassName, weapon: SrdWeapon): boolean {
  return name !== 'Barbarian' || weapon.kind === 'melee';
}

export interface InventoryItem {
  name: string;
  quantity: number;
  equippable?: boolean;
  equipped?: boolean;
  weight?: number;
  notes?: string;
}

/** Whether Armor Training ("Light and Medium armor and Shields") covers a piece of armor. */
export function trainedIn(armor: SrdArmor, training: string): boolean {
  const text = training.toLowerCase();
  return armor.category === 'shield' ? /\bshields?\b/.test(text) : new RegExp(`\\b${armor.category}\\b`).test(text);
}

const pounds = (weight: string) => {
  const found = /([\d.]+)\s*lb/.exec(weight);
  return found ? Number(found[1]) : undefined;
};

/** The average of a roll such as "2d6": what "the best weapon" is measured by. */
const average = (roll: string) => {
  const dice = /^(\d+)d(\d+)$/.exec(roll);
  return dice ? (Number(dice[1]) * (Number(dice[2]) + 1)) / 2 : Number(roll) || 0;
};

/**
 * The inventory a set of packages makes, with what is worn and held
 * equipped. Items of the same name are put together.
 */
export function inventoryOf(packages: readonly EquipmentPackage[], training: string): InventoryItem[] {
  const merged = new Map<string, PackageItem>();
  for (const item of packages.flatMap((entry) => entry.items)) {
    const known = merged.get(item.name);
    if (known) merged.set(item.name, { ...known, quantity: known.quantity + item.quantity });
    else merged.set(item.name, { ...item });
  }
  const items = [...merged.values()];
  const armors = items.flatMap((item) => (item.armor ? [findSrdArmor(item.armor)!] : []));
  const worn = armors.find((armor) => armor.category !== 'shield' && trainedIn(armor, training)) ?? null;
  const shield = armors.find((armor) => armor.category === 'shield' && trainedIn(armor, training)) ?? null;
  const weapons = items.flatMap((item) => (item.weapon ? [findSrdWeapon(item.weapon)!] : []));
  const melee = weapons.filter((weapon) => weapon.kind === 'melee' && (!shield || !hasWeaponProperty(weapon, 'two-handed')));
  const best = (among: SrdWeapon[]) => among.reduce<SrdWeapon | null>((a, b) => (a && average(a.damage) >= average(b.damage) ? a : b), null);
  const main = best(melee) ?? best(weapons.filter((weapon) => !shield || !hasWeaponProperty(weapon, 'two-handed')));
  const offHand =
    main && !shield && hasWeaponProperty(main, 'light') ? best(melee.filter((weapon) => weapon !== main && hasWeaponProperty(weapon, 'light'))) : null;
  const held = new Set([worn?.name, shield?.name, main?.name, offHand?.name].filter(Boolean));

  return items.map((item) => {
    const data = item.weapon ? findSrdWeapon(item.weapon) : item.armor ? findSrdArmor(item.armor) : null;
    const weight = data ? pounds(data.weight) : undefined;
    return {
      name: item.name,
      quantity: item.quantity,
      ...(data ? { equippable: true, equipped: held.has(item.name) } : {}),
      ...(weight !== undefined ? { weight } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
    };
  });
}

export interface Wielder {
  str: number;
  dex: number;
  proficiencyBonus: number;
  /** The classes' Weapon Proficiencies, as written. */
  proficiencies: string;
  /** The character's Monk level, 0 for none: Martial Arts. */
  monkLevel: number;
  /** The weapons whose mastery property the character uses. */
  masteries: readonly string[];
}

/** A Monk weapon: a Simple Melee weapon, or a Martial Melee weapon with the Light property. */
export function isMonkWeapon(weapon: SrdWeapon): boolean {
  return weapon.kind === 'melee' && (weapon.category === 'simple' || hasWeaponProperty(weapon, 'light'));
}

/** The sheet's attack row for a weapon the character carries. */
export function attackFor(weapon: SrdWeapon, wielder: Wielder): WeaponAttack & { useMastery?: boolean } {
  const martialArts = wielder.monkLevel > 0 && isMonkWeapon(weapon) ? columnAt('Monk', 'Martial Arts', wielder.monkLevel) : null;
  const better = Math.max(wielder.str, wielder.dex);
  const asMonk = martialArts
    ? { ...weapon, damage: average(martialArts) > average(weapon.damage) ? martialArts : weapon.damage }
    : weapon;
  const attack = weaponAttack(asMonk, {
    // Martial Arts: Dexterity instead of Strength, as with Finesse.
    str: martialArts ? better : wielder.str,
    dex: wielder.dex,
    proficiencyBonus: wielder.proficiencyBonus,
    proficient: proficientWith(weapon, wielder.proficiencies),
  });
  const mastery = wielder.masteries.some((name) => findSrdWeapon(name)?.name === weapon.name);
  return { ...attack, ...(mastery ? { useMastery: true } : {}) };
}

/** One attack row for each kind of weapon in an inventory, in its order. */
export function attacksOf(inventory: readonly InventoryItem[], wielder: Wielder): Array<WeaponAttack & { useMastery?: boolean }> {
  return inventory.flatMap((item) => {
    const weapon = findSrdWeapon(item.name);
    return weapon ? [attackFor(weapon, wielder)] : [];
  });
}
