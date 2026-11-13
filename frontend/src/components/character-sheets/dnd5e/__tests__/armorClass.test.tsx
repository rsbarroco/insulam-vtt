/**
 * Working out a D&D 5e sheet's Armor Class from its equipped armor and
 * Shield, its Dexterity, Unarmored Defense and the Defense fighting style.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DnD5eCharacterEditor } from '../DnD5eCharacterEditor';
import { dnd5eCharacter } from './dnd5eFixture';

vi.mock('@/hooks/queries', () => ({
  useServerConfigQuery: () => ({ data: undefined }),
}));

const stats = (dex: number, con: number) => ({
  strength: { score: 10, modifier: 0 },
  dexterity: { score: 10 + 2 * dex, modifier: dex },
  constitution: { score: 10 + 2 * con, modifier: con },
  intelligence: { score: 10, modifier: 0 },
  wisdom: { score: 10, modifier: 0 },
  charisma: { score: 10, modifier: 0 },
});

function open(overrides: Record<string, unknown>) {
  render(
    <DnD5eCharacterEditor
      character={dnd5eCharacter(overrides)}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /Combat/ }));
  fireEvent.click(screen.getByRole('button', { name: 'From equipment' }));
}

describe('Armor Class from equipment', () => {
  it('reads the equipped armor and Shield, with Defense', () => {
    open({
      stats: stats(2, 0),
      class: 'Fighter',
      armorClass: 10,
      featuresAndTraits: [{ name: 'Fighting Style: Defense', description: '' }],
      inventory: [
        { name: 'Chain Mail', equipped: true },
        { name: 'Shield', equipped: true },
        { name: 'Leather Armor', equipped: false },
      ],
    });
    expect(screen.getByLabelText('Armor Class')).toHaveValue(19);
    expect(screen.getByText('Chain Mail 16 + Defense 1 + Shield 2')).toBeInTheDocument();
  });

  it('gives a Barbarian without armor Unarmored Defense', () => {
    open({ stats: stats(2, 3), class: 'Barbarian', armorClass: 10, inventory: [] });
    expect(screen.getByLabelText('Armor Class')).toHaveValue(15);
  });
});
