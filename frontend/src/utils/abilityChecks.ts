// ============================================
// What an ability check can be made with, by the D&D rules
//
// The eighteen skills as the server keys them (`combat.check`), with the
// ability each uses, the six abilities, and the Hide action, which is a
// Dexterity (Stealth) check against DC 15.
// ============================================

export const HIDE = 'hide';
export const HIDE_DC = 15;

export const CHECK_ABILITIES = [
  { key: 'str', name: 'Strength' },
  { key: 'dex', name: 'Dexterity' },
  { key: 'con', name: 'Constitution' },
  { key: 'int', name: 'Intelligence' },
  { key: 'wis', name: 'Wisdom' },
  { key: 'cha', name: 'Charisma' },
] as const;

export type CheckAbility = (typeof CHECK_ABILITIES)[number]['key'];

export const CHECK_SKILLS = [
  { key: 'acrobatics', name: 'Acrobatics', ability: 'Dexterity' },
  { key: 'animalHandling', name: 'Animal Handling', ability: 'Wisdom' },
  { key: 'arcana', name: 'Arcana', ability: 'Intelligence' },
  { key: 'athletics', name: 'Athletics', ability: 'Strength' },
  { key: 'deception', name: 'Deception', ability: 'Charisma' },
  { key: 'history', name: 'History', ability: 'Intelligence' },
  { key: 'insight', name: 'Insight', ability: 'Wisdom' },
  { key: 'intimidation', name: 'Intimidation', ability: 'Charisma' },
  { key: 'investigation', name: 'Investigation', ability: 'Intelligence' },
  { key: 'medicine', name: 'Medicine', ability: 'Wisdom' },
  { key: 'nature', name: 'Nature', ability: 'Intelligence' },
  { key: 'perception', name: 'Perception', ability: 'Wisdom' },
  { key: 'performance', name: 'Performance', ability: 'Charisma' },
  { key: 'persuasion', name: 'Persuasion', ability: 'Charisma' },
  { key: 'religion', name: 'Religion', ability: 'Intelligence' },
  { key: 'sleightOfHand', name: 'Sleight of Hand', ability: 'Dexterity' },
  { key: 'stealth', name: 'Stealth', ability: 'Dexterity' },
  { key: 'survival', name: 'Survival', ability: 'Wisdom' },
] as const;

/**
 * What to send for a choice from the list: `hide`, `skill:stealth` or
 * `ability:str`. Null for anything else.
 */
export function checkChoice(
  choice: string
): { hide: true } | { skill: string } | { ability: CheckAbility } | null {
  if (choice === HIDE) return { hide: true };
  const [kind, key] = choice.split(':');
  if (kind === 'skill' && CHECK_SKILLS.some((skill) => skill.key === key)) return { skill: key };
  const ability = CHECK_ABILITIES.find((entry) => entry.key === key);
  return kind === 'ability' && ability ? { ability: ability.key } : null;
}
