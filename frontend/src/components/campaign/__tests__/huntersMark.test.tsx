import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AttackMenu from '../AttackMenu';
import type socketService from '@/services/socket';

const greataxe = {
  index: 0,
  name: 'Greataxe',
  cost: 'action' as const,
  attack: { kind: 'melee' as const, bonus: 5, reachFeet: 5, damage: '1d12+3 slashing' },
  spell: null,
  save: null,
};

function renderMenu(concentrationSpells: string[]) {
  const socket = {
    listCombatActions: vi
      .fn()
      .mockResolvedValue({ ok: true, actions: [greataxe], concentrationSpells }),
    resolveAttack: vi.fn().mockResolvedValue({ ok: true, summary: 'hit', hit: true }),
    resolveSave: vi.fn(),
    concentrate: vi
      .fn()
      .mockResolvedValue({ ok: true, summary: 'Hero concentrates on Hunter’s Mark, marking Ogre' }),
  };
  render(
    <AttackMenu
      socket={socket as unknown as typeof socketService}
      attacker={{ id: 'hero', name: 'Hero' }}
      target={{ id: 'ogre', name: 'Ogre' }}
      situation={null}
      style={{}}
      caughtBy={() => []}
      onAim={() => {}}
      onResolved={vi.fn()}
      onClose={() => {}}
    />
  );
  return socket;
}

describe("AttackMenu Hunter's Mark", () => {
  it('marks the target with it', async () => {
    const socket = renderMenu(['Hunter’s Mark']);
    fireEvent.click(await screen.findByRole('button', { name: 'Hunter’s Mark' }));
    await waitFor(() =>
      expect(socket.concentrate).toHaveBeenCalledWith('hero', {
        spell: 'Hunter’s Mark',
        targetId: 'ogre',
      })
    );
  });

  it('is not offered without it', async () => {
    renderMenu(['Bless']);
    await screen.findByText('Greataxe');
    expect(screen.queryByRole('button', { name: 'Hunter’s Mark' })).toBeNull();
  });
});
