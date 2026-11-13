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
  standUp: vi.fn(),
  resolveCheck: vi.fn(),
  useFeature: vi.fn(),
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
  standUp: (...args: unknown[]) => h.standUp(...args),
  resolveCheck: (...args: unknown[]) => h.resolveCheck(...args),
  useFeature: (...args: unknown[]) => h.useFeature(...args),
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

describe('a Prone combatant', () => {
  const proneHero = { ...HERO, conditions: ['Prone'] } as Token;
  const withProneHero = (turn: Partial<TurnState> = {}) => {
    fight({ turn: { ...fresh, ...turn } });
    useGameStore.getState().setTokens([proneHero, OGRE]);
  };

  beforeEach(() => {
    h.emitTurnUpdate.mockReset();
    h.standUp.mockReset().mockResolvedValue({ ok: true });
    h.listCombatActions.mockResolvedValue({ ok: true, actions: [], attacksPerAction: null, features: [] });
  });

  it('stands up for half its Speed', async () => {
    as('PLAYER', 'player-1');
    withProneHero({ movementSpent: 5 });
    render(<TurnBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Stand up (15 ft)' }));

    await waitFor(() => expect(h.emitTurnUpdate).toHaveBeenCalledWith({ movementSpent: 20 }));
    expect(h.standUp).toHaveBeenCalledWith('hero');
  });

  it('cannot stand with less than half its Speed left', () => {
    as('PLAYER', 'player-1');
    withProneHero({ movementSpent: 20 });
    render(<TurnBar />);
    expect(screen.getByRole('button', { name: 'Stand up (15 ft)' })).toBeDisabled();
  });

  it('spends nothing when the server refuses', async () => {
    as('PLAYER', 'player-1');
    h.standUp.mockResolvedValue({ ok: false, error: 'Hero cannot stand up while its Speed is 0' });
    withProneHero();
    render(<TurnBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Stand up (15 ft)' }));

    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('Hero cannot stand up while its Speed is 0', 'error'));
    expect(h.emitTurnUpdate).not.toHaveBeenCalled();
  });

  it('stands a token with no speed set at no cost', async () => {
    as('DM', 'dm-1');
    fight();
    useGameStore.getState().setTokens([{ ...HERO, metadata: {}, conditions: ['Prone'] } as Token, OGRE]);
    render(<TurnBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Stand up' }));

    await waitFor(() => expect(h.standUp).toHaveBeenCalledWith('hero'));
    expect(h.emitTurnUpdate).not.toHaveBeenCalled();
  });

  it('is not offered a way up on its feet', () => {
    as('PLAYER', 'player-1');
    fight();
    render(<TurnBar />);
    expect(screen.queryByRole('button', { name: /^Stand up/ })).not.toBeInTheDocument();
  });
});

describe('a combatant whose conditions stop it', () => {
  it('has no movement while Grappled', () => {
    as('DM', 'dm-1');
    fight();
    useGameStore.getState().setTokens([{ ...HERO, conditions: ['Grappled'] } as Token, OGRE]);
    render(<TurnBar />);
    expect(screen.getByText('0 of 0 ft left')).toBeInTheDocument();
  });
});

describe('a Slowed combatant', () => {
  it('has 10 feet less to move', () => {
    as('DM', 'dm-1');
    fight({ marks: [{ kind: 'slow', attackerId: 'ogre', targetId: 'hero', turnEndsLeft: 1 }] });
    render(<TurnBar />);
    expect(screen.getByText('20 of 20 ft left')).toBeInTheDocument();
  });
});

describe('class features with uses', () => {
  const secondWind = { name: 'Second Wind', cost: 'bonusAction', text: 'As a Bonus Action, regain 1d10 + Fighter level.' };
  const listing = (resources: unknown[]) => ({ ok: true, actions: [], attacksPerAction: 1, features: [secondWind], resources });

  beforeEach(() => {
    h.useFeature.mockReset().mockResolvedValue({ ok: true, summary: 'Hero uses Second Wind: regains 9 Hit Points (1 use left)', left: 1 });
    h.emitTurnUpdate.mockReset();
  });

  it('uses Second Wind on the server, and shows the uses left', async () => {
    as('PLAYER', 'player-1');
    h.listCombatActions.mockResolvedValue(listing([{ name: 'Second Wind', max: 2, used: 0 }]));
    fight();
    render(<TurnBar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Features' }));
    expect(screen.getByText(/2\/2 left/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use Second Wind as a Bonus Action' }));

    await waitFor(() => expect(h.useFeature).toHaveBeenCalledWith('hero', 'Second Wind'));
    expect(h.emitTurnUpdate).not.toHaveBeenCalled();
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('Hero uses Second Wind: regains 9 Hit Points (1 use left)', 'success'));
  });

  it('turns a feature off with no uses left', async () => {
    as('PLAYER', 'player-1');
    h.listCombatActions.mockResolvedValue(listing([{ name: 'Second Wind', max: 2, used: 2 }]));
    fight();
    render(<TurnBar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Features' }));
    expect(screen.getByRole('button', { name: 'Use Second Wind as a Bonus Action' })).toBeDisabled();
  });

  it('offers Action Surge with its uses', async () => {
    as('PLAYER', 'player-1');
    h.listCombatActions.mockResolvedValue(listing([{ name: 'Action Surge', max: 1, used: 0 }]));
    fight();
    render(<TurnBar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Action Surge (1/1)' }));
    await waitFor(() => expect(h.useFeature).toHaveBeenCalledWith('hero', 'Action Surge'));
  });
});

describe('a barbarian', () => {
  beforeEach(() => {
    h.useFeature.mockReset().mockResolvedValue({ ok: true, summary: 'Hero enters a Rage', left: 2 });
  });

  it('enters a Rage with its uses, and can end it once raging', async () => {
    as('PLAYER', 'player-1');
    h.listCombatActions.mockResolvedValue({ ok: true, actions: [], attacksPerAction: 1, features: [], resources: [{ name: 'Rage', max: 3, used: 0 }] });
    fight();
    render(<TurnBar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rage (3/3)' }));
    await waitFor(() => expect(h.useFeature).toHaveBeenCalledWith('hero', 'Rage'));
  });

  it('offers End Rage while raging', async () => {
    as('PLAYER', 'player-1');
    h.listCombatActions.mockResolvedValue({ ok: true, actions: [], attacksPerAction: 1, features: [], resources: [{ name: 'Rage', max: 3, used: 1 }] });
    fight({ marks: [{ kind: 'rage', attackerId: 'hero', targetId: 'hero', turnEndsLeft: 2 }] });
    render(<TurnBar />);
    fireEvent.click(await screen.findByRole('button', { name: 'End Rage' }));
    await waitFor(() => expect(h.useFeature).toHaveBeenCalledWith('hero', 'End Rage'));
  });
});

describe('the features the server counts', () => {
  beforeEach(() => {
    h.useFeature.mockReset().mockResolvedValue({ ok: true, summary: 'Hero spends 1 Focus Point (3 left)', left: 3 });
  });

  it('shows a button for each with what is left, and spends one on a click', async () => {
    as('PLAYER', 'player-1');
    h.listCombatActions.mockResolvedValue({
      ok: true,
      actions: [],
      attacksPerAction: 1,
      features: [],
      resources: [
        { name: 'Focus Points', max: 4, used: 0 },
        { name: 'Channel Divinity', max: 2, used: 2 },
      ],
    });
    fight();
    render(<TurnBar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Focus Points (4/4)' }));
    await waitFor(() => expect(h.useFeature).toHaveBeenCalledWith('hero', 'Focus Points'));
    expect(screen.getByRole('button', { name: 'Channel Divinity (0/2)' })).toBeDisabled();
  });

  it('keeps a Bonus Action feature for a turn whose Bonus Action is left', async () => {
    as('PLAYER', 'player-1');
    h.listCombatActions.mockResolvedValue({
      ok: true,
      actions: [],
      attacksPerAction: 1,
      features: [],
      resources: [{ name: 'Bardic Inspiration', max: 3, used: 0 }],
    });
    fight({ turn: { movementSpent: 0, dashes: 0, action: null, bonusAction: true, attacks: 0 } });
    render(<TurnBar />);
    expect(await screen.findByRole('button', { name: 'Bardic Inspiration (3/3)' })).toBeDisabled();
  });
});

describe('a paladin', () => {
  beforeEach(() => {
    h.useFeature.mockReset().mockResolvedValue({ ok: true, summary: 'Hero uses Lay on Hands: Ogre regains 7 Hit Points (8 left)', left: 8 });
  });

  it('lays on hands: the creature and the Hit Points go to the server', async () => {
    as('PLAYER', 'player-1');
    h.listCombatActions.mockResolvedValue({
      ok: true,
      actions: [],
      attacksPerAction: 1,
      features: [],
      resources: [{ name: 'Lay on Hands', max: 15, used: 0 }],
    });
    fight();
    render(<TurnBar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lay on Hands (15/15)' }));
    fireEvent.change(screen.getByLabelText('Creature touched'), { target: { value: 'ogre' } });
    fireEvent.change(screen.getByLabelText('Hit Points to restore'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Heal' }));
    await waitFor(() => expect(h.useFeature).toHaveBeenCalledWith('hero', 'Lay on Hands', 7, { targetId: 'ogre' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lay on Hands (15/15)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cure Poisoned' }));
    await waitFor(() => expect(h.useFeature).toHaveBeenCalledWith('hero', 'Lay on Hands', 7, { targetId: 'ogre', cure: 'Poisoned' }));
  });
});
