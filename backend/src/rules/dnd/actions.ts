// ============================================
// Actions as data, by the D&D rules
//
// What a creature can do in combat, in a form the engine can run: the
// attack roll and the damage of a weapon on a character sheet, and the
// attacks and saving throws written out in a monster's stat block.
//
// A sheet stores an attack as fields. A stat block stores an action as a
// sentence in the rules' own wording ("Melee Weapon Attack: +4 to hit, reach
// 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage."), which is read here
// in both the 2014 and the 2024 wording. An action that cannot be read keeps
// its text and nothing else, and is the table's to resolve.
// ============================================

import { findSrdWeapon, type WeaponMastery } from '../../utils/srdWeapons';
import type { Ability } from './conditions';
import { DAMAGE_TYPES, type DamageRoll, type DamageType, type Defences } from './damage';

/** What an action costs of a turn. */
export type ActionCost = 'action' | 'bonusAction' | 'reaction' | 'legendary';

export interface DamageComponent {
  roll: DamageRoll;
  /** Null when the type is not one the rules name, or is not given. */
  type: DamageType | null;
}

export interface AttackProfile {
  kind: 'melee' | 'ranged';
  /** Added to the d20. */
  bonus: number;
  /** How far a melee attack reaches, in feet. */
  reachFeet?: number;
  /** A ranged attack's normal range, and its long range if it has one. */
  rangeFeet?: { normal: number; long: number | null };
  damage: DamageComponent[];
  /** A Heavy weapon: Disadvantage for a wielder whose Strength (melee) or Dexterity (ranged) is under 13. */
  heavy?: boolean;
  /** A Finesse weapon: the better of Strength and Dexterity, and one a Rogue's Sneak Attack can use. */
  finesse?: boolean;
  /** A Light weapon: one extra attack with another Light weapon after the Attack action. */
  light?: boolean;
  /** A Two-Handed weapon, which Great Weapon Fighting asks for. */
  twoHanded?: boolean;
}

export interface SaveProfile {
  ability: Ability;
  dc: number;
  damage: DamageComponent[];
  /** A creature that succeeds takes half the damage rather than none. */
  halfOnSuccess: boolean;
}

export interface CombatAction {
  name: string;
  cost: ActionCost;
  source: 'sheet' | 'statBlock' | 'spell' | 'unarmed';
  /** Which use of the Unarmed Strike it is, when it is one. */
  unarmed?: 'damage' | 'grapple' | 'prone' | 'push';
  /** An attack roll against Armor Class. A thrown weapon can be both melee and ranged; this is the first it names. */
  attack?: AttackProfile;
  /** A saving throw the targets make. */
  save?: SaveProfile;
  /** How far away its target or point of origin can be, in feet. 0 is the caster's own space. */
  rangeFeet?: number;
  /** The area it fills, when it fills one. */
  area?: AreaOfEffect;
  /** The spell it casts, when it is one: its catalogue id and its own level (0 for a cantrip). */
  spell?: { id: string; level: number };
  /** The action as written, for the table to read and for what could not be read here. */
  text?: string;
  /** The weapon's mastery property, when the sheet marks it as one its character uses. */
  mastery?: WeaponMastery;
  /** The SRD weapon a sheet attack is made with. */
  weapon?: string;
  /** A stat block's "(Recharge 5–6)": the lowest d6 roll that gives it back once used. */
  recharge?: number;
}

/**
 * How many Legendary Actions a stat block takes a round: the "Legendary Action
 * Uses: 3" its notes write, 3 when it lists Legendary Actions and says no
 * number, 0 when it has none.
 */
export function legendaryUses(statBlock: { legendaryActions?: unknown; notes?: unknown } | null | undefined): number {
  const listed = Array.isArray(statBlock?.legendaryActions) ? statBlock.legendaryActions.length : 0;
  if (listed === 0) return 0;
  const written = /legendary action uses:\s*(\d+)/i.exec(typeof statBlock?.notes === 'string' ? statBlock.notes : '');
  return written ? Number(written[1]) : 3;
}

