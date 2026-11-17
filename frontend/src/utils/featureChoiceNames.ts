/**
 * The options a feature already on a sheet can be set to.
 *
 * The server reads which option a character took from the feature's name
 * ("Blessed Strikes: Divine Strike", "Fiendish Resilience (Fire)"). The table
 * of those names comes from the server with the campaign's rules; this finds
 * the row of it a feature on a sheet belongs to, so the editor can offer the
 * names instead of having them typed.
 *
 * Pure.
 */

import type { DndFeatureChoice, DndFeatureOption } from '@/types';

const plain = (name: string) => name.trim().toLowerCase().replace(/[’']/g, "'");

/** "Second Wind (Fighter 1)" is the feature Second Wind: the name without where it came from. */
const base = (name: string) =>
  plain(name)
    .replace(/\s*\((?:[a-z][a-z ]+ \d{1,2}|[a-z ]+ feat)\)\s*$/, '')
    .trim();

/** The name with the option taken off: what stands before a colon or a bracket. */
const stem = (name: string) =>
  base(name)
    .replace(/\s*(?::.*|\([^)]*\))\s*$/, '')
    .trim();

export interface FeatureOptions {
  choice: DndFeatureChoice;
  /** The names the feature can take, each with the label to show for it. */
  options: DndFeatureOption[];
  /** The option the feature's name already is, or null. */
  current: DndFeatureOption | null;
}

/**
 * The options of the feature a sheet lists under `name`, or null for a
 * feature that has none. A feature that one option renames matches by the
 * name its class gives it, with or without an option written in; an
 * invocation that names a cantrip or a weapon matches by its own name.
 */
export function optionsOfFeature(
  name: string,
  choices: readonly DndFeatureChoice[]
): FeatureOptions | null {
  const written = plain(name);
  if (!written) return null;
  for (const choice of choices) {
    if (choice.writes === 'race') continue;
    let options: DndFeatureOption[] = [];
    if (choice.writes === 'renames' && choice.feature) {
      const feature = plain(choice.feature);
      if (base(name) === feature || stem(name) === feature) options = choice.options;
    } else if (choice.writes === 'adds') {
      // Only an option written several ways has something to choose: Agonizing Blast for each cantrip.
      const group = choice.options.find(
        (option) =>
          option.group && (plain(option.name) === written || plain(option.group) === stem(name))
      )?.group;
      const variants = choice.options.filter((option) => option.group === group);
      if (group && variants.length > 1) options = variants;
    }
    if (options.length > 0) {
      const current = options.find((option) => plain(option.name) === written) ?? null;
      return { choice, options, current };
    }
  }
  return null;
}
