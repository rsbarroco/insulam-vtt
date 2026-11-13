// ============================================
// Undoing the last combat actions the server resolved
//
// Before an attack, a save, a heal, a fall or a class feature changes
// anything, its handler takes a snapshot of what it may change: the Hit
// Points and conditions of the tokens on the map, the sheets of the
// characters involved, and the combat state (turn, marks, reactions). Once
// the action is done the snapshot is kept, with the action's log line, five
// at most for each campaign. The DM's `combat.undo` puts the last one back.
//
// Only what was snapshot is restored: a token moved since stays where it is,
// and a sheet's other changes since the action are lost with it, which is
// why it is the DM's and the last action's.
// ============================================

import { prisma } from '../config/database';
import { readTokens, toJson } from '../utils/prisma-json';
import { withMapsLocked } from '../utils/mapTokens';
import { getState, setState, type CombatState } from './initiativeState';

export interface CombatSnapshot {
  mapId: string;
  tokens: Array<{ id: string; hp: unknown; conditions: unknown }>;
  characters: Array<{ id: string; data: unknown }>;
  combat: CombatState;
  summary: string;
}

const KEPT = 5;
const history = new Map<string, CombatSnapshot[]>();

/** What an action may change, read before it changes it; null when there is no map to read. */
export async function prepareUndo(
  campaignId: string,
  mapId: string,
  characterIds: ReadonlyArray<string | null | undefined>
): Promise<Omit<CombatSnapshot, 'summary'> | null> {
  const map = await prisma.map.findUnique({ where: { id: mapId }, select: { tokens: true } });
  if (!map) return null;
  const ids = [...new Set(characterIds.filter((id): id is string => typeof id === 'string'))];
  const characters =
    ids.length > 0
      ? await prisma.character.findMany({
          where: { id: { in: ids }, campaignId },
          select: { id: true, data: true },
        })
      : [];
  return {
    mapId,
    tokens: readTokens(map.tokens).map((token) => ({
      id: token.id,
      hp: token.hp ?? null,
      conditions: token.conditions ?? [],
    })),
    characters: characters.map((character) => ({ id: character.id, data: character.data })),
    combat: structuredClone(getState(campaignId)),
  };
}

/** Keep a done action's snapshot, with its log line, as the one to undo first. */
export function commitUndo(
  campaignId: string,
  snapshot: Omit<CombatSnapshot, 'summary'> | null,
  summary: string
): void {
  if (!snapshot) return;
  const kept = history.get(campaignId) ?? [];
  history.set(campaignId, [...kept, { ...snapshot, summary }].slice(-KEPT));
}

/** The last kept action, taken off the list; null when there is none. */
export function takeLastUndo(campaignId: string): CombatSnapshot | null {
  const kept = history.get(campaignId) ?? [];
  const last = kept.pop() ?? null;
  history.set(campaignId, kept);
  return last;
}

/** How many actions can be undone, for the bar. */
export function undoCount(campaignId: string): number {
  return history.get(campaignId)?.length ?? 0;
}

/** Forget a campaign's actions, as when its combat state is forgotten. */
export function clearUndo(campaignId: string): void {
  history.delete(campaignId);
}

/**
 * Put a snapshot back: the tokens' Hit Points and conditions on its map (the
 * tokens still there), the characters' sheets, and the combat state. Answers
 * the map and the characters as they are after, for the caller to send.
 */
export async function restoreSnapshot(campaignId: string, snapshot: CombatSnapshot) {
  const map = await withMapsLocked([snapshot.mapId], async (tx) => {
    const fresh = await tx.map.findUnique({ where: { id: snapshot.mapId } });
    if (!fresh) return null;
    const list = readTokens(fresh.tokens).map((token) => {
      const was = snapshot.tokens.find((entry) => entry.id === token.id);
      return was
        ? { ...token, hp: was.hp as typeof token.hp, conditions: was.conditions as string[] }
        : token;
    });
    return tx.map.update({ where: { id: snapshot.mapId }, data: { tokens: toJson(list) } });
  });
  const characters = [];
  for (const character of snapshot.characters) {
    const updated = await prisma.character
      .update({ where: { id: character.id }, data: { data: toJson(character.data) } })
      .catch(() => null);
    if (updated) characters.push(updated);
  }
  // The fight's state goes back only while that fight goes on: an undo after it ended does not start it again.
  if (getState(campaignId).active && snapshot.combat.active) setState(campaignId, snapshot.combat);
  return { map, characters };
}
