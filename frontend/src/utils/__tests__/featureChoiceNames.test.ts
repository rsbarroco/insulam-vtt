/**
 * Finding the options a feature already on a sheet can be set to.
 */

import { describe, it, expect } from 'vitest';
import type { DndFeatureChoice } from '@/types';
import { optionsOfFeature } from '../featureChoiceNames';

const choices: DndFeatureChoice[] = [
  {
    id: 'blessedStrikes',
    title: 'Blessed Strikes',
    class: 'Cleric',
    level: 7,
    counts: [],
    writes: 'renames',
    feature: 'Blessed Strikes',
    asked: true,
    options: [
      { label: 'Divine Strike', name: 'Blessed Strikes: Divine Strike (Cleric 7)' },
      { label: 'Potent Spellcasting', name: 'Blessed Strikes: Potent Spellcasting (Cleric 7)' },
    ],
  },
  {
    id: 'huntersPrey',
    title: 'Hunter’s Prey',
    class: 'Ranger',
    level: 3,
    counts: [],
    writes: 'renames',
    feature: 'Hunter’s Prey',
    asked: true,
    options: [
      { label: 'Colossus Slayer', name: 'Hunter’s Prey: Colossus Slayer (Ranger 3)' },
      { label: 'Horde Breaker', name: 'Hunter’s Prey: Horde Breaker (Ranger 3)' },
    ],
  },
  {
    id: 'eldritchInvocations',
    title: 'Eldritch Invocations',
    class: 'Warlock',
    level: 1,
    counts: [],
    writes: 'adds',
    asked: true,
    options: [
      {
        label: 'Agonizing Blast (Eldritch Blast)',
        name: 'Agonizing Blast (Eldritch Blast)',
        group: 'Agonizing Blast',
        repeatable: true,
      },
      {
        label: 'Agonizing Blast (Chill Touch)',
        name: 'Agonizing Blast (Chill Touch)',
        group: 'Agonizing Blast',
        repeatable: true,
      },
      { label: 'Devil’s Sight', name: 'Devil’s Sight', group: 'Devil’s Sight' },
    ],
  },
  {
    id: 'draconicAncestry',
    title: 'Draconic Ancestry',
    species: 'Dragonborn',
    level: 1,
    counts: [],
    writes: 'race',
    asked: true,
    options: [
      { label: 'Red', name: 'Dragonborn (Red)' },
      { label: 'Blue', name: 'Dragonborn (Blue)' },
    ],
  },
];

describe('optionsOfFeature', () => {
  it('offers the options of a feature as its class names it, and of one already set', () => {
    expect(optionsOfFeature('Blessed Strikes (Cleric 7)', choices)).toMatchObject({
      choice: { id: 'blessedStrikes' },
      current: null,
    });
    expect(
      optionsOfFeature('Blessed Strikes: Divine Strike (Cleric 7)', choices)?.current?.label
    ).toBe('Divine Strike');
    // Typed by hand, with the other apostrophe.
    expect(optionsOfFeature("Hunter's Prey", choices)?.choice.id).toBe('huntersPrey');
    expect(optionsOfFeature("Hunter's Prey (Colossus Slayer)", choices)?.current).toBeNull();
  });

  it('offers the cantrips of an invocation written several ways, and nothing for one written one way', () => {
    const blast = optionsOfFeature('Agonizing Blast (Eldritch Blast)', choices);
    expect(blast?.options.map((option) => option.label)).toEqual([
      'Agonizing Blast (Eldritch Blast)',
      'Agonizing Blast (Chill Touch)',
    ]);
    expect(blast?.current?.label).toBe('Agonizing Blast (Eldritch Blast)');
    expect(optionsOfFeature('Agonizing Blast', choices)?.current).toBeNull();
    expect(optionsOfFeature('Devil’s Sight', choices)).toBeNull();
  });

  it('offers nothing for another feature, an empty name, or the species', () => {
    expect(optionsOfFeature('Second Wind (Fighter 1)', choices)).toBeNull();
    expect(optionsOfFeature('', choices)).toBeNull();
    expect(optionsOfFeature('Dragonborn (Red)', choices)).toBeNull();
  });
});
