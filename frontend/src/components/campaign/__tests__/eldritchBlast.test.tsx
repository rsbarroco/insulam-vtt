import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AttackMenu from '../AttackMenu';
import type socketService from '@/services/socket';

const greataxe = {
  index: 0,
  name: 'Eldritch Blast',
  cost: 'action' as const,
  attack: {
    kind: 'ranged' as const,
    bonus: 6,
    rangeFeet: { normal: 120, long: 120 },
    damage: '1d10+3 force',
  },
  spell: { level: 0, slotLevels: [] },
  save: null,
  beams: 2,
};

function renderMenu() {
  const socket = {
    listCombatActions: vi.fn().mockResolvedValue({ ok: true, actions: [greataxe] }),
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

describe('AttackMenu Eldritch Blast beams', () => {
  it('fires every beam at the target, one attack roll after another', async () => {
    const socket = renderMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'All 2 beams' }));
    await waitFor(() => expect(socket.resolveAttack).toHaveBeenCalledTimes(2));
    expect(socket.resolveAttack).toHaveBeenCalledWith({
      attackerId: 'hero',
      targetId: 'ogre',
      action: 0,
    });
  });
});
