// ============================================
// How a campaign's characters are built
//
// The same file in the browser (frontend/src/utils/characterRules.ts), which
// shows the switches and builds characters by them, and on the server
// (backend/src/utils/characterRules.ts), which stores them and checks what is
// built.
//
// Gestalt and four house rules, each a switch a campaign's DM sets. They are
// on by default; a campaign that wants the rules as written turns them off.
// What each one means is in docs/TACTICAL_MODE.md ("Character creation:
// gestalt and house rules").
//
// Pure: no imports.
// ============================================

export interface CharacterRules {
  /** A character advances in two classes at once and has the features of both. */
  gestalt: boolean;
  /** Ability scores go to 22, not 20. */
  abilityScoreCap22: boolean;
  /** Every fourth level gives both a feat and +2 to ability scores, in place of the choice between them. */
  featAndAbilityScores: boolean;
  /** The ability score increases of a background go to any scores the player chooses. */
  freeBackgroundAbilityScores: boolean;
  /** A character takes any origin feat, whatever the background. */
  freeOriginFeat: boolean;
}

export const CHARACTER_RULE_KEYS = [
  'gestalt',
  'abilityScoreCap22',
  'featAndAbilityScores',
  'freeBackgroundAbilityScores',
  'freeOriginFeat',
] as const satisfies ReadonlyArray<keyof CharacterRules>;

export const DEFAULT_CHARACTER_RULES: Readonly<CharacterRules> = {
  gestalt: true,
  abilityScoreCap22: true,
  featAndAbilityScores: true,
  freeBackgroundAbilityScores: true,
  freeOriginFeat: true,
};

/** The rules as the fifth edition has them: every switch off. */
export const RULES_AS_WRITTEN: Readonly<CharacterRules> = {
  gestalt: false,
  abilityScoreCap22: false,
  featAndAbilityScores: false,
  freeBackgroundAbilityScores: false,
  freeOriginFeat: false,
};

/** A campaign's stored rules, with the default for every switch it does not set. */
export function readCharacterRules(stored: unknown): CharacterRules {
  const rules: CharacterRules = { ...DEFAULT_CHARACTER_RULES };
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return rules;
  for (const key of CHARACTER_RULE_KEYS) {
    const value = (stored as Record<string, unknown>)[key];
    if (typeof value === 'boolean') rules[key] = value;
  }
  return rules;
}

/** The highest an ability score can be raised to by a level's improvements. */
export function abilityScoreCap(rules: CharacterRules): number {
  return rules.abilityScoreCap22 ? 22 : 20;
}
