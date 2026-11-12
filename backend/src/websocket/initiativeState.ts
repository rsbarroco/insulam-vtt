/**
 * Initiative State Manager
 * In-memory store for per-campaign combat state.
 *
 * Why in-memory instead of DB?
 * Initiative order is ephemeral combat data that resets between combats.
 * Token initiative *values* are persisted via the token.initiative field in the
 * Map.tokens JSON (updated through the existing token update path).
 * The round counter and active combatant are transient and intentionally lost
 * on server restart — the DM can simply start a new combat.
 */

export interface CombatantEntry {
  tokenId: string;
  /** The map the token is on, so a send can look the token up as it is now. */
  mapId: string;
  name: string;
  imageUrl: string;
  initiative: number | null;
  hp: { current: number; max: number; temp: number } | null;
  type: 'player' | 'npc' | 'object';
  disposition: 'friendly' | 'neutral' | 'hostile' | null;
}

/**
 * What the acting combatant has spent of its turn, by the D&D rules: its
 * movement, its action and its bonus action. The server keeps the count and
 * does not enforce it; the table sees what is left.
 */
export interface TurnState {
  /** Feet of movement spent this turn. */
  movementSpent: number;
  /** Times it has taken the Dash action this turn; each adds its speed to its movement. */
  dashes: number;
  /** The action taken this turn, by name, or null while it still has one. */
  action: string | null;
  /** Whether the bonus action is spent. */
  bonusAction: boolean;
}

export interface CombatState {
  active: boolean;
  round: number;
  /** tokenId of the currently-acting combatant, null if combat not started */
  currentTokenId: string | null;
  /** Ordered list of combatants (descending by initiative) */
  combatants: CombatantEntry[];
  /** The acting combatant's turn so far; null when nobody is acting. */
  turn: TurnState | null;
  /** tokenIds whose reaction is spent. A combatant's comes back at the start of its turn. */
  reactionsSpent: string[];
}

/** Whether a fight is under way with a combatant acting. */
export function someoneActing(state: CombatState): boolean {
  return state.active && state.currentTokenId !== null;
}

/** A turn with nothing spent. */
export function freshTurn(): TurnState {
  return { movementSpent: 0, dashes: 0, action: null, bonusAction: false };
}

/**
 * Pass the turn to the next combatant in the order, into a new round after
 * the last. The one whose turn begins has a fresh turn and its reaction
 * back. Changes `state`; the caller stores it.
 */
export function advanceTurn(state: CombatState): void {
  const nextIndex = state.combatants.findIndex((c) => c.tokenId === state.currentTokenId) + 1;
  if (nextIndex >= state.combatants.length) {
    state.round += 1;
    state.currentTokenId = state.combatants[0].tokenId;
  } else {
    state.currentTokenId = state.combatants[nextIndex].tokenId;
  }
  state.turn = freshTurn();
  state.reactionsSpent = state.reactionsSpent.filter((tokenId) => tokenId !== state.currentTokenId);
}

const campaignStates = new Map<string, CombatState>();

/**
 * How many times each campaign's state has been replaced. A send reads the
 * state, then the combatants' tokens and each player's plane, before it
 * emits; a change that lands meanwhile starts its own send with the newer
 * state, and the older send checks this before emitting so it never arrives
 * after the newer one. Ending the fight is the case that bit: its send has
 * nothing to look up and finished first, and the earlier send then showed
 * every client a fight that had ended.
 */
const versions = new Map<string, number>();

function bump(campaignId: string): void {
  versions.set(campaignId, (versions.get(campaignId) ?? 0) + 1);
}

export function getVersion(campaignId: string): number {
  return versions.get(campaignId) ?? 0;
}

/**
 * Sends of the whole order to a campaign, numbered as they start. The
 * version above changes only with the order itself, but a send also carries
 * each combatant's token as it is now, and a token change (hit points, a
 * hidden creature) starts a send without changing the order. A send that a
 * later whole-campaign send has started behind is dropped, since the later
 * one reads newer tokens and reaches everyone.
 */
