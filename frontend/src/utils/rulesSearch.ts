// ============================================
// Looking a rule up in the rules of play
//
// The server sends the whole text once (GET …/rules/dnd/reference); finding
// a rule in it is done here, as the table types.
// ============================================

import type { DndRuleBlock, DndRuleSection } from '@/types';

export interface RuleMatch {
  section: DndRuleSection;
  /** The sentence the words were found in, when they are not in the heading. */
  excerpt: string | null;
}

function blockText(block: DndRuleBlock): string[] {
  if (block.type === 'paragraph') return [block.text];
  if (block.type === 'sidebar') return [block.title, ...block.paragraphs];
  return [
    block.title ?? '',
    ...block.head.map((row) => row.join(' ')),
    ...block.rows.map((row) => row.join(' ')),
  ];
}

/** Everything written under a heading, piece by piece. */
export function ruleText(section: DndRuleSection): string[] {
  return section.blocks.flatMap(blockText).filter((text) => text !== '');
}

const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

function excerptOf(text: string, word: string): string {
  const at = text.toLowerCase().indexOf(word);
  const before = text.lastIndexOf('. ', at);
  const start = before === -1 ? 0 : before + 2;
  const end = text.indexOf('. ', at);
  const sentence = text.slice(start, end === -1 ? text.length : end + 1);
  return sentence.length > 220 ? `${sentence.slice(0, 217).trimEnd()}…` : sentence;
}

/**
 * The headings a search finds, best first: the heading is the words, then
 * starts with them, then holds them, then only the text under it does. Every
 * word has to be found. Within a rank the document's order stands.
 */
export function searchRules(sections: DndRuleSection[], query: string, limit = 40): RuleMatch[] {
  const wanted = words(query);
  if (wanted.length === 0) return [];
  const phrase = wanted.join(' ');
  const found: Array<RuleMatch & { rank: number }> = [];
  for (const section of sections) {
    const title = section.title.toLowerCase();
    // "Dodge [Action]" is found as "dodge".
    const name = title.replace(/\s*\[.*\]$/, '');
    const pieces = ruleText(section);
    const body = pieces.join('\n').toLowerCase();
    if (!wanted.every((word) => title.includes(word) || body.includes(word))) continue;
    let rank = 3;
    if (name === phrase || title === phrase) rank = 0;
    else if (title.startsWith(phrase)) rank = 1;
    else if (wanted.every((word) => title.includes(word))) rank = 2;
    let excerpt: string | null = null;
    if (rank === 3) {
      const word = wanted.find((entry) => !title.includes(entry)) ?? wanted[0];
      const piece =
        pieces.find((text) => text.toLowerCase().includes(phrase)) ??
        pieces.find((text) => text.toLowerCase().includes(word));
      excerpt = piece
        ? excerptOf(piece, piece.toLowerCase().includes(phrase) ? phrase : word)
        : null;
    }
    found.push({ section, excerpt, rank });
  }
  return found
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ section, excerpt }) => ({ section, excerpt }));
}

/** A heading with the headings set under it, as the document runs on. */
export function withSubsections(sections: DndRuleSection[], id: string): DndRuleSection[] {
  const at = sections.findIndex((section) => section.id === id);
  if (at === -1) return [];
  const out = [sections[at]];
  for (const section of sections.slice(at + 1)) {
    if (section.level <= sections[at].level) break;
    out.push(section);
  }
  return out;
}
