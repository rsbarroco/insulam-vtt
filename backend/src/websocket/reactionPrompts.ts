// ============================================
// Asking a creature's player whether it takes a reaction, as the rules say
//
// Some features are chosen once the roll is known: a Rogue's Uncanny Dodge
// after an attack hits it, a Fighter's Indomitable after it fails a save. The
// server resolving the roll stops, asks whoever controls the creature (its
// player, or the DM for a token no player controls) with `combat.prompt`, and
// waits for `combat.react`. No answer before the time runs out, or nobody
// there to ask, is a refusal: the roll goes on without the feature.
//
// The question is open for one answer: the first one closes it, and every
// member hears `combat.promptClosed` so a prompt still on screen goes away.
// ============================================

import { randomUUID } from 'crypto';
import type { Server } from 'socket.io';
import type { AuthenticatedFields } from './auth';
import { campaignSockets } from './utils';
import { canControlToken } from '../services/permissions';

/** How long a player has to answer, by default. */
export const PROMPT_TIMEOUT_MS = 30_000;
let timeoutMs = PROMPT_TIMEOUT_MS;

/** For tests: how long a prompt waits for its answer. */
export function setPromptTimeout(ms: number): void {
  timeoutMs = ms;
}

interface Pending {
  campaignId: string;
  controlledBy: string | null;
  options: readonly string[];
  finish: (choice: string | null) => void;
}

const pending = new Map<string, Pending>();

export interface PromptRequest {
  token: { id: string; name: string; controlledBy?: string | null };
  /** What it is asked: "Ogre hits Hero for 14 bludgeoning damage." */
  text: string;
  /** The features it may use, by name; the answer is one of them or none. */
  options: readonly string[];
}

/**
 * Ask whoever controls the token which of the options it uses, and wait for
 * the answer: one of the options, or null for none (also when nobody answers
 * in time, or nobody who could is connected).
 */
export async function askReaction(io: Server, campaignId: string, request: PromptRequest): Promise<string | null> {
  if (request.options.length === 0) return null;
  const controlledBy = request.token.controlledBy ?? null;
  const members = await campaignSockets(io, campaignId);
  const askable = members.filter((member) => {
    const fields = member as unknown as AuthenticatedFields;
    // A token a player controls is that player's to answer for; any other, the DM's.
    return controlledBy ? fields.userId === controlledBy : fields.role === 'DM';
  });
  if (askable.length === 0) return null;
  const promptId = randomUUID();
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => close(null), timeoutMs);
    const close = (choice: string | null) => {
      if (!pending.has(promptId)) return;
      pending.delete(promptId);
      clearTimeout(timer);
      io.to(campaignId).emit('combat.promptClosed', { promptId, choice });
      resolve(choice);
    };
    pending.set(promptId, { campaignId, controlledBy, options: request.options, finish: close });
    const offer = {
      promptId,
      tokenId: request.token.id,
      tokenName: request.token.name,
      text: request.text,
      options: [...request.options],
      expiresInMs: timeoutMs,
    };
    for (const member of askable) member.emit('combat.prompt', offer);
  });
}

/** An answer to a prompt from a member: refused when the prompt is gone or the member may not answer for the token. */
export function answerPrompt(
  member: { campaignId?: string; role?: string; userId?: string },
  promptId: string,
  choice: string | null
): { ok: true } | { ok: false; error: string } {
  const open = pending.get(promptId);
  if (!open || open.campaignId !== member.campaignId) return { ok: false, error: 'That question is no longer open' };
  if (!canControlToken(member.role, open.controlledBy, member.userId)) {
    return { ok: false, error: 'You can only answer for your own token' };
  }
  if (choice !== null && !open.options.includes(choice)) return { ok: false, error: 'That is not one of the choices' };
  open.finish(choice);
  return { ok: true };
}

/** For tests: forget every open prompt. */
export function clearPrompts(): void {
  for (const open of [...pending.values()]) open.finish(null);
}