const sends = new Map<string, number>();

/** Number a send of the whole order to the campaign as it starts. */
export function startSend(campaignId: string): number {
  const next = (sends.get(campaignId) ?? 0) + 1;
  sends.set(campaignId, next);
  return next;
}

/** The number of the most recent whole-campaign send to have started. */
export function latestSend(campaignId: string): number {
  return sends.get(campaignId) ?? 0;
}

function defaultState(): CombatState {
  return {
    active: false,
    round: 0,
    currentTokenId: null,
    combatants: [],
    turn: null,
    reactionsSpent: [],
  };
}

export function getState(campaignId: string): CombatState {
  return campaignStates.get(campaignId) ?? defaultState();
}

/** A combat state as it may be handed in: the turn fields may be left out. */
export type CombatStateInput = Omit<CombatState, 'turn' | 'reactionsSpent'> &
  Partial<Pick<CombatState, 'turn' | 'reactionsSpent'>>;

export function setState(campaignId: string, input: CombatStateInput): void {
  const listed = new Set(input.combatants.map((c) => c.tokenId));
  // What is stored always holds together: somebody acting has a turn, nobody
  // acting has none, and only combatants in the order have a spent reaction.
  const state: CombatState = {
    ...input,
    turn: input.active && input.currentTokenId ? (input.turn ?? freshTurn()) : null,
    reactionsSpent: (input.reactionsSpent ?? []).filter((tokenId) => listed.has(tokenId)),
  };
  campaignStates.set(campaignId, state);
  bump(campaignId);
  // A combatant that has left the order may be rolled for again when it
  // comes back.
  const rolled = playerRolls.get(campaignId);
  if (rolled) {
    for (const tokenId of rolled) {
      if (!state.combatants.some((c) => c.tokenId === tokenId)) rolled.delete(tokenId);
    }
  }
}

/** Forget every campaign's combat state, after a restore replaces the database under it. */
export function clearAllState(): void {
  for (const campaignId of campaignStates.keys()) bump(campaignId);
  campaignStates.clear();
  playerRolls.clear();
}

export function clearState(campaignId: string): void {
  campaignStates.delete(campaignId);
  playerRolls.delete(campaignId);
  bump(campaignId);
}

/**
 * The combatants a player has rolled initiative for, by campaign. A player
 * rolls once each time their token joins the order: rolling again until a
 * good number came up was open to anyone. The DM can still change the
 * number. Kept apart from the state, which is sent to clients as it is; a
 * combatant leaving the order, or the fight ending, forgets its roll.
 */
const playerRolls = new Map<string, Set<string>>();

/** Whether a player has rolled for this combatant in this fight. */
export function playerHasRolled(campaignId: string, tokenId: string): boolean {
  return playerRolls.get(campaignId)?.has(tokenId) ?? false;
}

/** Record a player's roll for a combatant, or take it back (`rolled` false) when it did not happen. */
export function markPlayerRolled(campaignId: string, tokenId: string, rolled = true): void {
  let marks = playerRolls.get(campaignId);
  if (!marks) {
    if (!rolled) return;
    marks = new Set();
    playerRolls.set(campaignId, marks);
  }
  if (rolled) marks.add(tokenId);
  else marks.delete(tokenId);
}

/**
 * Drop the combatants `gone` names, when a token or a whole map is deleted.
 * An entry whose token is gone used to linger for the DM (the projection kept
 * the copy taken when it joined) while players no longer saw it, so the two
 * disagreed about the order. Returns whether anything was dropped.
 */
export function removeCombatants(campaignId: string, gone: (entry: CombatantEntry) => boolean): boolean {
  const next = withoutCombatants(getState(campaignId), gone);
  if (!next) return false;
  setState(campaignId, next);
  return true;
}

/**
 * The order without the combatants `gone` picks, or null when it picks none.
 * If the acting combatant is among them the turn passes on as Next would: to
 * the first one after them who stays, or round to the top of the order in a
 * new round. With nobody left the fight is over: an active round with no
 * combatants can be neither advanced nor ended, since the tracker draws
 * those controls beside a combatant and the server refuses Next and Start on
 * an empty order. The tracker's Remove and a deleted token both go through
 * this.
 */
