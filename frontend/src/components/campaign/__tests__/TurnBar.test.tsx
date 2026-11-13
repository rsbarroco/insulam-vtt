/**
 * The turn bar: what it shows of the acting combatant's turn, who may change
 * it, and what it sends. The campaign, socket and sign-in are stand-ins; the
 * combat state and tokens are the real store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useGameStore } from '@/stores/gameStore';
import type { CombatState, Token, TurnState } from '@/types';
import { TokenLayer } from '@/types';

const h = vi.hoisted(() => ({
  role: 'DM' as string,
  userId: 'dm-1' as string,
  emitTurnUpdate: vi.fn(),
  emitTurnEnd: vi.fn(),
  rollDeathSave: vi.fn(),
  resolveAttack: vi.fn(),
  listCombatActions: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/contexts/CampaignContext', () => ({ useCampaign: () => ({ userRole: h.role }) }));
// One socket for the life of the test, as the real context gives.
const socket = {
  emitTurnUpdate: (...args: unknown[]) => h.emitTurnUpdate(...args),
  emitTurnEnd: (...args: unknown[]) => h.emitTurnEnd(...args),
  rollDeathSave: (...args: unknown[]) => h.rollDeathSave(...args),
  resolveAttack: (...args: unknown[]) => h.resolveAttack(...args),
  listCombatActions: (...args: unknown[]) => h.listCombatActions(...args),
};
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ socket }) }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: h.showToast }) }));
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

const fresh: TurnState = { movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0 };
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
h.listCombatActions.mockResolvedValue({ ok: false, error: 'none' });
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

describe('a character at 0 Hit Points', () => {
  const downedHero = token('hero', 'Hero', { controlledBy: 'player-1', characterId: 'char-1' } as Partial<Token>);
  const down = (current: number) => {
    fight();
    useGameStore.getState().setTokens([downedHero, OGRE]);
    useGameStore.getState().setCharacterHp('char-1', { current, max: 30, temp: 0 });
  };

  it('is offered a death save by whoever may act for it, and told how it went', async () => {
    as('PLAYER', 'player-1');
    down(0);
    h.rollDeathSave.mockResolvedValue({ ok: true, summary: 'Hero death save: success (1 successes, 0 failures)', natural: 12, result: 'continues', saves: { successes: 1, failures: 0 } });
    render(<TurnBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Death save' }));
    expect(h.rollDeathSave).toHaveBeenCalledWith('hero');
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('Hero death save: success (1 successes, 0 failures)', 'info'));
  });

  it('is not offered one on its feet, nor to someone who cannot act for it', () => {
    as('PLAYER', 'player-1');
    down(7);
    const { unmount } = render(<TurnBar />);
    expect(screen.queryByRole('button', { name: 'Death save' })).not.toBeInTheDocument();
    unmount();

    as('PLAYER', 'player-2');
    down(0);
    render(<TurnBar />);
    expect(screen.queryByRole('button', { name: 'Death save' })).not.toBeInTheDocument();
  });
});

describe('what the character’s features give its turn', () => {
  const abilities = {
    ok: true,
    actions: [],
    attacksPerAction: 2,
    features: [
      { name: 'Second Wind', cost: 'bonusAction', text: 'As a Bonus Action, you regain Hit Points equal to 1d10 plus your Fighter level.' },
      { name: 'Uncanny Dodge', cost: 'reaction', text: 'You can take a Reaction to halve the attack’s damage.' },
    ],
  };

  it('counts the attacks of the Attack action against what Extra Attack allows', async () => {
    as('PLAYER', 'player-1');
    h.listCombatActions.mockResolvedValue(abilities);
    fight({ turn: { ...fresh, action: 'Attack', attacks: 1 } });
    render(<TurnBar />);
    expect(await screen.findByText('Attack 1 of 2')).toBeInTheDocument();
    expect(h.listCombatActions).toHaveBeenCalledWith('hero');
  });

  it('lists the features used with a Bonus Action or a Reaction, with their rule, and spends what one costs', async () => {
    as('PLAYER', 'player-1');
    h.listCombatActions.mockResolvedValue(abilities);
    fight();
    render(<TurnBar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Features' }));
    expect(screen.getByText(/1d10 plus your Fighter level/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use Second Wind as a Bonus Action' }));
    expect(h.emitTurnUpdate).toHaveBeenCalledWith({ bonusAction: true });
    fireEvent.click(screen.getByRole('button', { name: 'Use Uncanny Dodge as a Reaction' }));
    expect(h.emitTurnUpdate).toHaveBeenCalledWith({ reaction: { tokenId: 'hero', spent: true } });
  });

  it('shows a feature as spent once its Bonus Action is', async () => {
    as('PLAYER', 'player-1');
    h.listCombatActions.mockResolvedValue(abilities);
    fight({ turn: { ...fresh, bonusAction: true } });
    render(<TurnBar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Features' }));
    expect(screen.getByRole('button', { name: 'Use Second Wind as a Bonus Action' })).toBeDisabled();
  });

  it('offers nothing to someone who cannot act for the character', async () => {
    as('PLAYER', 'player-2');
    h.listCombatActions.mockResolvedValue({ ok: false, error: 'You can only act for your own token' });
    fight();
    render(<TurnBar />);
    await waitFor(() => expect(h.listCombatActions).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Features' })).not.toBeInTheDocument();
  });

  it('says the acting combatant is dodging once it has taken the Dodge action', () => {
    as('DM', 'dm-1');
    fight({ turn: { ...fresh, action: 'Dodge' }, dodging: ['hero'] });
    render(<TurnBar />);
    expect(screen.getByText('Dodging: attacks against it have Disadvantage')).toBeInTheDocument();
  });

  it('does not say so of one that is not', () => {
    as('DM', 'dm-1');
    fight({ turn: { ...fresh, action: 'Dodge' }, dodging: ['ogre'] });
    render(<TurnBar />);
    expect(screen.queryByText(/^Dodging/)).not.toBeInTheDocument();
  });
});

describe('an Opportunity Attack', () => {
  const offered = { opportunities: [{ attackerId: 'ogre', targetId: 'hero' }] };
  const club = { index: 0, name: 'Greatclub', cost: 'action', attack: { kind: 'melee' }, spell: null, save: null };
  const javelin = { index: 1, name: 'Javelin', cost: 'action', attack: { kind: 'ranged' }, spell: null, save: null };
  const bite = { index: 2, name: 'Bite', cost: 'action', attack: { kind: 'melee' }, spell: null, save: null };
  const listing = (...actions: unknown[]) => ({ ok: true, actions, attacksPerAction: null, features: [] });
  const offer = { name: 'Opportunity Attack: Ogre on Hero' };

  beforeEach(() => {
    h.resolveAttack.mockReset().mockResolvedValue({ ok: true, summary: 'Greatclub vs Hero (AC 16): hit', hit: true });
  });

  it('is offered to whoever acts for the attacker, and made with its one melee attack', async () => {
    as('DM', 'dm-1');
    h.listCombatActions.mockResolvedValue(listing(club, javelin));
    fight(offered);
    render(<TurnBar />);

    fireEvent.click(screen.getByRole('button', offer));

    await waitFor(() =>
      expect(h.resolveAttack).toHaveBeenCalledWith({ attackerId: 'ogre', targetId: 'hero', action: 0, opportunity: true })
    );
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('Greatclub vs Hero (AC 16): hit', 'success'));
  });

  it('asks which melee attack when there are several', async () => {
    as('DM', 'dm-1');
    h.listCombatActions.mockResolvedValue(listing(club, javelin, bite));
    fight(offered);
    render(<TurnBar />);

    fireEvent.click(screen.getByRole('button', offer));
    fireEvent.click(await screen.findByRole('button', { name: 'Bite' }));

    await waitFor(() =>
      expect(h.resolveAttack).toHaveBeenCalledWith({ attackerId: 'ogre', targetId: 'hero', action: 2, opportunity: true })
    );
    expect(screen.queryByRole('button', { name: 'Javelin' })).not.toBeInTheDocument();
  });

  it('is not offered to a player who does not control the attacker', () => {
    as('PLAYER', 'player-1');
    h.listCombatActions.mockResolvedValue(listing());
    fight(offered);
    render(<TurnBar />);
    expect(screen.queryByRole('button', offer)).not.toBeInTheDocument();
  });

  it('says why when the server refuses it', async () => {
    as('DM', 'dm-1');
    h.listCombatActions.mockResolvedValue(listing(club));
    h.resolveAttack.mockResolvedValue({ ok: false, error: 'Ogre has no Opportunity Attack to make against Hero' });
    fight(offered);
    render(<TurnBar />);

    fireEvent.click(screen.getByRole('button', offer));

    await waitFor(() =>
      expect(h.showToast).toHaveBeenCalledWith('Ogre has no Opportunity Attack to make against Hero', 'error')
    );
  });
});