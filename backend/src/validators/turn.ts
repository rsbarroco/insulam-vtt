// ============================================
// What a client may send about a turn in combat
// ============================================

import { z } from 'zod';
import { TURN_LIMITS } from './turnLimits';

const feet = z
  .number({ error: 'Movement must be a number of feet' })
  .min(0, 'Movement cannot be below 0')
  .max(TURN_LIMITS.maxMovementFeet, `Movement cannot be above ${TURN_LIMITS.maxMovementFeet} feet`)
  // Half feet come from climbing a height step of half a square.
  .multipleOf(0.5, 'Movement is counted in half feet');

/**
 * `turn.update`: any of the acting combatant's turn fields, and optionally
 * one combatant's reaction. At least one of them.
 */
export const TurnUpdateSchema = z
  .object({
    movementSpent: feet.optional(),
    dashes: z.number().int().min(0).max(TURN_LIMITS.maxDashes).optional(),
    action: z.string().trim().min(1).max(TURN_LIMITS.maxActionNameLength).nullable().optional(),
    bonusAction: z.boolean().optional(),
    attacks: z.number().int().min(0).max(TURN_LIMITS.maxAttacks).optional(),
    reaction: z.object({ tokenId: z.string().uuid('A combatant is named by its token id'), spent: z.boolean() }).optional(),
  })
  .strict()
  .refine((update) => Object.values(update).some((value) => value !== undefined), {
    message: 'A turn update must change something',
  });

export type TurnUpdate = z.infer<typeof TurnUpdateSchema>;

/** `turn.end`: the combatant whose turn is ending. */
export const TurnEndSchema = z.object({ tokenId: z.string().uuid('A combatant is named by its token id') }).strict();
