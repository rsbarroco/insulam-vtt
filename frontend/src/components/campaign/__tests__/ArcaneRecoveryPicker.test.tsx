import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ArcaneRecoveryPicker from '../ArcaneRecoveryPicker';

describe('ArcaneRecoveryPicker', () => {
  it('sends one entry per slot chosen, and shows the combined level', () => {
    const onRecover = vi.fn();
    render(<ArcaneRecoveryPicker anchorX={0} anchorY={0} onRecover={onRecover} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Recover and finish the rest' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Level 1 slots'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Level 2 slots'), { target: { value: '1' } });
    expect(screen.getByText('Combined level: 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recover and finish the rest' }));
    expect(onRecover).toHaveBeenCalledWith([1, 1, 2]);
  });
});
