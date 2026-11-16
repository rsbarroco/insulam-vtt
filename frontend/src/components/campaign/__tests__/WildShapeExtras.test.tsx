import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WildShapeExtras from '../WildShapeExtras';

const ok = { ok: true as const, summary: 'done', left: 1 };

describe('WildShapeExtras', () => {
  it('offers Wild Companion alone below Druid 5, with a use of Wild Shape', async () => {
    const use = vi.fn().mockResolvedValue(ok);
    const onResult = vi.fn();
    render(<WildShapeExtras resurgence={null} spend={use} onResult={onResult} />);
    const options = Array.from(
      screen.getByLabelText('Wild Resurgence or Wild Companion').querySelectorAll('option')
    ).map((option) => option.textContent);
    expect(options).toEqual(['Wild Companion, with a use', 'Wild Companion, with a spell slot']);
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('done', true));
    expect(use).toHaveBeenCalledWith('Wild Companion', undefined);
  });

  it('sends Wild Resurgence with the slot level chosen, or without one for a level 1 slot', async () => {
    const use = vi.fn().mockResolvedValue({ ok: false, error: 'no' });
    const onResult = vi.fn();
    render(
      <WildShapeExtras
        resurgence={{ name: 'Wild Resurgence', max: 1, used: 0 }}
        spend={use}
        onResult={onResult}
      />
    );
    fireEvent.change(screen.getByLabelText('Spell slot level'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('no', false));
    expect(use).toHaveBeenCalledWith('Wild Resurgence', 3);
    fireEvent.change(screen.getByLabelText('Wild Resurgence or Wild Companion'), {
      target: { value: 'useForSlot' },
    });
    expect(screen.queryByLabelText('Spell slot level')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    await waitFor(() => expect(use).toHaveBeenCalledWith('Wild Resurgence', undefined));
  });
});
