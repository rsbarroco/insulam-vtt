import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BardicInspiration from '../BardicInspiration';
import LayOnHands from '../LayOnHands';

const ok = { ok: true as const, summary: 'done', left: 1 };

describe('the creature chosen when the turn passes to another caster', () => {
  it('Lay on Hands starts again from the new paladin', async () => {
    const touch = vi.fn().mockResolvedValue(ok);
    const props = {
      pool: { name: 'Lay on Hands', max: 10, used: 0 },
      bonusActionSpent: false,
      cures: [],
      touch,
      onResult: vi.fn(),
    };
    const { rerender } = render(
      <LayOnHands
        {...props}
        targets={[
          { id: 'anna', name: 'Anna' },
          { id: 'bert', name: 'Bert' },
        ]}
      />
    );
    rerender(
      <LayOnHands
        {...props}
        targets={[
          { id: 'bert', name: 'Bert' },
          { id: 'anna', name: 'Anna' },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Lay on Hands/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Heal' }));
    await waitFor(() => expect(touch).toHaveBeenCalledWith('bert', 5, null));
  });

  it('Bardic Inspiration does not keep a creature no longer listed', async () => {
    const inspire = vi.fn().mockResolvedValue(ok);
    const props = {
      uses: { name: 'Bardic Inspiration', max: 3, used: 0 },
      bonusActionSpent: false,
      inspire,
      onResult: vi.fn(),
    };
    const { rerender } = render(
      <BardicInspiration
        {...props}
        targets={[
          { id: 'bert', name: 'Bert' },
          { id: 'cara', name: 'Cara' },
        ]}
      />
    );
    rerender(
      <BardicInspiration
        {...props}
        targets={[
          { id: 'anna', name: 'Anna' },
          { id: 'cara', name: 'Cara' },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Bardic Inspiration/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspire' }));
    await waitFor(() => expect(inspire).toHaveBeenCalledWith('anna'));
  });
});
