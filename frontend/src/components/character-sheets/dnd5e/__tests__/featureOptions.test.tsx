/**
 * Setting a feature's option from the sheet editor: a feature with options
 * gets a select beside its name, which writes the name the server reads.
 */

import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Character } from '../../../../types';

vi.mock('@/hooks/queries', () => ({ useServerConfigQuery: () => ({ data: undefined }) }));
const api = vi.hoisted(() => ({ getDndRules: vi.fn() }));
vi.mock('@/services/api', () => ({ api, default: api }));

import { DnD5eCharacterEditor } from '../DnD5eCharacterEditor';

const ability = { score: 10, modifier: 0 };

const character = (campaignId: string | null) =>
  ({
    id: 'char-1',
    userId: 'user-1',
    name: 'Ysolde',
    gameSystem: 'DND_5E',
    campaignId,
    tokenImageUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: {
      characterName: 'Ysolde',
      class: 'Cleric',
      level: 7,
      race: 'Human',
      proficiencyBonus: 3,
      stats: {
        strength: ability,
        dexterity: ability,
        constitution: ability,
        intelligence: ability,
        wisdom: ability,
        charisma: ability,
      },
      featuresAndTraits: [
        { name: 'Blessed Strikes (Cleric 7)', description: 'Divine power.' },
        { name: 'Sear Undead (Cleric 5)', description: '' },
      ],
    },
  }) as unknown as Character;

api.getDndRules.mockResolvedValue({
  featureChoices: [
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
  ],
});

it('offers the options of a feature that has them, and renames it to the one chosen', async () => {
  render(
    <DnD5eCharacterEditor character={character('campaign-1')} onSave={vi.fn()} onCancel={vi.fn()} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Features' }));
  const select = await screen.findByLabelText('Feature 1 option');
  expect(screen.queryByLabelText('Feature 2 option')).not.toBeInTheDocument();
  fireEvent.change(select, { target: { value: 'Blessed Strikes: Divine Strike (Cleric 7)' } });
  expect((screen.getByLabelText('Feature 1 name') as HTMLInputElement).value).toBe(
    'Blessed Strikes: Divine Strike (Cleric 7)'
  );
  expect((screen.getByLabelText('Feature 1 option') as HTMLSelectElement).value).toBe(
    'Blessed Strikes: Divine Strike (Cleric 7)'
  );
  expect((screen.getByLabelText('Feature 1 description') as HTMLTextAreaElement).value).toBe(
    'Divine power.'
  );
});

it('offers nothing for a character in no campaign', () => {
  render(<DnD5eCharacterEditor character={character(null)} onSave={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Features' }));
  expect(screen.queryByLabelText('Feature 1 option')).not.toBeInTheDocument();
  expect(api.getDndRules).not.toHaveBeenCalled();
});
