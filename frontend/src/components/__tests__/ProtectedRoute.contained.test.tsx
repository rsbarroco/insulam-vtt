import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ProtectedRoute from '../ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
afterEach(cleanup);

function show(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    loading: false, authenticated: true, mustChangePassword: false,
    user: { id: 'synthetic', platformRole: 'ADMIN', adminMfaDeadline: '2026-11-01T00:00:00.000Z' },
    backupCodesLeft: 2, dismissBackupCodesLeft: vi.fn(), retryAuthCheck: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAuth>);
  return render(<MemoryRouter><ProtectedRoute contained><p>Table content</p></ProtectedRoute></MemoryRouter>);
}

describe('contained table authentication layout', () => {
  it('reserves banner space separately from the table', () => {
    show();
    const child = screen.getByText('Table content').parentElement;
    expect(child).toHaveClass('flex-1', 'min-h-0');
    expect(child?.parentElement).toHaveClass('h-full', 'flex', 'flex-col');
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(child?.previousElementSibling).toHaveClass('shrink-0');
  });
  it('keeps authentication loading within the reserved height', () => {
    const { container } = show({ loading: true, serverUnreachable: false });
    expect(container.firstElementChild).toHaveClass('h-full');
    expect(container.firstElementChild).not.toHaveClass('min-h-screen');
  });
  it('keeps the unavailable-server fallback within the reserved height', () => {
    const { container } = show({ loading: true, serverUnreachable: true });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('h-full');
    expect(container.firstElementChild).not.toHaveClass('min-h-screen');
  });
});
