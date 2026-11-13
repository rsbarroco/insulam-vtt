// ============================================
// A stat block's Multiattack, read from its text
//
// SRD 5.2.1 stat blocks write a Multiattack in a few shapes:
//
//   • "The ogre makes two Claw attacks and one Bite attack."
//   • "The bugbear makes two Javelin or Morningstar attacks."
//   • "The assassin makes three attacks, using Shortsword or Light Crossbow
//     in any combination."
//
// This reads the first sentence into steps: how many attacks, and which of
// the creature's actions each may be. What follows ("It can replace one
// attack with a use of Spellcasting") is left for the table, as is a
// sentence naming nothing the creature has.
//
// Pure: text and the creature's action names in, steps out.
// ============================================

const NUMBERS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};
const NUMBER = Object.keys(NUMBERS).join('|');

export interface MultiattackStep {
  count: number;
  /** The actions, by their place in the creature's list, the attacks may be made with. */
  choices: number[];
}

const baseName = (name: string) =>
  name
    .replace(/\s*\(.*$/, '')
    .trim()
    .toLowerCase();

/** The steps of a Multiattack, or null when its first sentence names no attack the creature has. */
export function multiattackSteps(text: string, names: readonly string[]): MultiattackStep[] | null {
  const first = (/^(.*?[.!])(?:\s|$)/s.exec(text.trim())?.[1] ?? text).trim();
  const find = (name: string) =>
    names.findIndex((entry) => baseName(entry) === name.trim().toLowerCase());
  const choices = (written: string[]) => {
    const found = written.map(find);
    return found.every((index) => index >= 0) ? found : null;
  };

  const mixed = new RegExp(`makes (${NUMBER}) attacks, using (.+?) in any combination`, 'i').exec(
    first
  );
  if (mixed) {
    const picked = choices(
      mixed[2].split(/\s*,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/).filter(Boolean)
    );
    return picked ? [{ count: NUMBERS[mixed[1].toLowerCase()], choices: picked }] : null;
  }

  const steps: MultiattackStep[] = [];
  const pattern = new RegExp(
    `\\b(${NUMBER})\\s+([A-Z][\\w'’ -]*?)(?:\\s+or\\s+([A-Z][\\w'’ -]*?))?\\s+attacks?\\b`,
    'g'
  );
  for (const match of first.matchAll(pattern)) {
    const picked = choices([match[2], ...(match[3] ? [match[3]] : [])]);
    if (!picked) return null;
    steps.push({ count: NUMBERS[match[1].toLowerCase()], choices: picked });
  }
  return steps.length > 0 ? steps : null;
}
