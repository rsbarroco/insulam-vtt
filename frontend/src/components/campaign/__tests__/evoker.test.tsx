import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AttackMenu from '../AttackMenu';
import type socketService from '@/services/socket';

const fireball = {
  index: 0,
  name: 'Fireball',
  cost: 'action' as const,
  attack: null,
  spell: { level: 3, slotLevels: [3, 6] },
  save: {
    ability: 'dex' as const,
    dc: 15,
    halfOnSuccess: true,
    damage: '8d6 fire',
    rangeFeet: 150,
    area: { shape: 'sphere' as const, sizeFeet: 20 },
  },
  sculpt: true,
  overchannel: true,
};
const missile = {
  index: 1,
  name: 'Magic Missile',
  cost: 'action' as const,
  attack: null,
  spell: { level: 1, slotLevels: [1, 3] },
  save: null,
  darts: { count: 3, damage: '1d4+1 force', rangeFeet: 120 },
  overchannel: true,
};

function renderMenu(resources: Array<{ name: string; max: number; used: number }> = []) {
  const socket = {
    listCombatActions: vi
      .fn()
      .mockResolvedValue({ ok: true, actions: [fireball, missile], resources }),
    resolveAttack: vi.fn(),
    resolveSave: vi.fn().mockResolvedValue({ ok: true, summary: 'done', targets: [] }),
  };
  render(
    <AttackMenu
      socket={socket as unknown as typeof socketService}
      attacker={{ id: 'hero', name: 'Hero' }}
      target={{ id: 'ogre', name: 'Ogre' }}
      situation={null}
      style={{}}
      caughtBy={() => [
        { id: 'hero', name: 'Hero' },
        { id: 'ogre', name: 'Ogre' },
        { id: 'ally', name: 'Ally' },
      ]}
      onAim={() => {}}
      onResolved={vi.fn()}
      onClose={() => {}}
    />
  );
  return socket;
}

describe('AttackMenu for an Evoker', () => {
  it('sends the creatures Sculpt Spells spares, never the caster', async () => {
    const socket = renderMenu();
    fireEvent.click(await screen.findByLabelText('Fireball: Sculpt Spells spares Ally'));
    expect(screen.queryByLabelText('Fireball: Sculpt Spells spares Hero')).toBeNull();
    fireEvent.click(screen.getByLabelText('Cast Fireball with a level 3 slot'));
    await waitFor(() =>
      expect(socket.resolveSave).toHaveBeenCalledWith({
        sourceId: 'hero',
        targetIds: ['hero', 'ogre', 'ally'],
        action: 0,
        slotLevel: 3,
        sculpt: { targetIds: ['ally'] },
      })
    );
  });

  it('sends Overchannel with a slot of level 5 or lower only', async () => {
    const socket = renderMenu([{ name: 'Overchannel', max: 20, used: 1 }]);
    fireEvent.click(await screen.findByLabelText(/^Overchannel/));
    expect(screen.getByText('(2d12 Necrotic a slot level to you)')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Cast Fireball with a level 6 slot'));
    await waitFor(() => expect(socket.resolveSave).toHaveBeenCalledTimes(1));
    expect(socket.resolveSave.mock.calls[0][0]).not.toHaveProperty('overchannel');
    fireEvent.click(screen.getByLabelText('Cast Fireball with a level 3 slot'));
    await waitFor(() => expect(socket.resolveSave).toHaveBeenCalledTimes(2));
    expect(socket.resolveSave.mock.calls[1][0]).toMatchObject({ slotLevel: 3, overchannel: true });
  });

  it('casts Magic Missile with every dart at the target, one more a slot level', async () => {
    const socket = renderMenu();
    expect(await screen.findByText(/3 darts, 1d4\+1 force each/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Cast Magic Missile with a level 3 slot'));
    await waitFor(() =>
      expect(socket.resolveSave).toHaveBeenCalledWith({
        sourceId: 'hero',
        targetIds: ['ogre'],
        action: 1,
        slotLevel: 3,
        darts: [5],
      })
    );
  });
});
