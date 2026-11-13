import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TurnFeatures from '../TurnFeatures';

describe('TurnFeatures', () => {
  it('offers a Rogue Cunning Action, Hide through the check', async () => {
    const use = vi
      .fn()
      .mockResolvedValue({ ok: true, summary: 'Hero uses Cunning Action: Disengage', left: 0 });
    const hide = vi.fn().mockResolvedValue({ ok: true, summary: 'hidden' });
    render(
      <TurnFeatures
        features={['Cunning Action']}
        bonusActionSpent={false}
        use={use}
        hide={hide}
        onResult={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cunning: Disengage' }));
    await waitFor(() => expect(use).toHaveBeenCalledWith('Cunning Action', { as: 'Disengage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cunning: Hide' }));
    await waitFor(() => expect(hide).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Flurry of Blows' })).toBeNull();
  });

  it('offers a Monk its Focus, however the apostrophe is written, and waits for the Bonus Action', () => {
    const use = vi.fn().mockResolvedValue({ ok: true, summary: '', left: 1 });
    const { rerender } = render(
      <TurnFeatures
        features={['Monk’s Focus']}
        bonusActionSpent={false}
        use={use}
        hide={vi.fn()}
        onResult={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Patient Defense +1' }));
    expect(use).toHaveBeenCalledWith('Patient Defense', { focus: true });
    rerender(
      <TurnFeatures
        features={["Monk's Focus"]}
        bonusActionSpent
        use={use}
        hide={vi.fn()}
        onResult={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: 'Flurry of Blows' })).toBeDisabled();
  });

  it('shows nothing to a character without them', () => {
    const { container } = render(
      <TurnFeatures
        features={['Second Wind']}
        bonusActionSpent={false}
        use={vi.fn()}
        hide={vi.fn()}
        onResult={() => {}}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
