// ============================================
// What a character's features let it do on its turn
//
// A sheet lists features as a name and the rule's own text (the guided
// builder writes them from the reference document; a player can add more).
// This reads from them what the turn needs to know: how many attacks the
// Attack action makes, and which features are used with a Bonus Action or a
// Reaction, so the turn can offer them.
//
// The reading is of the rules' own wording ("As a Bonus Action, you can…",
// "you can take a Reaction to…"). A feature whose text says neither is not
// listed: it is always on, or the table's to apply.
// ============================================

import type { ActionCost } from './actions';

export interface SheetFeature {
  name: string;
  description: string;
}

/** A feature the turn can offer: what it costs and its rule. */
export interface FeatureOption {
  /** The feature's name as the sheet has it, without the class and level it came from. */
  name: string;
  cost: Extract<ActionCost, 'bonusAction' | 'reaction'>;
  text: string;
}

/** "Second Wind (Fighter 1)" is the feature Second Wind. */
export function featureName(listed: string): string {
  return listed.replace(/\s*\((?:[A-Z][A-Za-z ]+ \d{1,2}|[A-Za-z ]+ feat|[A-Z][A-Za-z]+)\)\s*$/, '').trim();
}

/** A sheet's features, whichever of its two stored shapes each has. */
export function readFeatures(data: { featuresAndTraits?: unknown } | null | undefined): SheetFeature[] {
  const list = Array.isArray(data?.featuresAndTraits) ? data.featuresAndTraits : [];
  return list.flatMap((entry): SheetFeature[] => {
    if (typeof entry === 'string') return entry.trim() ? [{ name: entry.trim(), description: '' }] : [];
    const record = (entry ?? {}) as { name?: unknown; description?: unknown };
    if (typeof record.name !== 'string' || !record.name.trim()) return [];
    return [{ name: record.name.trim(), description: typeof record.description === 'string' ? record.description : '' }];
  });
}

/** Whether the sheet lists a feature of this name ("Evasion (Rogue 7)" is Evasion). */
export function hasFeature(features: ReadonlyArray<{ name: string }>, name: string): boolean {
  const wanted = name.toLowerCase();
  return features.some((feature) => featureName(feature.name).toLowerCase() === wanted);
}

const EXTRA_ATTACKS: Readonly<Record<string, number>> = {
  'Extra Attack': 1,
  'Two Extra Attacks': 2,
  'Three Extra Attacks': 3,
};

/**
 * How many attacks the Attack action makes: one, and one more for Extra
 * Attack, two for Two Extra Attacks, three for Three Extra Attacks. The
 * features replace one another; they do not add up.
 */
export function attacksPerAction(features: readonly SheetFeature[]): number {
  return 1 + Math.max(0, ...features.map((feature) => EXTRA_ATTACKS[featureName(feature.name)] ?? 0));
}

// The verb in any case ("As a Bonus Action, …"); the game term as the rules capitalise it.
const VERB = '(?:[Aa]s|[Ww]ith|[Tt]akes?|[Uu]ses?|[Uu]sing)';
const BONUS = new RegExp(`\\b${VERB} (?:a|your|its) Bonus Action\\b`);
const REACTION = new RegExp(`\\b${VERB} (?:a|your|its) Reaction\\b`);

/** Reactions the server resolves, listed by their name when a sheet gives no text for them. */
const REACTIONS_BY_NAME = new Set(['uncanny dodge']);

/** The features used with a Bonus Action or a Reaction, in the sheet's order. A feature that offers both is listed twice. */
export function featureOptions(features: readonly SheetFeature[]): FeatureOption[] {
  const out: FeatureOption[] = [];
  for (const feature of features) {
    const name = featureName(feature.name);
    if (BONUS.test(feature.description)) out.push({ name, cost: 'bonusAction', text: feature.description });
    if (REACTION.test(feature.description) || (REACTIONS_BY_NAME.has(name.toLowerCase()) && !feature.description.trim())) {
      out.push({ name, cost: 'reaction', text: feature.description });
    }
  }
  return out;
}