/** The lowest d6 roll a "(Recharge 5–6)" or "(Recharge 6)" in an action's name asks for; null for none. */
export function rechargeOf(name: string): number | null {
  const found = /\(recharge\s+([1-6])(?:\s*[–-]\s*6)?\)/i.exec(name);
  return found ? Number(found[1]) : null;
}

/** An area of effect, by the shapes the rules name. `sizeFeet` is the radius of a sphere, cylinder or emanation, and the length of a cone, cube or line. */
export interface AreaOfEffect {
  shape: 'sphere' | 'cone' | 'cube' | 'line' | 'cylinder' | 'emanation';
  sizeFeet: number;
}

export const ABILITY_NAMES: Readonly<Record<string, Ability>> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
};

/** "2d6 + 3", "1d8", "1d4-1" or a flat "5", as dice. Null when there is no number in it. */
export function parseDamageRoll(text: string | null | undefined): DamageRoll | null {
  if (!text) return null;
  const dice = /(\d{1,3})\s*d\s*(\d{1,3})(?:\s*([+-−])\s*(\d{1,4}))?/i.exec(text);
  if (dice) {
    const bonus = dice[4] ? Number(dice[4]) * (dice[3] === '+' ? 1 : -1) : 0;
    return { count: Number(dice[1]), sides: Number(dice[2]), ...(bonus !== 0 ? { bonus } : {}) };
  }
  const flat = /-?\d{1,4}/.exec(text);
  return flat ? { count: 0, sides: 0, bonus: Number(flat[0]) } : null;
}

/** A damage type by name, whatever its case. */
export function parseDamageType(text: string | null | undefined): DamageType | null {
  const key = text?.trim().toLowerCase();
  return (DAMAGE_TYPES as readonly string[]).includes(key ?? '') ? (key as DamageType) : null;
}

/**
 * The damage types in a stat block's line of resistances, vulnerabilities
 * or immunities. A part of the line with a condition on it ("bludgeoning
 * from nonmagical attacks") is not applied; it comes back as `conditional`
 * for the table.
 */
export function parseDamageTypeList(line: string | null | undefined): { types: DamageType[]; conditional: string[] } {
  const types: DamageType[] = [];
  const conditional: string[] = [];
  for (const part of (line ?? '').split(';')) {
    const text = part.trim();
    if (!text) continue;
    const words = text.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const named = words.filter((word) => (DAMAGE_TYPES as readonly string[]).includes(word)) as DamageType[];
    const plain = words.every((word) => (DAMAGE_TYPES as readonly string[]).includes(word) || word === 'and');
    if (plain) types.push(...named);
    else conditional.push(text);
  }
  return { types: [...new Set(types)], conditional };
}

/** A stat block's defences, for the damage rules. */
export function defencesFromStatBlock(statBlock: {
  damageResistances?: string;
  damageVulnerabilities?: string;
  damageImmunities?: string;
}): Defences & { conditional: string[] } {
  const resistances = parseDamageTypeList(statBlock.damageResistances);
  const vulnerabilities = parseDamageTypeList(statBlock.damageVulnerabilities);
  const immunities = parseDamageTypeList(statBlock.damageImmunities);
  return {
    resistances: resistances.types,
    vulnerabilities: vulnerabilities.types,
    immunities: immunities.types,
    conditional: [...resistances.conditional, ...vulnerabilities.conditional, ...immunities.conditional],
  };
}

/** One row of a D&D 5e sheet's attacks. */
export interface SheetAttack {
  name: string;
  attackBonus: number;
  damageRoll?: string;
  damageType?: string;
  /** Feet. */
  range?: number;
  properties?: string[];
  /** The character uses this weapon's mastery property (it has Weapon Mastery and chose this kind of weapon). */
  useMastery?: boolean;
  additionalDamage?: Array<{ label?: string; damageRoll?: string; damageType?: string }>;
}

