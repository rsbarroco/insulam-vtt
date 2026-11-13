// ============================================
// What happens as a combatant's turn ends, and as the next one starts
//
// The initiative handlers pass the turn on; what the rules make happen at
// the end of a creature's turn (a save it repeats against a condition) is
// the combat handlers'. They register here, and the initiative handlers run
// what is registered before the turn passes, so neither imports the other.
// ============================================

import type { Server } from 'socket.io';
import type { AuthenticatedSocket } from './auth';
import { bestEffort } from './utils';

export type TurnEndHook = (
  io: Server,
  socket: AuthenticatedSocket,
  campaignId: string,
  tokenId: string
) => Promise<void>;

const hooks: TurnEndHook[] = [];
const startHooks: TurnEndHook[] = [];

/** Run `hook` each time a combatant's turn starts, once it is the one acting. */
export function onTurnStart(hook: TurnEndHook): void {
  if (!startHooks.includes(hook)) startHooks.push(hook);
}

/** Everything registered for the start of `tokenId`'s turn. */
export async function runTurnStart(io: Server, socket: AuthenticatedSocket, campaignId: string, tokenId: string): Promise<void> {
  for (const hook of startHooks) await bestEffort('the start of a turn', () => hook(io, socket, campaignId, tokenId));
}

/** Run `hook` each time a combatant's turn ends, before the next one starts. */
export function onTurnEnd(hook: TurnEndHook): void {
  if (!hooks.includes(hook)) hooks.push(hook);
}

/** Everything registered for the end of `tokenId`'s turn; a hook that fails does not stop the turn passing. */
export async function runTurnEnd(
  io: Server,
  socket: AuthenticatedSocket,
  campaignId: string,
  tokenId: string
): Promise<void> {
  for (const hook of hooks)
    await bestEffort('the end of a turn', () => hook(io, socket, campaignId, tokenId));
}
