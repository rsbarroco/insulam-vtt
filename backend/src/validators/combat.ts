// ============================================
// What a client may send to resolve combat
// ============================================

import { z } from 'zod';

const tokenId = z.string().uuid('A creature is named by its token id');

/** `combat.actions`: whose actions to list. */
export const CombatActionsSchema = z.object({ tokenId }).strict();

/** `combat.attack`: one attack from one token against another. */
export const CombatAttackSchema = z
  .object({
    attackerId: tokenId,
    targetId: tokenId,
    /** Which of the attacker's actions, by its place in the list `combat.actions` gave. */
    action: z.number().int().min(0).max(199),
    /** Advantage or Disadvantage the table grants beyond what the server can see. */
    mode: z.enum(['normal', 'advantage', 'disadvantage']).optional(),
    /** The level of the spell slot a spell is cast with; the spell's own when left out. */
    slotLevel: z.number().int().min(1).max(9).optional(),
    /** The Opportunity Attack the target's movement offered this attacker: its reaction, not its action. */
    opportunity: z.literal(true).optional(),
  })
  .strict()
  .refine((attack) => attack.attackerId !== attack.targetId, { message: 'A creature cannot attack itself' });

/** `combat.save`: an action that calls for a saving throw, against one or more tokens. */
export const CombatSaveSchema = z
  .object({
    sourceId: tokenId,
    targetIds: z.array(tokenId).min(1).max(30),
    /** Which of the creature's actions, by its place in the list `combat.actions` gave. */
    action: z.number().int().min(0).max(199),
    /** The level of the spell slot a spell is cast with; the spell's own when left out. */
    slotLevel: z.number().int().min(1).max(9).optional(),
  })
  .strict()
  .refine((save) => new Set(save.targetIds).size === save.targetIds.length, { message: 'A target is named twice' });

/** `combat.deathSave`: the token whose character rolls a death saving throw. */
export const CombatDeathSaveSchema = z.object({ tokenId }).strict();
