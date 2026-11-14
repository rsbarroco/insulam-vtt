import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReactionPrompt from '../ReactionPrompt';
import type { CombatPrompt } from '@/types';

function setup() {
  const handlers: Record<string, (data: unknown) => void> = {};
  const socket = {
    onCombatPrompt: vi.fn((cb: (data: CombatPrompt) => void) => {
      handlers['combat.prompt'] = cb as (data: unknown) => void;
    }),
    onCombatPromptClosed: vi.fn((cb: (data: { promptId: string }) => void) => {
      handlers['combat.promptClosed'] = cb as (data: unknown) => void;
    }),
    react: vi.fn().mockResolvedValue({ ok: true }),
    off: vi.fn(),
  };
  render(<ReactionPrompt socket={socket as never} />);
  const ask = (prompt: Partial<CombatPrompt> = {}) =>
    act(() =>
      handlers['combat.prompt']({
        promptId: 'p1',
        tokenId: 'hero',
        tokenName: 'Hero',
        text: 'Ogre hits Hero with Greatclub for 14 damage.',
        options: ['Uncanny Dodge'],
        expiresInMs: 30000,
        ...prompt,
      })
    );
  const close = (promptId: string) =>
    act(() => handlers['combat.promptClosed']({ promptId, choice: null }));
  return { socket, ask, close };
}

describe('ReactionPrompt', () => {
  it('asks what happened and sends the reaction chosen', async () => {
    const { socket, ask } = setup();
    ask();
    expect(screen.getByText('Ogre hits Hero with Greatclub for 14 damage.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Uncanny Dodge' }));
    await waitFor(() => expect(socket.react).toHaveBeenCalledWith('p1', 'Uncanny Dodge'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('sends none for No reaction', async () => {
    const { socket, ask } = setup();
    ask();
    fireEvent.click(screen.getByRole('button', { name: 'No reaction' }));
    await waitFor(() => expect(socket.react).toHaveBeenCalledWith('p1', null));
  });

  it('goes away when the question is closed elsewhere', () => {
    const { ask, close } = setup();
    ask();
    expect(screen.getByRole('alertdialog', { name: 'Reaction for Hero' })).toBeInTheDocument();
    close('p1');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
