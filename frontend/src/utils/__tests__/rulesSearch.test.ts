import { describe, it, expect } from 'vitest';
import type { DndRuleSection } from '@/types';
import { ruleText, searchRules, withSubsections } from '../rulesSearch';

const section = (
  id: string,
  title: string,
  level: number,
  ...paragraphs: string[]
): DndRuleSection => ({
  id,
  chapter: 'Rules Glossary',
  title,
  level,
  path: [title],
  blocks: paragraphs.map((text) => ({ type: 'paragraph', text })),
});

const RULES: DndRuleSection[] = [
  section('combat', 'Combat', 2, 'A typical combat encounter is a clash between two sides.'),
  section('cover', 'Cover', 3, 'Walls and trees can provide cover.'),
  section(
    'attacks',
    'Opportunity Attacks',
    3,
    'You can make an Opportunity Attack when a creature leaves your reach.'
  ),
  section('damage', 'Damage and Healing', 2, 'Injury and death are frequent threats.'),
  section(
    'dodge',
    'Dodge [Action]',
    4,
    'Any attack roll made against you has Disadvantage. You lose these benefits if your Speed is 0.'
  ),
  section(
    'disengage',
    'Disengage [Action]',
    4,
    'Your movement doesn’t provoke Opportunity Attacks for the rest of the current turn.'
  ),
  {
    ...section('falling', 'Falling [Hazard]', 4),
    blocks: [
      {
        type: 'table',
        title: 'Falls',
        head: [['Height', 'Damage']],
        rows: [['10 feet', '1d6 Bludgeoning']],
      },
    ],
  },
];

describe('searchRules', () => {
  it('finds nothing for no words', () => {
    expect(searchRules(RULES, '   ')).toEqual([]);
  });

  it('puts the heading that is the words first, tag or not', () => {
    expect(searchRules(RULES, 'dodge')[0]).toEqual({ section: RULES[4], excerpt: null });
  });

  it('puts a heading before the text that only mentions it', () => {
    const found = searchRules(RULES, 'opportunity attacks');
    expect(found.map((match) => match.section.id)).toEqual(['attacks', 'disengage']);
    expect(found[1].excerpt).toBe(
      'Your movement doesn’t provoke Opportunity Attacks for the rest of the current turn.'
    );
  });

  it('wants every word, wherever each is', () => {
    expect(searchRules(RULES, 'dodge speed').map((match) => match.section.id)).toEqual(['dodge']);
    expect(searchRules(RULES, 'dodge healing')).toEqual([]);
  });

  it('shows the sentence the word is in', () => {
    expect(searchRules(RULES, 'speed')[0].excerpt).toBe(
      'You lose these benefits if your Speed is 0.'
    );
  });

  it('reads tables too', () => {
    expect(searchRules(RULES, 'bludgeoning').map((match) => match.section.id)).toEqual(['falling']);
    expect(ruleText(RULES[6])).toEqual(['Falls', 'Height Damage', '10 feet 1d6 Bludgeoning']);
  });
});

describe('withSubsections', () => {
  it('gives a heading with what is set under it', () => {
    expect(withSubsections(RULES, 'combat').map((entry) => entry.id)).toEqual([
      'combat',
      'cover',
      'attacks',
    ]);
    expect(withSubsections(RULES, 'cover').map((entry) => entry.id)).toEqual(['cover']);
    expect(withSubsections(RULES, 'nowhere')).toEqual([]);
  });
});
