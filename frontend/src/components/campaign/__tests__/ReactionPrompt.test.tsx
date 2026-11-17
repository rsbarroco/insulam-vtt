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

  it('words the question without calling it a reaction, since some are not', () => {
    const { ask } = setup();
    ask({ text: 'Hero hits Ogre (not a Critical Hit). Divine Smite:', options: ['Divine Smite (level 1)'] });
    expect(screen.getByText('Choose for Hero:')).toBeInTheDocument();
    expect(screen.queryByText(/reaction/i)).toBeNull();
  });

  it('sends none for None', async () => {
    const { socket, ask } = setup();
    ask();
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    await waitFor(() => expect(socket.react).toHaveBeenCalledWith('p1', null));
  });

  it('goes away when the question is closed elsewhere', () => {
    const { ask, close } = setup();
    ask();
    expect(screen.getByRole('alertdialog', { name: 'Choice for Hero' })).toBeInTheDocument();
    close('p1');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('says why an answer was refused once the question has gone, until dismissed', async () => {
    const { socket, ask } = setup();
    socket.react.mockResolvedValueOnce({ ok: false, error: 'That question has closed' });
    ask();
    fireEvent.click(screen.getByRole('button', { name: 'Uncanny Dodge' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That question has closed');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
