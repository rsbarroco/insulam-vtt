/**
 * The acting combatant's turn in the stored combat state.
 *
 * Who is shown a turn, what a new turn starts with, and that the state stays
 * consistent however it is handed in. No database.
 */

import {
  advanceTurn,
  clearState,
  freshTurn,
  getState,
  projectCombatState,
  setState,
  withoutCombatants,
  type CombatState,
  type CombatantEntry,
} from '../initiativeState';

const entry = (tokenId: string): CombatantEntry => ({
  tokenId, mapId: 'map-1', name: tokenId, imageUrl: '', initiative: 10, hp: null, type: 'npc', disposition: null,
});
const token = (id: string) => ({ id, name: id, imageUrl: '' });
const spent = { movementSpent: 15, dashes: 1, action: 'Dash', bonusAction: true, attacks: 0 };
const fight = (over: Partial<CombatState> = {}): CombatState => ({
  active: true, round: 1, currentTokenId: 'a', combatants: [entry('a'), entry('b'), entry('c')],
  turn: { ...spent }, reactionsSpent: ['b', 'c'], dodging: [], opportunities: [], marks: [], ...over,
});

describe('freshTurn', () => {
  it('has nothing spent', () => {
    expect(freshTurn()).toEqual({ movementSpent: 0, dashes: 0, action: null, bonusAction: false, attacks: 0 });
  });
});

describe('advanceTurn', () => {
  it('passes to the next combatant with a fresh turn', () => {
    const state = fight();
    advanceTurn(state);
    expect(state.currentTokenId).toBe('b');
    expect(state.round).toBe(1);
    expect(state.turn).toEqual(freshTurn());
  });

  it('ends a Sap or Slow when the turn of the one who made it begins', () => {
    // a acts now; b's turn is next.
    const state = fight({
      marks: [
        { kind: 'sap', attackerId: 'b', targetId: 'a', turnEndsLeft: 1 },
        { kind: 'slow', attackerId: 'c', targetId: 'a', turnEndsLeft: 1 },
      ],
    });
    advanceTurn(state);
    expect(state.marks).toEqual([{ kind: 'slow', attackerId: 'c', targetId: 'a', turnEndsLeft: 1 }]);
  });

  it('ends a Help or a readied attack when its maker’s next turn begins', () => {
    const state = fight({
      marks: [
        { kind: 'help', attackerId: 'b', targetId: 'c', turnEndsLeft: 1 },
        { kind: 'ready', attackerId: 'b', targetId: 'a', turnEndsLeft: 1 },
      ],
    });
    advanceTurn(state); // b's turn begins
    expect(state.marks).toEqual([]);
  });

  it('keeps a Vex to the end of its maker’s next turn', () => {
    const state = fight({ marks: [{ kind: 'vex', attackerId: 'a', targetId: 'b', turnEndsLeft: 2 }] });
    advanceTurn(state); // a's turn ends: one left
    expect(state.marks).toEqual([{ kind: 'vex', attackerId: 'a', targetId: 'b', turnEndsLeft: 1 }]);
    advanceTurn(state); // b's turn ends
    advanceTurn(state); // c's turn ends; a's begins
    expect(state.marks).toHaveLength(1);
    advanceTurn(state); // a's next turn ends
    expect(state.marks).toEqual([]);
  });

  it('ends the Dodge of the combatant whose turn begins, and nobody else’s', () => {
    const state = fight({ dodging: ['a', 'b'] });
    advanceTurn(state);
    expect(state.dodging).toEqual(['a']);
  });

  it('gives the combatant whose turn begins its reaction back, and nobody else', () => {
    const state = fight();
    advanceTurn(state);
    expect(state.reactionsSpent).toEqual(['c']);
  });

  it('starts a new round after the last combatant', () => {
    const state = fight({ currentTokenId: 'c' });
    advanceTurn(state);
    expect(state.currentTokenId).toBe('a');
    expect(state.round).toBe(2);
  });
});

describe('projectCombatState', () => {
  const everyone = new Map([['a', token('a')], ['b', token('b')], ['c', token('c')]]);

  it('shows the turn and the spent reactions to someone who sees every combatant', () => {
    const seen = projectCombatState(fight(), everyone, false);
    expect(seen.turn).toEqual(spent);
    expect(seen.reactionsSpent).toEqual(['b', 'c']);
  });

  it('hides the turn of an acting combatant the recipient is not shown', () => {
    const seen = projectCombatState(fight(), new Map([['b', token('b')]]), false);
    expect(seen.currentTokenId).toBeNull();
    expect(seen.turn).toBeNull();
  });

  it('hides the spent reaction of a combatant the recipient is not shown', () => {
    const seen = projectCombatState(fight(), new Map([['a', token('a')], ['b', token('b')]]), false);
    expect(seen.reactionsSpent).toEqual(['b']);
  });

  it('leaves the stored state untouched', () => {
    const state = fight();
    const before = JSON.stringify(state);
    projectCombatState(state, new Map([['b', token('b')]]), false);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('setState', () => {
  const campaignId = 'turn-state-test';
  afterEach(() => clearState(campaignId));

  it('gives an acting combatant a turn when none is handed in', () => {
    setState(campaignId, { active: true, round: 1, currentTokenId: 'a', combatants: [entry('a')] });
    expect(getState(campaignId).turn).toEqual(freshTurn());
    expect(getState(campaignId).reactionsSpent).toEqual([]);
  });

  it('keeps no turn when nobody is acting', () => {
    setState(campaignId, { ...fight(), active: false });
    expect(getState(campaignId).turn).toBeNull();
    setState(campaignId, { ...fight(), currentTokenId: null });
    expect(getState(campaignId).turn).toBeNull();
  });

  it('forgets the spent reaction of a combatant no longer in the order', () => {
    setState(campaignId, fight({ combatants: [entry('a'), entry('b')] }));
    expect(getState(campaignId).reactionsSpent).toEqual(['b']);
  });
});

describe('withoutCombatants', () => {
  it('keeps the turn when someone else leaves', () => {
    const next = withoutCombatants(fight(), (c) => c.tokenId === 'c')!;
    expect(next.currentTokenId).toBe('a');
    expect(next.turn).toEqual(spent);
    expect(next.reactionsSpent).toEqual(['b']);
  });

  it('starts a fresh turn, reaction included, for whoever takes over from the one that left', () => {
    const next = withoutCombatants(fight(), (c) => c.tokenId === 'a')!;
    expect(next.currentTokenId).toBe('b');
    expect(next.turn).toEqual(freshTurn());
    expect(next.reactionsSpent).toEqual(['c']);
  });
});
