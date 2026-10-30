import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import ResetPasswordPage from '../ResetPasswordPage';

const resetPassword = vi.hoisted(() => vi.fn());
vi.mock('@/services/auth.service', () => ({ default: { resetPassword } }));
const token = 'a'.repeat(64);
const password = 'AnotherGoodPass42!';

function open(url: string, invite = false) {
  const router = createMemoryRouter([{ path: '*', element: <ResetPasswordPage invite={invite} /> }],
    { initialEntries: [url] });
  const view = render(<StrictMode><RouterProvider router={router} /></StrictMode>);
  return { router, view };
}
function submit() {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /set new password|create my account/i }));
}

beforeEach(() => { cleanup(); resetPassword.mockReset(); });

describe('password link fragments', () => {
  it.each([false, true])('clears the URL before submission while keeping token only in memory (invite=%s)', async invite => {
    const { router } = open((invite ? '/accept-invite' : '/reset-password') + '#token=' + token, invite);
    await waitFor(() => expect(router.state.location.hash).toBe(''));
    expect(router.state.location.search).toBe('');
    expect(router.state.location.state).toBeNull();
    expect(resetPassword).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(token);
    resetPassword.mockResolvedValue({});
    submit();
    await screen.findByText(invite ? "You're all set!" : 'Password updated!');
    expect(resetPassword).toHaveBeenCalledExactlyOnceWith(token, password);
  });

  it('accepts and immediately removes a previously issued query link', async () => {
    const { router } = open('/reset-password?token=' + token);
    await waitFor(() => expect(router.state.location.search).toBe(''));
    submit();
    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith(token, password));
  });

  it.each(['#token=bad', '#token=', '#token=%ZZ', '#token='+token+'&token='+token])(
    'refuses malformed or ambiguous fragments without a request: %s', async hash => {
      const { router } = open('/reset-password' + hash);
      await screen.findByText('Invalid link');
      expect(router.state.location.hash).toBe('');
      expect(resetPassword).not.toHaveBeenCalled();
    });

  it('does not recover the token after a reload/remount of the cleaned URL', async () => {
    const { router, view } = open('/reset-password#token=' + token);
    await waitFor(() => expect(router.state.location.hash).toBe(''));
    const clean = router.state.location.pathname;
    view.unmount(); router.dispose();
    open(clean);
    await screen.findByText('Invalid link');
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it.each(['expired', 'already used'])('preserves the server refusal for an %s token', async reason => {
    resetPassword.mockRejectedValue({ response: { data: { message: 'Link is '+reason } } });
    open('/reset-password#token=' + token); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Link is '+reason);
    expect(screen.queryByText('Password updated!')).not.toBeInTheDocument();
  });

  it('allows retry after network failure without restoring token to the URL', async () => {
    resetPassword.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({});
    const { router } = open('/reset-password#token=' + token); submit();
    await screen.findByRole('alert');
    expect(router.state.location.hash).toBe('');
    submit();
    await screen.findByText('Password updated!');
    expect(resetPassword).toHaveBeenCalledTimes(2);
  });
});
