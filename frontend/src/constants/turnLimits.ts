// ============================================
// Limits on a turn in combat
//
// The same file in the browser (frontend/src/constants/turnLimits.ts) and on
// the server (backend/src/validators/turnLimits.ts): the server refuses a
// turn update past them, and the action bar never sends one.
// ============================================

export const TURN_LIMITS = {
  /** Feet of movement one turn may record. */
  maxMovementFeet: 10000,
  /** Times Dash may be recorded in one turn. */
  maxDashes: 10,
  /** Characters in the name of the action taken. */
  maxActionNameLength: 40,
} as const;
