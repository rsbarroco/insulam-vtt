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
  })
  .strict()
  .refine((attack) => attack.attackerId !== attack.targetId, { message: 'A creature cannot attack itself' });
