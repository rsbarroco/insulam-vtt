// ============================================
// The rules of play, from the System Reference Document 5.2.1
//
// `data/srd-5.2.1-rules.json` holds the document's "Playing the Game" chapter
// and its "Rules Glossary", built by `scripts/srd-rules.py`: every heading
// with the paragraphs, tables and sidebars under it, in the document's own
// words. The SRD is published by Wizards of the Coast under CC-BY-4.0; see
// SRD_ATTRIBUTION.md.
//
// This is the text the table looks a rule up in. The rules the VTT applies
// itself (d20.ts, conditions.ts, resolveAttack.ts and the rest) are written
// from the same text, and a rule's `id` here is how they point back to it.
// ============================================

import document from './data/srd-5.2.1-rules.json';

export type RuleBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'table'; title?: string; head: string[][]; rows: string[][] }
  | { type: 'sidebar'; title: string; paragraphs: string[] };

export interface RuleSection {
  /** "rules-glossary-opportunity-attacks". */
  id: string;
  chapter: string;
  /** As the document heads it: "Dodge [Action]", "Prone [Condition]". */
  title: string;
  /** 1 for a chapter, down to 4 for a glossary entry. */
  level: number;
  /** The headings it sits under, ending in its own. */
  path: string[];
  blocks: RuleBlock[];
}

const SECTIONS = document.sections as RuleSection[];
const BY_ID = new Map(SECTIONS.map((section) => [section.id, section]));

export const RULES_SOURCE = document.source;

/** Every section, in the document's order. */
export function allRules(): RuleSection[] {
  return SECTIONS;
}

export function findRule(id: string): RuleSection | undefined {
  return BY_ID.get(id);
}
