// ============================================
// Rules of play — the rules, to look one up at the table
//
// The "Playing the Game" chapter and the "Rules Glossary" of the SRD 5.2.1,
// in the document's own words. Every member reads it: type a word to find a
// rule, or go through the headings. The text is fetched once per campaign.
// ============================================

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Scale, Search } from 'lucide-react';
import SlideOver, { SlideOverClose, SlideOverTitle } from '@/components/ui/SlideOver';
import apiService from '@/services/api';
import { apiErrorMessage } from '@/utils/errors';
import { searchRules, withSubsections } from '@/utils/rulesSearch';
import { cn } from '@/utils/cn';
import type { DndRuleBlock, DndRuleSection, DndRulesReference } from '@/types';

interface RulesReferenceProps {
  campaignId: string;
  isOpen: boolean;
  onClose: () => void;
}

/** "Opening. Text" reads with its run-in title in bold, as the document sets it. */
function Paragraph({ text }: { text: string }) {
  const lead = /^((?:\d: )?(?:[A-Z“][^.:]{0,60}?)[.:]”?) (?=[A-Z“])/.exec(text);
  const titled =
    lead !== null &&
    lead[1].split(' ').length <= 8 &&
    /^(\d: )?[A-Z“]/.test(lead[1]) &&
    isTitle(lead[1]);
  if (text.startsWith('• ')) return <li className="ml-5 list-disc">{text.slice(2)}</li>;
  return (
    <p>
      {titled ? (
        <>
          <strong className="font-semibold italic">{lead[1]}</strong> {text.slice(lead[0].length)}
        </>
      ) : (
        text
      )}
    </p>
  );
}