const hasProperty = (attack: SheetAttack, name: string) =>
  (attack.properties ?? []).some((property) => property.trim().toLowerCase().startsWith(name));

/** The "(range 80/320)" some properties carry. */
function propertyRange(attack: SheetAttack): { normal: number; long: number | null } | null {
  for (const property of attack.properties ?? []) {
    const match = /(\d{1,4})\s*\/\s*(\d{1,4})/.exec(property);
    if (match) return { normal: Number(match[1]), long: Number(match[2]) };
  }
  return null;
}

/**
 * A sheet's attack as an action. It is ranged when it uses ammunition, or
 * has a range past 10 feet and is not thrown; otherwise melee, reaching 10
 * feet with the Reach property and 5 without. An attack named after a weapon
 * of the reference document, with no properties written, takes the weapon's.
 */
export function actionFromSheetAttack(written: SheetAttack): CombatAction {
  // A weapon of the reference document named with no properties written has its own.
  const weapon = (written.properties ?? []).length === 0 ? findSrdWeapon(written.name) : null;
  const attack: SheetAttack = weapon
    ? { ...written, properties: weapon.properties, range: written.range || (weapon.kind === 'ranged' ? weapon.range?.normal : undefined) }
    : written;
  const damage: DamageComponent[] = [];
  const add = (rollText?: string, typeText?: string) => {
    const roll = parseDamageRoll(rollText);
    if (roll) damage.push({ roll, type: parseDamageType(typeText) });
  };
  add(attack.damageRoll, attack.damageType);
  for (const extra of attack.additionalDamage ?? []) add(extra.damageRoll, extra.damageType);

  const range = attack.range ?? 0;
  const ranged = hasProperty(attack, 'ammunition') || (range > 10 && !hasProperty(attack, 'thrown'));
  const profile: AttackProfile = ranged
    ? { kind: 'ranged', bonus: attack.attackBonus, rangeFeet: propertyRange(attack) ?? { normal: range || 5, long: null }, damage }
    : { kind: 'melee', bonus: attack.attackBonus, reachFeet: hasProperty(attack, 'reach') ? 10 : range > 5 && range <= 10 ? range : 5, damage };
  if (hasProperty(attack, 'heavy')) profile.heavy = true;
  if (hasProperty(attack, 'finesse')) profile.finesse = true;
  if (hasProperty(attack, 'light')) profile.light = true;
  if (hasProperty(attack, 'two-handed')) profile.twoHanded = true;
  const srd = findSrdWeapon(written.name);
  return {
    name: attack.name,
    cost: 'action',
    source: 'sheet',
    attack: profile,
    ...(srd ? { weapon: srd.name } : {}),
    ...(srd && written.useMastery ? { mastery: srd.mastery } : {}),
  };
}

/**
 * Every "N (dice) type damage" or "N type damage" in a sentence. Damage that
 * comes only on a condition ("plus 2 (1d4) Slashing damage if the attack roll
 * had Advantage") is left for the table: the engine cannot tell whether it
 * holds.
 */
function damageIn(text: string): DamageComponent[] {
  const found: DamageComponent[] = [];
  const pattern = /(\d{1,4})\s*(?:\(([^)]+)\)\s*)?([a-z]+)\s+damage/gi;
  for (const match of text.matchAll(pattern)) {
    const type = parseDamageType(match[3]);
    if (!type) continue;
    if (/^\s+(if|when|while|unless)\b/i.test(text.slice(match.index + match[0].length))) continue;
    const roll = parseDamageRoll(match[2] ?? match[1]);
    if (roll) found.push({ roll, type });
  }
  return found;
}

