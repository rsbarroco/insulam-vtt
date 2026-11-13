/**
 * Rests from the roster's character menu: a Short Rest for whoever may roll
 * as the character, a Long Rest for the DM, and neither for a character of
 * another system.
 */

import { it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampaignRole, type RosterMember } from '@/types';
import { GameSystem } from '@/types/gameSystem';
import { useGameStore } from '@/stores/gameStore';

const getCampaignCharacters = vi.fn();
const assignCharacterToCampaign = vi.fn();
const rest = vi.fn();
const seat = { role: 'DM', userId: 'dm' };
const socket = { on: vi.fn(), off: vi.fn(), onPresenceState: vi.fn(), requestPresence: vi.fn(), rest: (...a: unknown[]) => rest(...a) };

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => undefined }) }));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({
    campaign: { id: 'c1', memberships: [{ userId: 'dm', role: 'DM' }, { userId: 'p1', role: 'PLAYER' }] },
    currentMap: null,
    userRole: seat.role,
  }),
}));
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ socket }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: seat.userId } }) }));
vi.mock('@/services/api', () => {
  const client = {
    getCampaignCharacters: (...a: unknown[]) => getCampaignCharacters(...a),
    assignCharacterToCampaign: (...a: unknown[]) => assignCharacterToCampaign(...a),
  };
  return { api: client, default: client };
});

import CampaignRoster from '../CampaignRoster';

const roster = (): RosterMember[] => [
  { userId: 'dm', userName: 'Mara', userAvatar: null, role: CampaignRole.DM, joinedAt: '2026-10-01T00:00:00.000Z', characters: [] },
  {
    userId: 'p1', userName: 'Ash', userAvatar: null, role: CampaignRole.PLAYER, joinedAt: '2026-10-01T00:00:00.000Z',
    characters: [
      { id: 'ash-other', name: 'Ash in another game', tokenImageUrl: null, gameSystem: null, userId: 'p1', hp: null },
      { id: 'ash-hero', name: "Ash's hero", tokenImageUrl: null, gameSystem: GameSystem.DND_5E, userId: 'p1', hp: { current: 7, max: 10, temp: 0 } },
    ],
  },
];

beforeEach(() => {
  getCampaignCharacters.mockReset().mockResolvedValue({ roster: roster() });
  assignCharacterToCampaign.mockReset().mockResolvedValue({});
  rest.mockReset().mockResolvedValue({ ok: true, summary: 'rested' });
  seat.role = 'DM';
  seat.userId = 'dm';
  useGameStore.getState().clearGameState();
});

const openMenu = async (name: string) => {
  render(<CampaignRoster />);
  fireEvent.contextMenu(await screen.findByText(name), { clientX: 40, clientY: 40 });
};

it('gives the DM a Long Rest to grant, and a Short Rest to spend for the player', async () => {
  await openMenu("Ash's hero");
  await userEvent.click(await screen.findByRole('button', { name: 'Long rest' }));
  await waitFor(() => expect(rest).toHaveBeenCalledWith('ash-hero', 'long'));

  fireEvent.contextMenu(screen.getByText("Ash's hero"), { clientX: 40, clientY: 40 });
  await userEvent.click(await screen.findByRole('button', { name: 'Short rest: spend a Hit Die' }));
  await waitFor(() => expect(rest).toHaveBeenCalledWith('ash-hero', 'short'));
});

it('gives a player the Short Rest of their own character, and no Long Rest', async () => {
  seat.role = 'PLAYER';
  seat.userId = 'p1';
  await openMenu("Ash's hero");
  expect(await screen.findByRole('button', { name: 'Short rest: spend a Hit Die' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Long rest' })).not.toBeInTheDocument();
});

it('offers no rest to a character that is not a D&D 5e one', async () => {
  await openMenu('Ash in another game');
  expect(await screen.findByRole('button', { name: 'View Character Sheet' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /rest/i })).not.toBeInTheDocument();
});
