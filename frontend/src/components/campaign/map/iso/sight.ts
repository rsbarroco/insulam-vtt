// ============================================
// Distance, line of sight and cover on the tactical board
//
// The maths is shared with the server, which uses it to resolve an attack:
// see utils/boardSight.ts, kept identical in both projects.
// ============================================

export {
  BODY_STEPS_PER_SQUARE,
  coverBetween,
  coverLabel,
  distanceFeet,
  type Cover,
  type Standing,
} from '@/utils/boardSight';
