/**
 * The turn bar: what it shows of the acting combatant's turn, who may change
 * it, and what it sends. The campaign, socket and sign-in are stand-ins; the
 * combat state and tokens are the real store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useGameStore } from '@/stores/gameStore';
import type { CombatState, Token, TurnState } from '@/types';
import { TokenLayer } from '@/types';

const h = vi.hoisted(() => ({
  role: 'DM' as string,
  userId: 'dm-1' as string,
  emitTurnUpdate: vi.fn(),
  emitTurnEnd: vi.fn(),
}));

vi.mock('@/contexts/CampaignContext', () => ({ useCampaign: () => ({ userRole: h.role }) }));
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocket: () => ({
    socket: { emitTurnUpdate: h.emitTurnUpdate, emitTurnEnd: h.emitTurnEnd },
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: h.userId } }) }));

import TurnBar from '../TurnBar';

const token = (id: string, name: string, over: Partial<Token> = {}): Token =>
  ({
    id,
    name,
    imageUrl: '',
    position: { x: 0, y: 0 },
    size: { width: 1, height: 1 },
    layer: TokenLayer.TOKEN,
    visible: true,
    controlledBy: null,
    rotation: 0,
    conditions: [],
    metadata: {},
    ...over,
  }) as Token;

const HERO = token('hero', 'Hero', {
  controlledBy: 'player-1',
  metadata: { tactical: { speed: 30 } },
});
const OGRE = token('ogre', 'Ogre', { statBlock: { speed: '40 ft.' } } as Partial<Token>);

const fresh: TurnState = { movementSpent: 0, dashes: 0, action: null, bonusAction: false };
function fight(over: Partial<CombatState> = {}) {
  useGameStore.getState().setTokens([HERO, OGRE]);
  useGameStore.getState().setCombatState({
    active: true,
    round: 1,
    currentTokenId: 'hero',
    combatants: [HERO, OGRE].map((t) => ({
      tokenId: t.id,
      mapId: 'map-1',
      name: t.name,
      imageUrl: '',
      initiative: 10,
      hp: null,
      type: 'npc' as const,
      disposition: null,
    })),
    turn: fresh,
    reactionsSpent: [],
    ...over,
  });
}
const as = (role: string, userId: string) => {
  h.role = role;
  h.userId = userId;
};

beforeEach(() => {
  h.emitTurnUpdate.mockReset();
  h.emitTurnEnd.mockReset();
  as('DM', 'dm-1');
  useGameStore.getState().clearGameState();
});

describe('TurnBar', () => {
  it('shows nothing outside combat', () => {
    fight({ active: false, currentTokenId: null, turn: null });
    const { container } = render(<TurnBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows whose turn it is and the movement left of its speed', () => {
    fight({ turn: { ...fresh, movementSpent: 12.5 } });
    render(<TurnBar />);

    expect(screen.getByRole('group', { name: 'Turn of Hero' })).toBeInTheDocument();
    expect(screen.getByText('17.5 of 30 ft left')).toBeInTheDocument();
  });

  it('counts a Dash into the movement', () => {
    fight({ turn: { ...fresh, action: 'Dash', dashes: 1, movementSpent: 30 } });
    render(<TurnBar />);

    expect(screen.getByText('30 of 60 ft left')).toBeInTheDocument();
  });

  it('reads a creature speed from its stat block', () => {
    fight({ currentTokenId: 'ogre' });
    render(<TurnBar />);

    expect(screen.getByText('40 of 40 ft left')).toBeInTheDocument();
  });

  it('shows only the feet moved for a token with no speed', () => {
    useGameStore.getState().setTokens([token('hero', 'Hero'), OGRE]);
    useGameStore
      .getState()
      .setCombatState({
        ...useGameStore.getState().combat,
        active: true,
        round: 1,
        currentTokenId: 'hero',
        turn: { ...fresh, movementSpent: 10 },
        combatants: [],
      });
    render(<TurnBar />);

    expect(screen.getByText('10 ft moved')).toBeInTheDocument();
  });

  it('sends the action the DM picks, counting Dash', () => {
    fight();
    render(<TurnBar />);

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'Dash' } });

    expect(h.emitTurnUpdate).toHaveBeenCalledWith({ action: 'Dash', dashes: 1 });
  });

  it('sends the bonus action and the reaction when ticked', () => {
    fight();
    render(<TurnBar />);

    fireEvent.click(screen.getByLabelText('Bonus action used'));
    fireEvent.click(screen.getByLabelText('Reaction used'));

    expect(h.emitTurnUpdate).toHaveBeenCalledWith({ bonusAction: true });
    expect(h.emitTurnUpdate).toHaveBeenCalledWith({ reaction: { tokenId: 'hero', spent: true } });
  });

  it('ends the turn of the acting token by name', () => {
    fight();
    render(<TurnBar />);

    fireEvent.click(screen.getByRole('button', { name: 'End turn' }));

    expect(h.emitTurnEnd).toHaveBeenCalledWith('hero');
  });

  it('gives the player whose turn it is the same controls', () => {
    as('PLAYER', 'player-1');
    fight();
    render(<TurnBar />);

    expect(screen.getByLabelText('Action')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End turn' })).toBeInTheDocument();
  });

  it("shows a player another's turn without controls, and keeps their own reaction to hand", () => {
    as('PLAYER', 'player-1');
    fight({ currentTokenId: 'ogre', turn: { ...fresh, action: 'Attack', bonusAction: true } });
    render(<TurnBar />);

    expect(screen.getByText('Action: Attack · bonus action used')).toBeInTheDocument();
    expect(screen.queryByLabelText('Action')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End turn' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Hero: reaction used'));
    expect(h.emitTurnUpdate).toHaveBeenCalledWith({ reaction: { tokenId: 'hero', spent: true } });
  });

  it('shows a reaction already spent as ticked', () => {
    fight({ reactionsSpent: ['hero'] });
    render(<TurnBar />);

    expect(screen.getByLabelText('Reaction used')).toBeChecked();
  });
});