/** A run-in title has its words capitalised: "Only One at a Time." */
function isTitle(lead: string): boolean {
  const small = new Set([
    'a',
    'an',
    'and',
    'at',
    'by',
    'for',
    'in',
    'of',
    'on',
    'or',
    'the',
    'to',
    'vs',
    'with',
    'from',
    'into',
    'as',
    'if',
    'is',
  ]);
  const wordsOf = lead
    .replace(/^\d: /, '')
    .replace(/[.:”“]/g, '')
    .split(/[\s/-]+/)
    .filter(Boolean);
  return wordsOf.every((word) => small.has(word) || /^[A-Z0-9(]/.test(word));
}

function Block({ block }: { block: DndRuleBlock }) {
  if (block.type === 'paragraph') return <Paragraph text={block.text} />;
  if (block.type === 'sidebar') {
    return (
      <aside className="rounded-lg border border-moss-green/20 bg-parchment/60 px-3 py-2 space-y-1.5">
        <h4 className="text-xs font-bold uppercase tracking-wide text-brand-ink">{block.title}</h4>
        {block.paragraphs.map((text, index) => (
          <Paragraph key={index} text={text} />
        ))}
      </aside>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs border-collapse">
        {block.title && (
          <caption className="text-left font-bold text-brand-ink pb-1">{block.title}</caption>
        )}
        {block.head.length > 0 && (
          <thead>
            {block.head.map((row, index) => (
              <tr key={index} className="border-b border-moss-green/30">
                {row.map((cell, at) => (
                  <th key={at} scope="col" className="py-1 pr-3 font-semibold align-bottom">
                    {cell}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
        )}
        <tbody>
          {block.rows.map((row, index) => (
            <tr key={index} className="border-b border-moss-green/10 align-top">
              {row.map((cell, at) => (
                <td key={at} className="py-1 pr-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ section, top }: { section: DndRuleSection; top: boolean }) {
  const Heading = top ? 'h3' : 'h4';
  return (
    <section className="space-y-2">
      <Heading className={cn('font-bold text-brand-ink', top ? 'text-lg' : 'text-sm pt-2')}>
        {section.title}
      </Heading>
      {section.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </section>
  );
}

export default function RulesReference({ campaignId, isOpen, onClose }: RulesReferenceProps) {
  const [rules, setRules] = useState<DndRulesReference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || rules) return;
    let cancelled = false;
    apiService
      .getDndRulesReference(campaignId)
      .then((loaded) => !cancelled && setRules(loaded))
      .catch(
        (err) => !cancelled && setError(apiErrorMessage(err) || 'The rules could not be loaded')
      );
    return () => {
      cancelled = true;
    };
  }, [isOpen, rules, campaignId]);

  const sections = useMemo(() => rules?.sections ?? [], [rules]);
  const matches = useMemo(() => searchRules(sections, query), [sections, query]);
  const reading = useMemo(
    () => (openId ? withSubsections(sections, openId) : []),
    [sections, openId]
  );
  const searching = query.trim() !== '';

  return (
    <SlideOver
      open={isOpen}
      onClose={onClose}
      side="right"
      backdropClassName="bg-black/40"
      className="max-w-lg bg-paper-white shadow-2xl flex flex-col"
    >
      <div className="flex items-center gap-3 px-5 py-4 border-b border-moss-green/20 bg-parchment/60">
        <Scale className="w-5 h-5 text-brand-ink shrink-0" />
        <SlideOverTitle className="flex-1 text-base font-bold text-brand-ink">
          Rules of play
        </SlideOverTitle>
        <SlideOverClose
          className="btn-secondary p-1.5 shrink-0"
          iconClassName="w-4 h-4"
          title="Close"
        />
      </div>

      <div className="px-4 py-3 border-b border-moss-green/10">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-gray/50" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpenId(null);
            }}
            placeholder="Search the rules…"
            aria-label="Search the rules"
            className="input-cozy w-full pl-8 text-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 text-sm text-ink space-y-3">
        {error && (
          <p role="alert" className="text-danger-ink">
            {error}
          </p>
        )}
        {!rules && !error && <p className="text-stone-gray">Loading the rules…</p>}

        {rules && openId && (
          <>
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {searching ? 'Back to the results' : 'Back to the headings'}
            </button>
            {reading[0] && reading[0].path.length > 1 && (
              <p className="text-xs text-stone-gray">{reading[0].path.slice(0, -1).join(' › ')}</p>
            )}
            {reading.map((section, index) => (
              <Section key={section.id} section={section} top={index === 0} />
            ))}
          </>
        )}

        {rules && !openId && searching && (
          <>
            <p className="text-xs text-stone-gray" role="status">
              {matches.length === 0
                ? 'No rule has those words.'
                : `${matches.length} rule${matches.length === 1 ? '' : 's'} found`}
            </p>
            <ul className="space-y-1">
              {matches.map(({ section, excerpt }) => (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(section.id)}
                    className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-parchment/70"
                  >
                    <span className="font-semibold text-brand-ink">{section.title}</span>
                    <span className="block text-xs text-stone-gray">
                      {section.path.slice(0, -1).join(' › ')}
                    </span>
                    {excerpt && <span className="block text-xs text-ink/80 mt-0.5">{excerpt}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {rules && !openId && !searching && (
          <nav aria-label="Rules headings">
            <ul className="space-y-0.5">
              {sections
                .filter((section) => section.level <= 3 || section.chapter === 'Rules Glossary')
                .map((section) => (
                  <li
                    key={section.id}
                    style={{ paddingLeft: `${(Math.min(section.level, 4) - 1) * 12}px` }}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenId(section.id)}
                      className={cn(
                        'text-left hover:underline',
                        section.level <= 2 ? 'font-bold text-brand-ink pt-1.5' : 'text-ink'
                      )}
                    >
                      {section.title}
                    </button>
                  </li>
                ))}
            </ul>
          </nav>
        )}
      </div>

      <p className="px-5 py-2 border-t border-moss-green/10 text-[11px] text-stone-gray">
        From the{' '}
        <a
          href="https://www.dndbeyond.com/srd"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-brand-ink"
        >
          System Reference Document 5.2.1
        </a>{' '}
        by Wizards of the Coast LLC, licensed under{' '}
        <a
          href="https://creativecommons.org/licenses/by/4.0/legalcode"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-brand-ink"
        >
          CC BY 4.0
        </a>
        .
      </p>
    </SlideOver>
  );
}
