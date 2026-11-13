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

  it('shows a spent Recharge and does not make it', async () => {
    const socket = {
      listCombatActions: vi.fn().mockResolvedValue({
        ok: true,
        actions: [
          {
            index: 0,
            name: 'Fire Breath (Recharge 5–6)',
            cost: 'action',
            attack: null,
            spell: null,
            save: { ability: 'dex', dc: 13, halfOnSuccess: true, damage: '6d6 fire' },
            recharge: { min: 5, ready: false },
          },
        ],
      }),
      resolveAttack: vi.fn(),
      resolveSave: vi.fn(),
      help: vi.fn(),
      ready: vi.fn(),
    };
    render(
      <AttackMenu
        socket={socket as unknown as typeof socketService}
        attacker={{ id: 'drake', name: 'Drake' }}
        target={{ id: 'hero', name: 'Hero' }}
        situation={null}
        style={{}}
        caughtBy={() => []}
        onAim={() => {}}
        onResolved={() => {}}
        onClose={() => {}}
      />
    );
    expect(await screen.findByText(/not recharged/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fire Breath/ })).toBeDisabled();
  });

  it('makes a Multiattack one attack after another against the target', async () => {
    const claw = {
      index: 1,
      name: 'Claw',
      cost: 'action' as const,
      attack: { kind: 'melee' as const, bonus: 5, damage: '1d6+3' },
      spell: null,
      save: null,
    };
    const bite = {
      index: 2,
      name: 'Bite',
      cost: 'action' as const,
      attack: { kind: 'melee' as const, bonus: 5, damage: '1d8+3' },
      spell: null,
      save: null,
    };
    const socket = {
      listCombatActions: vi.fn().mockResolvedValue({
        ok: true,
        actions: [
          {
            index: 0,
            name: 'Multiattack',
            cost: 'action',
            attack: null,
            spell: null,
            save: null,
            multiattack: [
              { count: 2, choices: [1] },
              { count: 1, choices: [2] },
            ],
          },
          claw,
          bite,
        ],
      }),
      resolveAttack: vi.fn().mockResolvedValue({ ok: true, summary: 'hit', hit: true }),
      resolveSave: vi.fn(),
      help: vi.fn(),
      ready: vi.fn(),
    };
    const onResolved = vi.fn();
    render(
      <AttackMenu
        socket={socket as unknown as typeof socketService}
        attacker={{ id: 'wolf', name: 'Wolf' }}
        target={{ id: 'hero', name: 'Hero' }}
        situation={null}
        style={{}}
        caughtBy={() => []}
        onAim={() => {}}
        onResolved={onResolved}
        onClose={() => {}}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Make them all' }));
    await waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith({
        ok: true,
        summary: 'hit · hit · hit',
        landed: true,
      })
    );
    expect(socket.resolveAttack.mock.calls.map(([call]) => call.action)).toEqual([1, 1, 2]);
  });

  it('makes a Legendary Action’s attack as that action, and shows its uses', async () => {
    const tentacle = {
      index: 0,
      name: 'Tentacle',
      cost: 'action' as const,
      attack: { kind: 'melee' as const, bonus: 9, damage: '2d6+5' },
      spell: null,
      save: null,
    };
    const socket = {
      listCombatActions: vi.fn().mockResolvedValue({
        ok: true,
        actions: [
          tentacle,
          {
            index: 1,
            name: 'Lash',
            cost: 'legendary',
            attack: null,
            spell: null,
            save: null,
            multiattack: [{ count: 1, choices: [0] }],
            legendary: { max: 3, used: 1 },
          },
        ],
      }),
      resolveAttack: vi.fn().mockResolvedValue({ ok: true, summary: 'hit', hit: true }),
      resolveSave: vi.fn(),
      help: vi.fn(),
      ready: vi.fn(),
    };
    render(
      <AttackMenu
        socket={socket as unknown as typeof socketService}
        attacker={{ id: 'aboleth', name: 'Aboleth' }}
        target={{ id: 'hero', name: 'Hero' }}
        situation={null}
        style={{}}
        caughtBy={() => []}
        onAim={() => {}}
        onResolved={() => {}}
        onClose={() => {}}
      />
    );
    expect(await screen.findByText(/Legendary, 2\/3 left/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Make them all' }));
    await waitFor(() =>
      expect(socket.resolveAttack).toHaveBeenCalledWith({
        attackerId: 'aboleth',
        targetId: 'hero',
        action: 0,
        legendary: 1,
      })
    );
  });

  it('casts a healing spell on the creature with the slot chosen', async () => {
    const socket = {
      listCombatActions: vi.fn().mockResolvedValue({
        ok: true,
        actions: [
          {
            index: 0,
            name: 'Cure Wounds',
            cost: 'action',
            attack: null,
            save: null,
            spell: { level: 1, slotLevels: [1, 2] },
            heal: { dice: '2d8+3', rangeFeet: 5 },
          },
        ],
      }),
      resolveAttack: vi.fn(),
      resolveSave: vi.fn(),
      heal: vi.fn().mockResolvedValue({
        ok: true,
        summary: 'Cure Wounds (level 2): Ally regains 14 Hit Points',
        healed: 14,
      }),
      help: vi.fn(),
      ready: vi.fn(),
    };
    const onResolved = vi.fn();
    render(
      <AttackMenu
        socket={socket as unknown as typeof socketService}
        attacker={{ id: 'cleric', name: 'Cleric' }}
        target={{ id: 'ally', name: 'Ally' }}
        situation={null}
        style={{}}
        caughtBy={() => []}
        onAim={() => {}}
        onResolved={onResolved}
        onClose={() => {}}
      />
    );
    expect(await screen.findByText(/heals 2d8\+3 · touch/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cast Cure Wounds with a level 2 slot' }));
    await waitFor(() =>
      expect(socket.heal).toHaveBeenCalledWith({
        casterId: 'cleric',
        targetId: 'ally',
        action: 0,
        slotLevel: 2,
      })
    );
    expect(onResolved).toHaveBeenCalledWith({
      ok: true,
      summary: 'Cure Wounds (level 2): Ally regains 14 Hit Points',
      landed: true,
    });
  });

  it('aims an area at an empty square, on the creatures it catches', async () => {
    const fireball = {
      index: 0,
      name: 'Fireball',
      cost: 'action',
      attack: null,
      spell: { level: 3, slotLevels: [3] },
      save: {
        ability: 'dex',
        dc: 14,
        halfOnSuccess: true,
        damage: '8d6 fire',
        rangeFeet: 150,
        area: { shape: 'sphere', sizeFeet: 20 },
      },
    };
    const bolt = {
      index: 1,
      name: 'Fire Bolt',
      cost: 'action',
      attack: { kind: 'ranged', bonus: 6, damage: '1d10 fire' },
      spell: { level: 0, slotLevels: [] },
      save: null,
    };
    const socket = {
      listCombatActions: vi.fn().mockResolvedValue({ ok: true, actions: [fireball, bolt] }),
      resolveAttack: vi.fn(),
      resolveSave: vi
        .fn()
        .mockResolvedValue({ ok: true, summary: 'Fireball', targets: [{ saved: false }] }),
      help: vi.fn(),
      ready: vi.fn(),
    };
    render(
      <AttackMenu
        socket={socket as unknown as typeof socketService}
        attacker={{ id: 'mage', name: 'Mage' }}
        target={{ id: '', name: 'the square 6, 2' }}
        point={{ x: 5, y: 1 }}
        situation={null}
        style={{}}
        caughtBy={() => [{ id: 'ogre', name: 'Ogre' }]}
        onAim={() => {}}
        onResolved={() => {}}
        onClose={() => {}}
      />
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cast Fireball with a level 3 slot' })
    );
    await waitFor(() =>
      expect(socket.resolveSave).toHaveBeenCalledWith({
        sourceId: 'mage',
        targetIds: ['ogre'],
        action: 0,
        slotLevel: 3,
        point: { x: 5, y: 1 },
      })
    );
    expect(screen.queryByText('Fire Bolt')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Help against it' })).toBeNull();
  });
});
