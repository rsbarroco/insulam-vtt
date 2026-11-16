import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PreserveLife from '../PreserveLife';

const targets = [
  { id: 'cleric', name: 'Cleric' },
  { id: 'ally', name: 'Ally' },
];

describe('PreserveLife', () => {
  it('sends the shares given to each creature, leaving out those given none', async () => {
    const divide = vi.fn().mockResolvedValue({ ok: true, summary: 'Preserve Life', healed: 9 });
    const onResult = vi.fn();
    render(
      <PreserveLife
        pool={15}
        targets={targets}
        actionSpent={false}
        divide={divide}
        onResult={onResult}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Preserve Life \(15\)/ }));
    const restore = screen.getByRole('button', { name: 'Restore' });
    expect(restore).toBeDisabled();
    const field = screen.getByLabelText('Hit Points for Ally');
    fireEvent.change(field, { target: { value: '9' } });
    fireEvent.blur(field);
    expect(screen.getByText(/9\/15/)).toBeInTheDocument();
    fireEvent.click(restore);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('Preserve Life', true));
    expect(divide).toHaveBeenCalledWith([{ targetId: 'ally', amount: 9 }]);
  });

  it('is disabled once the action is taken', () => {
    render(
      <PreserveLife pool={15} targets={targets} actionSpent divide={vi.fn()} onResult={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: /Preserve Life/ })).toBeDisabled();
  });
});
