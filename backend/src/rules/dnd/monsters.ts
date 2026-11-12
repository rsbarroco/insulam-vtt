// ============================================
// The monsters, from the System Reference Document 5.2.1
//
// `data/srd-5.2.1-monsters.json` holds the 330 stat blocks of the document's
// "Monsters A–Z" and "Animals" sections, built by `scripts/srd-monsters.py`
// in the shape the creature library stores (NpcStatBlock). The SRD is
// published by Wizards of the Coast under CC-BY-4.0; see SRD_ATTRIBUTION.md.
//
// These are the 2024 stat blocks: an attack reads "Melee Attack Roll: +4,
// reach 5 ft. Hit: …" and a saving throw "Dexterity Saving Throw: DC 13, …",
// which is the wording actions.ts reads.
// ============================================

import catalogue from './data/srd-5.2.1-monsters.json';

export interface MonsterEntry {
  name: string;
  description: string;
}

/** A stat block as the creature library stores one. */
export interface MonsterStatBlock {
  creatureType: string;
  alignment: string;
  gameSystem: 'DND_5E';
  ac: number;
  hpMax: number;
  hitDice?: string;
  speed: string;
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  /** Only the saves the creature is better at than its bare modifier. */
  savingThrows?: Record<string, number>;
  skills?: Record<string, number>;
  damageVulnerabilities?: string;
  damageResistances?: string;
  damageImmunities?: string;
  conditionImmunities?: string;
  senses?: string;
  languages?: string;
  challengeRating: string;
  xp: number;
  traits?: MonsterEntry[];
  actions?: MonsterEntry[];
  bonusActions?: MonsterEntry[];
  reactions?: MonsterEntry[];
  legendaryActions?: MonsterEntry[];
  /** Initiative, gear, and how many legendary actions it has: what the stat block has no field for. */
  notes?: string;
}

export interface Monster {
  name: string;
  challengeRating: string;
  /** "Large Aberration", "Medium or Small Humanoid (Wizard)". */
  creatureType: string;
  alignment: string;
  /** Its space on the board, in squares. */
  size: { width: number; height: number };
  statBlock: MonsterStatBlock;
}

const MONSTERS = catalogue.monsters as unknown as readonly Monster[];
const BY_NAME = new Map(MONSTERS.map((monster) => [monster.name.toLowerCase(), monster]));

export const allMonsters = (): readonly Monster[] => MONSTERS;

export function findMonster(name: string | null | undefined): Monster | null {
  return name ? (BY_NAME.get(name.trim().toLowerCase()) ?? null) : null;
}

/** A challenge rating as a number, for sorting: "1/4" is 0.25. */
export function challengeNumber(rating: string): number {
  const [top, bottom] = rating.split('/').map(Number);
  return bottom ? top / bottom : top;
}
