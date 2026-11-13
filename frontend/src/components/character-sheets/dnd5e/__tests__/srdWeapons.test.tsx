/**
 * Adding a weapon of the reference document to a D&D 5e sheet: the attack is
 * filled in from the sheet's Strength, Dexterity, Proficiency Bonus and
 * weapon proficiencies.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DnD5eCharacterEditor } from '../DnD5eCharacterEditor';
import { dnd5eCharacter } from './dnd5eFixture';

vi.mock('@/hooks/queries', () => ({
  useServerConfigQuery: () => ({ data: undefined }),
}));

const stats = (str: number, dex: number) => ({
  strength: { score: 10 + 2 * str, modifier: str },
  dexterity: { score: 10 + 2 * dex, modifier: dex },
  constitution: { score: 10, modifier: 0 },
  intelligence: { score: 10, modifier: 0 },
  wisdom: { score: 10, modifier: 0 },
  charisma: { score: 10, modifier: 0 },
});

function open(overrides: Record<string, unknown>) {
  render(<DnD5eCharacterEditor character={dnd5eCharacter(overrides)} onSave={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Combat/ }));
}
const pick = (name: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Add a weapon from the SRD' }), { target: { value: name } });

describe('adding an SRD weapon', () => {
  it('fills in a weapon the character is proficient with', () => {
    open({ stats: stats(3, 1), proficiencyBonus: 2, attacks: [], proficiencies: { armor: '', weapons: 'Simple and Martial weapons', tools: '', languages: '' } });

    pick('Longsword');

    expect(screen.getByRole('textbox', { name: 'Name of attack 1' })).toHaveValue('Longsword');
    expect(screen.getByLabelText('Attack Bonus')).toHaveValue(5);
    expect(screen.getByLabelText('Damage Roll')).toHaveValue('1d8+3');
    expect(screen.getByLabelText('Damage Type')).toHaveValue('slashing');
  });

  it('adds no Proficiency Bonus for a weapon the character is not proficient with', () => {
    open({ stats: stats(3, 4), proficiencyBonus: 2, attacks: [], proficiencies: { armor: '', weapons: 'Simple weapons', tools: '', languages: '' } });

    pick('Rapier');

    expect(screen.getByLabelText('Attack Bonus')).toHaveValue(4);
    expect(screen.getByLabelText('Damage Roll')).toHaveValue('1d8+4');
  });
});
