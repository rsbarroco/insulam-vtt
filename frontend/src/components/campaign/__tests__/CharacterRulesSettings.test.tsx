/**
 * The Characters tab of Campaign Settings: gestalt and the house rules as
 * switches, on by default, saved together.
 */

import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CharacterRulesSettings from '../CharacterRulesSettings';
import { DEFAULT_CHARACTER_RULES } from '@/utils/characterRules';

const names = [
  'Gestalt characters',
  'Ability scores up to 22',
  'A feat and +2 every fourth level',
  'Background ability scores go anywhere',
  'Any origin feat',
];

it('shows every switch on for a campaign that has stored nothing', () => {
  render(<CharacterRulesSettings stored={null} onSave={vi.fn()} />);
  for (const name of names) {
    expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true');
  }
});

it('shows what the campaign stored', () => {
  render(<CharacterRulesSettings stored={{ gestalt: false }} onSave={vi.fn()} />);
  expect(screen.getByRole('switch', { name: 'Gestalt characters' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('switch', { name: 'Any origin feat' })).toHaveAttribute('aria-checked', 'true');
});

it('saves all the switches as they stand', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<CharacterRulesSettings stored={null} onSave={onSave} />);
  await userEvent.click(screen.getByRole('switch', { name: 'Ability scores up to 22' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_CHARACTER_RULES, abilityScoreCap22: false });
});

it('follows the campaign when it is saved elsewhere', () => {
  const { rerender } = render(<CharacterRulesSettings stored={null} onSave={vi.fn()} />);
  rerender(<CharacterRulesSettings stored={{ freeOriginFeat: false }} onSave={vi.fn()} />);
  expect(screen.getByRole('switch', { name: 'Any origin feat' })).toHaveAttribute('aria-checked', 'false');
});
