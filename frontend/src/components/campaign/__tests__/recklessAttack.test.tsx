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

function renderMenu(reckless: boolean) {
  const socket = {
    listCombatActions: vi.fn().mockResolvedValue({ ok: true, actions: [greataxe], reckless }),
    resolveAttack: vi.fn().mockResolvedValue({ ok: true, summary: 'hit', hit: true }),
    resolveSave: vi.fn(),
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

describe('AttackMenu Reckless Attack', () => {
  it('attacks recklessly when the Barbarian ticks it', async () => {
    const socket = renderMenu(true);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Attack recklessly' }));
    fireEvent.click(screen.getByText('Greataxe'));
    await waitFor(() =>
      expect(socket.resolveAttack).toHaveBeenCalledWith({
        attackerId: 'hero',
        targetId: 'ogre',
        action: 0,
        reckless: true,
      })
    );
  });

  it('is not offered to a creature without the feature', async () => {
    renderMenu(false);
    await screen.findByText('Greataxe');
    expect(screen.queryByRole('checkbox', { name: 'Attack recklessly' })).toBeNull();
  });
});
