// ============================================
// The armor of the System Reference Document 5.2.1, and Armor Class
//
// The Armor table of the SRD's "Equipment" chapter, as data, and the Armor
// Class a character has from what it wears and its features:
//
//   • Light armor: its base plus the Dexterity modifier. Medium: plus the
//     Dexterity modifier to at most 2. Heavy: its base alone.
//   • A Shield adds 2.
//   • Without armor, 10 plus the Dexterity modifier; a Barbarian's Unarmored
//     Defense adds the Constitution modifier (a Shield allowed), a Monk's the
//     Wisdom modifier (without a Shield); the best of them counts.
//   • The Defense fighting style adds 1 while armor is worn.
//
// The SRD 5.2.1 is published by Wizards of the Coast under CC-BY-4.0; see
// SRD_ATTRIBUTION.md. This file is kept identical in the backend and the
// frontend (a test holds them together): the character builder works out a
// new character's Armor Class, and the sheet editor one from equipped items.
// ============================================

export interface SrdArmor {
  name: string;
  category: 'light' | 'medium' | 'heavy' | 'shield';
  /** The Armor Class it gives, or what a Shield adds. */
  base: number;
  /** The most Dexterity modifier it lets count: null for all of it, 0 for none. */
  dexCap: number | null;
  /** The Strength score heavy armor asks before its wearer keeps its Speed. */
  strength?: number;
  /** Disadvantage on Dexterity (Stealth) checks. */
  stealthDisadvantage?: true;
  weight: string;
  cost: string;
}

export const SRD_ARMOR: readonly SrdArmor[] = [
  {
    name: 'Padded Armor',
    category: 'light',
    base: 11,
    dexCap: null,
    stealthDisadvantage: true,
    weight: '8 lb.',
    cost: '5 GP',
  },
  {
    name: 'Leather Armor',
    category: 'light',
    base: 11,
    dexCap: null,
    weight: '10 lb.',
    cost: '10 GP',
  },
  {
    name: 'Studded Leather Armor',
    category: 'light',
    base: 12,
    dexCap: null,
    weight: '13 lb.',
    cost: '45 GP',
  },
  { name: 'Hide Armor', category: 'medium', base: 12, dexCap: 2, weight: '12 lb.', cost: '10 GP' },
  { name: 'Chain Shirt', category: 'medium', base: 13, dexCap: 2, weight: '20 lb.', cost: '50 GP' },
  {
    name: 'Scale Mail',
    category: 'medium',
    base: 14,
    dexCap: 2,
    stealthDisadvantage: true,
    weight: '45 lb.',
    cost: '50 GP',
  },
  {
    name: 'Breastplate',
    category: 'medium',
    base: 14,
    dexCap: 2,
    weight: '20 lb.',
    cost: '400 GP',
  },
  {
    name: 'Half Plate Armor',
    category: 'medium',
    base: 15,
    dexCap: 2,
    stealthDisadvantage: true,
    weight: '40 lb.',
    cost: '750 GP',
  },
  {
    name: 'Ring Mail',
    category: 'heavy',
    base: 14,
    dexCap: 0,
    stealthDisadvantage: true,
    weight: '40 lb.',
    cost: '30 GP',
  },
  {
    name: 'Chain Mail',
    category: 'heavy',
    base: 16,
    dexCap: 0,
    strength: 13,
    stealthDisadvantage: true,
    weight: '55 lb.',
    cost: '75 GP',
  },
  {
    name: 'Splint Armor',
    category: 'heavy',
    base: 17,
    dexCap: 0,
    strength: 15,
    stealthDisadvantage: true,
    weight: '60 lb.',
    cost: '200 GP',
  },
  {
    name: 'Plate Armor',
    category: 'heavy',
    base: 18,
    dexCap: 0,
    strength: 15,
    stealthDisadvantage: true,
    weight: '65 lb.',
    cost: '1,500 GP',
  },
  { name: 'Shield', category: 'shield', base: 2, dexCap: null, weight: '6 lb.', cost: '10 GP' },
];

const key = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .replace(/\barmor\b/g, '')
    .trim();

/** The SRD armor an item's name is ("Chain mail", "studded leather"), or null. */
export function findSrdArmor(name: string | null | undefined): SrdArmor | null {
  if (!name) return null;
  const wanted = key(name);
  return SRD_ARMOR.find((armor) => key(armor.name) === wanted) ?? null;
}

export interface ArmorClassInput {
  /** Ability modifiers. */
  dex: number;
  con?: number;
  wis?: number;
  /** The character's classes, by name. */
  classes: readonly string[];
  /** The names of its features and feats, however the sheet writes them. */
  features: readonly string[];
  /** The names of the items it has equipped. */
  equipped: readonly string[];
}

export interface ArmorClassResult {
  armorClass: number;
  /** The armor worn, or null. */
  armor: string | null;
  shield: boolean;
  /** How it is worked out, for the sheet: "Chain Mail 16 + Shield 2 + Defense 1". */
  from: string;
}

const has = (list: readonly string[], name: string) =>
  list.some((entry) => entry.toLowerCase().includes(name.toLowerCase()));

/** A character's Armor Class from what it has equipped, its class and its features. */
export function armorClassOf(input: ArmorClassInput): ArmorClassResult {
  const items = input.equipped
    .map(findSrdArmor)
    .filter((armor): armor is SrdArmor => armor !== null);
  const worn = items.find((armor) => armor.category !== 'shield') ?? null;
  const shield = items.some((armor) => armor.category === 'shield');
  const sign = (value: number) => (value < 0 ? `- ${-value}` : `+ ${value}`);
  let armorClass: number;
  let from: string;
  if (worn) {
    const dex = worn.dexCap === null ? input.dex : Math.min(input.dex, worn.dexCap);
    armorClass = worn.base + dex;
    from = `${worn.name} ${worn.base}${worn.dexCap === 0 ? '' : ` ${sign(dex)} Dexterity`}`;
    if (has(input.features, 'Defense')) {
      armorClass += 1;
      from += ' + Defense 1';
    }
  } else {
    const options: Array<{ armorClass: number; from: string }> = [
      { armorClass: 10 + input.dex, from: `10 ${sign(input.dex)} Dexterity` },
    ];
    if (has(input.classes, 'Barbarian')) {
      options.push({
        armorClass: 10 + input.dex + (input.con ?? 0),
        from: `Unarmored Defense 10 ${sign(input.dex)} Dexterity ${sign(input.con ?? 0)} Constitution`,
      });
    }
    if (has(input.classes, 'Monk') && !shield) {
      options.push({
        armorClass: 10 + input.dex + (input.wis ?? 0),
        from: `Unarmored Defense 10 ${sign(input.dex)} Dexterity ${sign(input.wis ?? 0)} Wisdom`,
      });
    }
    const best = options.reduce((a, b) => (b.armorClass > a.armorClass ? b : a));
    armorClass = best.armorClass;
    from = best.from;
  }
  if (shield) {
    armorClass += 2;
    from += ' + Shield 2';
  }
  return { armorClass, armor: worn?.name ?? null, shield, from };
}
