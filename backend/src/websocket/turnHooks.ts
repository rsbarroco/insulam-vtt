// ============================================
// What happens as a combatant's turn ends
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