function attackIn(text: string): AttackProfile | null {
  const header = /(melee or ranged|melee|ranged)\s+(?:weapon\s+|spell\s+)?attack(?:\s+roll)?\s*:\s*\+?\s*(-?\d{1,3})/i.exec(text);
  if (!header) return null;
  const kind = header[1].toLowerCase().startsWith('ranged') ? 'ranged' : 'melee';
  const reach = /reach\s+(\d{1,3})\s*ft/i.exec(text);
  const range = /range\s+(\d{1,4})(?:\s*\/\s*(\d{1,4}))?\s*ft/i.exec(text);
  const hit = /\bhit:\s*(.*)$/is.exec(text);
  // What a hit deals is its first sentence. What follows ("If the target is a
  // creature, it takes 5 (1d10) Poison damage at the start of each of its
  // turns") is a rider, and not damage of the hit.
  const onHit = hit ? (/^(.*?[.!])(?:\s|$)/s.exec(hit[1])?.[1] ?? hit[1]) : '';
  const profile: AttackProfile = { kind, bonus: Number(header[2]), damage: damageIn(onHit) };
  if (kind === 'melee') profile.reachFeet = reach ? Number(reach[1]) : 5;
  else if (range) profile.rangeFeet = { normal: Number(range[1]), long: range[2] ? Number(range[2]) : null };
  return profile;
}

function saveIn(text: string): SaveProfile | null {
  const abilities = Object.keys(ABILITY_NAMES).join('|');
  // "DC 13 Dexterity saving throw" (2014) or "Dexterity Saving Throw: DC 13" (2024).
  const older = new RegExp(`DC\\s+(\\d{1,2})\\s+(${abilities})\\s+saving\\s+throw`, 'i').exec(text);
  const newer = new RegExp(`(${abilities})\\s+saving\\s+throw\\s*:\\s*DC\\s+(\\d{1,2})`, 'i').exec(text);
  if (!older && !newer) return null;
  const dc = Number(older ? older[1] : newer![2]);
  const ability = ABILITY_NAMES[(older ? older[2] : newer![1]).toLowerCase()];
  return {
    ability,
    dc,
    damage: damageIn(text),
    halfOnSuccess: /half\s+(?:as\s+much\s+)?damage|success:\s*half/i.test(text),
  };
}

/** One entry of a stat block's actions, bonus actions, reactions or legendary actions. */
export function actionFromStatBlockEntry(entry: { name: string; description?: string }, cost: ActionCost): CombatAction {
  const text = entry.description ?? '';
  const action: CombatAction = { name: entry.name, cost, source: 'statBlock', text };
  const recharge = rechargeOf(entry.name);
  if (recharge !== null) action.recharge = recharge;
  const attack = attackIn(text);
  if (attack) action.attack = attack;
  // An attack's rider ("…must succeed on a DC 11 Constitution saving throw")
  // is left in the text: which damage is the hit's and which the save's is
  // not something the sentence says reliably.
  else {
    const save = saveIn(text);
    if (save) action.save = save;
  }
  return action;
}

type Entries = ReadonlyArray<{ name: string; description?: string }> | undefined;

/** Everything a stat block lets its creature do in combat. */
export function actionsFromStatBlock(statBlock: {
  actions?: Entries;
  bonusActions?: Entries;
  reactions?: Entries;
  legendaryActions?: Entries;
}): CombatAction[] {
  const from = (entries: Entries, cost: ActionCost) => (entries ?? []).map((entry) => actionFromStatBlockEntry(entry, cost));
  return [
    ...from(statBlock.actions, 'action'),
    ...from(statBlock.bonusActions, 'bonusAction'),
    ...from(statBlock.reactions, 'reaction'),
    ...from(statBlock.legendaryActions, 'legendary'),
  ];
}

/** Everything a D&D 5e sheet's attacks let its character do. */
export function actionsFromSheet(data: { attacks?: readonly SheetAttack[] } | null | undefined): CombatAction[] {
  return (data?.attacks ?? []).filter((attack) => attack.name.trim() !== '').map(actionFromSheetAttack);
}
