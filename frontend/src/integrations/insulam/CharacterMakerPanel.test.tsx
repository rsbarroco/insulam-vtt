import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import CharacterMakerPanel from './CharacterMakerPanel';
import { requestCharacterMakerSnapshot, type SnapshotRequest, type SnapshotResult } from './characterMakerHandoff';
import type { CharacterProjection } from './characterProjection';

const serverConfig = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/queries', () => ({ useServerConfigQuery: () => serverConfig() }));
vi.mock('./characterMakerHandoff', () => ({ requestCharacterMakerSnapshot: vi.fn() }));
const requestSnapshot = vi.mocked(requestCharacterMakerSnapshot);

const projection: CharacterProjection = {
  schemaVersion: 1, readOnly: true, characterId: 'synthetic-character', displayName: 'Example adventurer',
};
const origin = 'https://maker.example.invalid';

function pendingRequest() {
  let resolve!: (result: SnapshotResult) => void;
  const request: SnapshotRequest = {
    result: new Promise((done) => { resolve = done; }),
    cancel: vi.fn(), focus: vi.fn(),
  };
  requestSnapshot.mockReturnValueOnce(request);
  return { request, resolve };
}

beforeEach(() => {
  requestSnapshot.mockReset();
  serverConfig.mockReset().mockReturnValue({ data: { characterMaker: { origin } } });
});
afterEach(cleanup);

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Open CharacterMaker' }));
const settle = async (resolve: (result: SnapshotResult) => void, result: SnapshotResult) => {
  await act(async () => { resolve(result); });
};

describe('CharacterMaker snapshot preview', () => {
  it.each([{ data: undefined }, { data: {} }, { data: { characterMaker: undefined } }])('is unavailable without runtime opt-in', (config) => {
    serverConfig.mockReturnValue(config);
    const { container } = render(<CharacterMakerPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(requestSnapshot).not.toHaveBeenCalled();
  });

  it('opens only on explicit action, and repeated clicks cannot create another request', () => {
    const { request } = pendingRequest();
    render(<CharacterMakerPanel />);
    expect(requestSnapshot).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: 'Open CharacterMaker' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(requestSnapshot).toHaveBeenCalledTimes(1);
    expect(requestSnapshot).toHaveBeenCalledWith(origin);
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for your approval');
    fireEvent.click(screen.getByRole('button', { name: 'Focus CharacterMaker window' }));
    expect(request.focus).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['popup-blocked', 'Your browser blocked'],
    ['popup-closed', 'was closed before a snapshot'],
    ['expired', 'If sign-in was interrupted'],
    ['invalid-payload', 'response was not accepted'],
    ['crypto-unavailable', 'secure browser context'],
    ['invalid-configuration', 'not configured correctly'],
  ] as const)('explains %s without displaying a snapshot', async (reason, message) => {
    const { resolve } = pendingRequest();
    render(<CharacterMakerPanel />);
    open();
    await settle(resolve, { ok: false, reason });
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Open CharacterMaker' })).toBeEnabled();
    expect(screen.queryByLabelText('CharacterMaker snapshot')).not.toBeInTheDocument();
  });

  it('shows a minimal snapshot without inventing missing stats', async () => {
    const { resolve } = pendingRequest();
    render(<CharacterMakerPanel />);
    open();
    await settle(resolve, { ok: true, character: projection });
    expect(screen.getByRole('heading', { name: 'Example adventurer' })).toBeInTheDocument();
    expect(screen.getByText('No computed stats were supplied. Missing values are not zero.')).toBeInTheDocument();
    expect(screen.queryByText('HP', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Defense', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(/not saved or shared with your table/)).toBeInTheDocument();
    expect(screen.getByText(/It is not live sync/)).toBeInTheDocument();
  });

  it('renders supplied metrics and names as text, including zero and negative values', async () => {
    const { resolve } = pendingRequest();
    render(<CharacterMakerPanel />);
    open();
    await settle(resolve, { ok: true, character: {
      ...projection, displayName: '<img src=x onerror=alert(1)>',
      hp: { current: 0, max: 12 }, defense: 0, initiative: -2,
      sourceUpdatedAt: '2026-10-28T23:00:00.000Z',
    } });
    expect(screen.getByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('0 / 12')).toBeInTheDocument();
    expect(screen.getByText('0', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('-2', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('2026-10-28T23:00:00.000Z')).toHaveAttribute('dateTime', '2026-10-28T23:00:00.000Z');
  });

  it('cancels and ignores a late success, including after a newer request started', async () => {
    const first = pendingRequest();
    const second = pendingRequest();
    render(<CharacterMakerPanel />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(first.request.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Request cancelled');
    open();
    await settle(first.resolve, { ok: true, character: projection });
    expect(screen.queryByRole('heading', { name: 'Example adventurer' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for your approval');
    await settle(second.resolve, { ok: true, character: { ...projection, displayName: 'Current request' } });
    expect(screen.getByRole('heading', { name: 'Current request' })).toBeInTheDocument();
  });

  it('cancels pending work when leaving the page and ignores late completion', async () => {
    const { request, resolve } = pendingRequest();
    const { unmount, container } = render(<CharacterMakerPanel />);
    open();
    unmount();
    expect(request.cancel).toHaveBeenCalledTimes(1);
    await settle(resolve, { ok: true, character: projection });
    expect(container).toBeEmptyDOMElement();
  });

  it('discards the prior account state when its parent account key changes', async () => {
    const { request, resolve } = pendingRequest();
    const { rerender } = render(<CharacterMakerPanel key="account-one" />);
    open();
    rerender(<CharacterMakerPanel key="account-two" />);
    expect(request.cancel).toHaveBeenCalledTimes(1);
    await settle(resolve, { ok: true, character: projection });
    expect(screen.queryByRole('heading', { name: 'Example adventurer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open CharacterMaker' })).toBeEnabled();
  });

  it('cancels and clears when the configured source changes', async () => {
    const { request, resolve } = pendingRequest();
    const { rerender } = render(<CharacterMakerPanel />);
    open();
    serverConfig.mockReturnValue({ data: { characterMaker: { origin: 'https://other.example.invalid' } } });
    rerender(<CharacterMakerPanel />);
    expect(request.cancel).toHaveBeenCalledTimes(1);
    await settle(resolve, { ok: true, character: projection });
    expect(screen.queryByRole('heading', { name: 'Example adventurer' })).not.toBeInTheDocument();
    expect(screen.getByText(/Configured CharacterMaker:/)).toHaveTextContent('https://other.example.invalid');
  });

  it('clears the old snapshot before an explicit refresh requests new consent', async () => {
    const first = pendingRequest();
    const second = pendingRequest();
    render(<CharacterMakerPanel />);
    open();
    await settle(first.resolve, { ok: true, character: projection });
    fireEvent.click(screen.getByRole('button', { name: 'Request new snapshot' }));
    expect(requestSnapshot).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('heading', { name: 'Example adventurer' })).not.toBeInTheDocument();
    await settle(second.resolve, { ok: true, character: { ...projection, displayName: 'Refreshed copy' } });
    expect(screen.getByRole('heading', { name: 'Refreshed copy' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove snapshot' }));
    expect(screen.queryByLabelText('CharacterMaker snapshot')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open CharacterMaker' })).toBeEnabled();
  });
});
