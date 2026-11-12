/**
 * The rules of play, looked up at the table: fetched once when the panel is
 * first opened, gone through by heading, and searched as the table types.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DndRulesReference } from '@/types';
import RulesReference from '../RulesReference';

const getDndRulesReference = vi.fn();
vi.mock('@/services/api', () => ({
  default: { getDndRulesReference: (...args: unknown[]) => getDndRulesReference(...args) },
}));

const RULES: DndRulesReference = {
  source: 'System Reference Document 5.2.1',
  license: 'CC-BY-4.0',
  sections: [
    {
      id: 'combat',
      chapter: 'Playing the Game',
      title: 'Combat',
      level: 2,
      path: ['Playing the Game', 'Combat'],
      blocks: [{ type: 'paragraph', text: 'A clash between two sides.' }],
    },
    {
      id: 'cover',
      chapter: 'Playing the Game',
      title: 'Cover',
      level: 3,
      path: ['Playing the Game', 'Combat', 'Cover'],
      blocks: [
        { type: 'paragraph', text: 'Walls can provide cover.' },
        {
          type: 'table',
          title: 'Cover',
          head: [['Degree', 'Benefit']],
          rows: [['Half', '+2 bonus to AC']],
        },
      ],
    },
    {
      id: 'dodge',
      chapter: 'Rules Glossary',
      title: 'Dodge [Action]',
      level: 4,
      path: ['Rules Glossary', 'Rules Definitions', 'Dodge [Action]'],
      blocks: [{ type: 'paragraph', text: 'Attack rolls against you have Disadvantage.' }],
    },
  ],
};

beforeEach(() => {
  getDndRulesReference.mockReset().mockResolvedValue(RULES);
});

describe('RulesReference', () => {
  it('fetches nothing until it is opened, and then once', async () => {
    const { rerender } = render(
      <RulesReference campaignId="c1" isOpen={false} onClose={() => {}} />
    );
    expect(getDndRulesReference).not.toHaveBeenCalled();
    rerender(<RulesReference campaignId="c1" isOpen onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Combat' })).toBeInTheDocument();
    rerender(<RulesReference campaignId="c1" isOpen={false} onClose={() => {}} />);
    rerender(<RulesReference campaignId="c1" isOpen onClose={() => {}} />);
    expect(getDndRulesReference).toHaveBeenCalledTimes(1);
    expect(getDndRulesReference).toHaveBeenCalledWith('c1');
  });

  it('opens a heading with what is set under it', async () => {
    render(<RulesReference campaignId="c1" isOpen onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Combat' }));
    expect(screen.getByRole('heading', { name: 'Combat' })).toBeInTheDocument();
    expect(screen.getByText('A clash between two sides.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cover' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Cover' });
    expect(within(table).getByRole('columnheader', { name: 'Benefit' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '+2 bonus to AC' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back to the headings' }));
    expect(screen.getByRole('button', { name: 'Dodge [Action]' })).toBeInTheDocument();
  });

  it('finds a rule by a word, and says where the word is', async () => {
    render(<RulesReference campaignId="c1" isOpen onClose={() => {}} />);
    await screen.findByRole('button', { name: 'Combat' });
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Search the rules' }),
      'disadvantage'
    );
    expect(screen.getByRole('status')).toHaveTextContent('1 rule found');
    const found = screen.getByRole('button', { name: /Dodge \[Action\]/ });
    expect(found).toHaveTextContent('Attack rolls against you have Disadvantage.');
    await userEvent.click(found);
    expect(screen.getByRole('heading', { name: 'Dodge [Action]' })).toBeInTheDocument();

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search the rules' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the rules' }), 'grapple');
    expect(screen.getByRole('status')).toHaveTextContent('No rule has those words.');
  });

  it('credits the document', async () => {
    render(<RulesReference campaignId="c1" isOpen onClose={() => {}} />);
    expect(screen.getByRole('link', { name: 'System Reference Document 5.2.1' })).toHaveAttribute(
      'href',
      'https://www.dndbeyond.com/srd'
    );
    expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toBeInTheDocument();
  });

  it('says when the rules cannot be read', async () => {
    getDndRulesReference.mockRejectedValue(new Error('offline'));
    render(<RulesReference campaignId="c1" isOpen onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