export function withoutCombatants(state: CombatState, gone: (entry: CombatantEntry) => boolean): CombatState | null {
  const kept = state.combatants.filter((c) => !gone(c));
  if (kept.length === state.combatants.length) return null;
  if (kept.length === 0) return defaultState();
  let { currentTokenId, round } = state;
  const currentIndex = state.combatants.findIndex((c) => c.tokenId === currentTokenId);
  if (currentIndex !== -1 && gone(state.combatants[currentIndex])) {
    const after = state.combatants.slice(currentIndex + 1).find((c) => !gone(c));
    if (after) {
      currentTokenId = after.tokenId;
    } else {
      currentTokenId = kept[0].tokenId;
      if (state.active) round += 1;
    }
  }
  // The turn passed on with the combatant that left: the one now acting
  // starts its own, with its reaction back.
  const passedOn = currentTokenId !== state.currentTokenId;
  return {
    ...state,
    combatants: kept,
    currentTokenId,
    round,
    turn: passedOn ? freshTurn() : state.turn,
    reactionsSpent: state.reactionsSpent.filter(
      (tokenId) => kept.some((c) => c.tokenId === tokenId) && !(passedOn && tokenId === currentTokenId)
    ),
  };
}

/**
 * A sorted copy: descending initiative, the unrolled last. Ties keep the order
 * the combatants were added in (the sort is stable). A tie broken by name
 * would tell a player where an obscured combatant's real name falls in the
 * alphabet; the order of adding says nothing.
 */
export function sortCombatants(combatants: CombatantEntry[]): CombatantEntry[] {
  return [...combatants].sort((a, b) => {
    if (a.initiative === null) return b.initiative === null ? 0 : 1;
    if (b.initiative === null) return -1;
    return b.initiative - a.initiative;
  });
}

/** The fields of a map token a combatant is read from. */
export interface CombatantSource {
  id: string;
  name: string;
  imageUrl: string;
  hp?: { current: number; max: number; temp: number } | null;
  type?: 'player' | 'npc' | 'object';
  disposition?: 'friendly' | 'neutral' | 'hostile' | null;
}

/**
 * The state as one recipient may see it. Entries follow their tokens: a
 * player is given only the combatants the role filter keeps for them, with
 * the name, picture and hit points exactly as that token is sent to them
 * (the filter has already dropped hidden and off-plane tokens and the hit
 * points they may not know). The lighting rule is not applied here: the
 * order is public once the DM adds a token to it, so a combatant out of a
 * player's sight on a lit or fogged map is still listed, and hiding the
 * token is what keeps it out. The DM gets every combatant with the token as
 * it is now, and the copy taken when it joined if the token is gone. The
 * stored state is not changed.
 */
export function projectCombatState(
  state: CombatState,
  tokens: ReadonlyMap<string, CombatantSource>,
  isDM: boolean
): CombatState {
  const combatants: CombatantEntry[] = [];
  for (const entry of state.combatants) {
    const token = tokens.get(entry.tokenId);
    if (!token) {
      if (isDM) combatants.push({ ...entry });
      continue;
    }
    combatants.push({
      ...entry,
      name: token.name,
      imageUrl: token.imageUrl || '',
      hp: token.hp ?? null,
      type: token.type ?? 'npc',
      disposition: token.disposition ?? null,
    });
  }
  const currentTokenId = combatants.some((c) => c.tokenId === state.currentTokenId) ? state.currentTokenId : null;
  // A turn belongs to the acting combatant, so a recipient who is not shown
  // that combatant is not shown its turn either; likewise a spent reaction.
  const listed = new Set(combatants.map((c) => c.tokenId));
  return {
    active: state.active,
    round: state.round,
    currentTokenId,
    combatants,
    turn: currentTokenId ? state.turn : null,
    reactionsSpent: state.reactionsSpent.filter((tokenId) => listed.has(tokenId)),
  };
}
