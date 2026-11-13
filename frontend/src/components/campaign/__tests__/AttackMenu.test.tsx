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
  extras: ['cleave' as const],
};

function renderMenu() {
  const socket = {
    listCombatActions: vi.fn().mockResolvedValue({ ok: true, actions: [greataxe] }),
    resolveAttack: vi.fn().mockResolvedValue({ ok: true, summary: 'hit; Cleave', hit: true }),
    resolveSave: vi.fn(),
    help: vi.fn().mockResolvedValue({ ok: true, summary: 'Hero helps against Ogre' }),
    ready: vi.fn().mockResolvedValue({ ok: true, summary: 'Hero readies Greataxe' }),
  };
  const onResolved = vi.fn();
  render(
    <AttackMenu
      socket={socket as unknown as typeof socketService}
      attacker={{ id: 'hero', name: 'Hero' }}
      target={{ id: 'ogre', name: 'Ogre' }}
      situation={null}
      style={{}}
      caughtBy={() => []}
      onAim={() => {}}
      onResolved={onResolved}
      onClose={() => {}}
    />
  );
  return { socket, onResolved };
}

describe('AttackMenu extra attacks', () => {
  it('offers Cleave under a weapon that has it, and sends it as the extra attack', async () => {
    const { socket, onResolved } = renderMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Greataxe: Cleave' }));
    await waitFor(() =>
      expect(socket.resolveAttack).toHaveBeenCalledWith({
        attackerId: 'hero',
        targetId: 'ogre',
        action: 0,
        extra: 'cleave',
      })
    );
    expect(onResolved).toHaveBeenCalledWith({ ok: true, summary: 'hit; Cleave', landed: true });
  });

  it('makes the plain attack without one', async () => {
    const { socket } = renderMenu();
    fireEvent.click(await screen.findByText('Greataxe'));
    await waitFor(() =>
      expect(socket.resolveAttack).toHaveBeenCalledWith({
        attackerId: 'hero',
        targetId: 'ogre',
        action: 0,
      })
    );
  });

  it('takes the Help action against the creature', async () => {
    const { socket, onResolved } = renderMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Help against it' }));
    await waitFor(() => expect(socket.help).toHaveBeenCalledWith('hero', 'ogre'));
    expect(onResolved).toHaveBeenCalledWith({
      ok: true,
      summary: 'Hero helps against Ogre',
      landed: true,
    });
  });

  it('readies an attack for the trigger written', async () => {
    const { socket } = renderMenu();
    fireEvent.change(await screen.findByPlaceholderText('when it comes into reach'), {
      target: { value: 'when it opens the door' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ready Greataxe' }));
    await waitFor(() =>
      expect(socket.ready).toHaveBeenCalledWith('hero', 'ogre', 0, 'when it opens the door')
    );
  });
});
