/**
 * Importing the SRD creatures is offered to administrators only.
 *
 * The import fills the library every campaign on the server shares, so the
 * server now lets only an administrator run it. A DM who is not one is told
 * to ask one, instead of being offered a button the server refuses, and a
 * refused or failed import shows the server's reason.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { waitForDialogFocus } from '@/test/dialogFocus';
import userEvent from '@testing-library/user-event';
import CreatureLibrary from '../CreatureLibrary';

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ campaign: { id: 'campaign-1', gameSystem: null }, currentMap: null }),
}));
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ socket: null }) }));
vi.mock('@/components/assets/AssetPicker', () => ({ default: () => null }));

const api = vi.hoisted(() => ({
  listCreatures: vi.fn(),
  getSeedStatus: vi.fn(),
  listCreatureFavorites: vi.fn(),
  seedSrdCreatures: vi.fn(),
}));
vi.mock('@/services/api', () => ({ api, default: api }));

beforeEach(() => {
  vi.clearAllMocks();
  api.listCreatures.mockResolvedValue({ creatures: [], total: 0 });
  api.listCreatureFavorites.mockResolvedValue({ favoriteIds: [], creatures: [] });
});

describe('the SRD import in an empty library', () => {
  it('tells a DM who is not an administrator to ask one, with no button', async () => {
    api.getSeedStatus.mockResolvedValue({ srdCount: 0, customCount: 0, seedInProgress: false, canSeed: false });
    render(<CreatureLibrary isOpen onClose={() => {}} />);

    expect(await screen.findByText(/Ask an administrator to import them/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import D&D 5e SRD Creatures' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import D&D 5e SRD$/ })).not.toBeInTheDocument();
  });

  it('offers an administrator the import, and shows the server\'s reason when it fails', async () => {
    api.getSeedStatus.mockResolvedValue({ srdCount: 0, customCount: 0, seedInProgress: false, canSeed: true });
    api.seedSrdCreatures.mockRejectedValue({
      response: { status: 500, data: { error: 'Internal Server Error', message: 'Failed to seed SRD creatures' } },
    });
    render(<CreatureLibrary isOpen onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Import D&D 5e SRD Creatures' }));

    expect(await screen.findByText('Failed to seed SRD creatures')).toBeInTheDocument();
  });

  it('keeps the server\'s reason on screen when the list reloads after it', async () => {
    // Every list load clears the list's error box, so a failed import's reason
    // has a box of its own: a search typed afterwards reloads the list and
    // must not take the reason away.
    api.getSeedStatus.mockResolvedValue({ srdCount: 0, customCount: 0, seedInProgress: false, canSeed: true });
    api.seedSrdCreatures.mockRejectedValue({
      response: { status: 500, data: { error: 'Internal Server Error', message: 'Failed to seed SRD creatures' } },
    });
    render(<CreatureLibrary isOpen onClose={() => {}} />);
    await waitForDialogFocus();

    await userEvent.click(await screen.findByRole('button', { name: 'Import D&D 5e SRD Creatures' }));
    expect(await screen.findByText('Failed to seed SRD creatures')).toBeInTheDocument();

    const loadsBefore = api.listCreatures.mock.calls.length;
    await userEvent.type(screen.getByPlaceholderText('Search creatures...'), 'gob');
    await waitFor(() => expect(api.listCreatures.mock.calls.length).toBeGreaterThan(loadsBefore), { timeout: 2000 });
    expect(screen.getByText('Failed to seed SRD creatures')).toBeInTheDocument();
  });
});

describe('loading the library', () => {
  it('loads the list once when it opens', async () => {
    // The search box's 300 ms wait used to fire once on opening too, so the
    // list loaded twice and the panel was rebuilt under the user's pointer.
    api.getSeedStatus.mockResolvedValue({ srdCount: 0, customCount: 0, seedInProgress: false, canSeed: true });
    render(<CreatureLibrary isOpen onClose={() => {}} />);

    await screen.findByRole('button', { name: 'Import D&D 5e SRD Creatures' });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(api.listCreatures).toHaveBeenCalledTimes(1);
  });

  it('loads it again with the search once typing stops', async () => {
    api.getSeedStatus.mockResolvedValue({ srdCount: 0, customCount: 0, seedInProgress: false, canSeed: false });
    render(<CreatureLibrary isOpen onClose={() => {}} />);
    await waitForDialogFocus();
    await waitFor(() => expect(api.listCreatures).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByPlaceholderText('Search creatures...'), 'gob');
    await waitFor(() => expect(api.listCreatures).toHaveBeenLastCalledWith('campaign-1', expect.objectContaining({ search: 'gob' })), { timeout: 2000 });
  });
});

describe('the Creature Library as a dialog', () => {
  it('opens from the left, is announced by name, and Escape and its Close button close it', async () => {
    const onClose = vi.fn();
    render(<CreatureLibrary isOpen onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Creature Library' });
    expect(dialog.className).toMatch(/\bleft-0\b/);
    await waitFor(() => expect(api.listCreatures).toHaveBeenCalled());

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('a library imported before the 2024 creatures', () => {
  const outdated = { srdCount: 322, customCount: 0, srdOutdated: true, seedInProgress: false };

  it('offers an administrator the update, and says what it did', async () => {
    api.getSeedStatus.mockResolvedValue({ ...outdated, canSeed: true });
    api.seedSrdCreatures.mockResolvedValue({ message: 'ok', fetched: 330, created: 40, updated: 290, skipped: 0, removed: 32, alreadyExisted: 322, rejected: 0 });
    render(<CreatureLibrary isOpen onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Update to the 2024 creatures' }));

    expect(await screen.findByText(/Imported 40 SRD creatures \(290 replaced with the 2024 stat block, 32 that the 2024 rules do not have removed\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update to the 2024 creatures' })).not.toBeInTheDocument();
  });

  it('offers nothing to a DM who is not an administrator, nor when the library is up to date', async () => {
    api.getSeedStatus.mockResolvedValue({ ...outdated, canSeed: false });
    const { unmount } = render(<CreatureLibrary isOpen onClose={() => {}} />);
    await screen.findByText('Create Custom');
    expect(screen.queryByRole('button', { name: 'Update to the 2024 creatures' })).not.toBeInTheDocument();
    unmount();

    api.getSeedStatus.mockResolvedValue({ srdCount: 330, customCount: 0, srdOutdated: false, seedInProgress: false, canSeed: true });
    render(<CreatureLibrary isOpen onClose={() => {}} />);
    await screen.findByText('Create Custom');
    expect(screen.queryByRole('button', { name: 'Update to the 2024 creatures' })).not.toBeInTheDocument();
  });
});
