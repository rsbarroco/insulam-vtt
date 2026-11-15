import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WildShapeControl from '../WildShapeControl';

const uses = { name: 'Wild Shape', max: 2, used: 0 };

describe('WildShapeControl', () => {
  it('takes the form chosen', async () => {
    const change = vi.fn().mockResolvedValue({ ok: true, summary: 'Hero takes the form of the Wolf', left: 1 });
    const onResult = vi.fn();
    render(
      <WildShapeControl
        forms={['Boar', 'Wolf']}
        current={null}
        uses={uses}
        bonusActionSpent={false}
        change={change}
        onResult={onResult}
      />
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Wild Shape form' }), {
      target: { value: 'Wolf' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Wild Shape (2/2)' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith('Wolf'));
    expect(onResult).toHaveBeenCalledWith('Hero takes the form of the Wolf', true);
  });

  it('leaves the form it is in', async () => {
    const change = vi.fn().mockResolvedValue({ ok: true, summary: 'Hero leaves the form of the Wolf', left: 0 });
    render(
      <WildShapeControl
        forms={['Wolf']}
        current="Wolf"
        uses={uses}
        bonusActionSpent={false}
        change={change}
        onResult={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Leave Wolf form' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith(null));
  });

  it('is not used with the Bonus Action spent or no use left', () => {
    render(
      <WildShapeControl
        forms={['Wolf']}
        current={null}
        uses={{ ...uses, used: 2 }}
        bonusActionSpent={false}
        change={vi.fn()}
        onResult={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Wild Shape (0/2)' })).toBeDisabled();
  });
});
