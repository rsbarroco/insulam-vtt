import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SorceryControl from '../SorceryControl';

const points = { name: 'Sorcery Points', max: 5, used: 2 };
const innate = { name: 'Innate Sorcery', max: 2, used: 0 };
const font = {
  create: [
    { level: 1, cost: 2 },
    { level: 2, cost: 3 },
    { level: 3, cost: 5 },
  ],
  convert: [1, 3],
};

describe('SorceryControl', () => {
  it('starts Innate Sorcery', async () => {
    const use = vi
      .fn()
      .mockResolvedValue({ ok: true, summary: 'Hero unleashes its Innate Sorcery', left: 1 });
    const onResult = vi.fn();
    render(
      <SorceryControl
        points={points}
        innate={innate}
        innateActive={false}
        font={null}
        bonusActionSpent={false}
        use={use}
        onResult={onResult}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Innate Sorcery (2/2)' }));
    await waitFor(() => expect(use).toHaveBeenCalledWith('Innate Sorcery', undefined));
    expect(onResult).toHaveBeenCalledWith('Hero unleashes its Innate Sorcery', true);
  });

  it('says when Innate Sorcery is active, and keeps the button off', () => {
    render(
      <SorceryControl
        points={points}
        innate={innate}
        innateActive
        font={null}
        bonusActionSpent={false}
        use={vi.fn()}
        onResult={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Innate Sorcery active' })).toBeDisabled();
  });

  it('creates the slots it can pay for, and converts a slot left', async () => {
    const use = vi.fn().mockResolvedValue({ ok: true, summary: 'done', left: 0 });
    render(
      <SorceryControl
        points={points}
        innate={null}
        innateActive={false}
        font={font}
        bonusActionSpent={false}
        use={use}
        onResult={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Font of Magic' }));
    expect(screen.getByRole('button', { name: 'Level 3 (5)' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Level 2 (3)' }));
    await waitFor(() => expect(use).toHaveBeenCalledWith('Font of Magic', { create: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Font of Magic' }));
    fireEvent.click(screen.getByRole('button', { name: 'Level 3 (+3)' }));
    await waitFor(() => expect(use).toHaveBeenCalledWith('Font of Magic', { convert: 3 }));
  });

  it('creates no slot with the Bonus Action spent, but still converts', () => {
    render(
      <SorceryControl
        points={points}
        innate={null}
        innateActive={false}
        font={font}
        bonusActionSpent
        use={vi.fn()}
        onResult={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Font of Magic' }));
    expect(screen.getByRole('button', { name: 'Level 1 (2)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Level 1 (+1)' })).toBeEnabled();
  });
});
