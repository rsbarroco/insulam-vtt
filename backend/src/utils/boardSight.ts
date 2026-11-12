// ============================================
// Distance, line of sight and cover on a board with heights
//
// The same file in the browser (frontend/src/utils/boardSight.ts), which
// shows them while a token is carried over another, and on the server
// (backend/src/utils/boardSight.ts), which uses them to resolve an attack.
//
// The conventions are the ones written down in docs/TACTICAL_MODE.md
// ("Where the rules meet the board"):
//
//   • Cells use the token convention: x east, y north, from the bottom-left
//     cell. Heights are row-major from there: `heights[y * cols + x]`.
//   • A height step is half a square.
//   • Distance between two creatures is the squares between their nearest
//     edges, by the map's diagonal rule, or the difference in the height of
//     the ground they stand on if that is greater.
//   • A creature stands two height steps tall for each square of its size.
//     Four lines run from the top of the attacker to four heights on the
//     target. Ground that rises above a line blocks it.
//   • None blocked is no cover, one or two half cover, three three-quarters
//     cover, four total cover. Another creature in the way gives at least
//     half cover.
//
// Pure: no imports.
// ============================================

/** One whole-number height per cell. Null, or a cell outside it, is height 0. */
export interface BoardHeights {
  readonly cols: number;
  readonly rows: number;
  readonly heights: readonly number[];
}

/** A creature on the board: where its footprint starts and how large it is. */
export interface Standing {
  readonly cell: { readonly x: number; readonly y: number };
  readonly size: { readonly width: number; readonly height: number };
}

export type Cover = 'none' | 'half' | 'three-quarters' | 'total';

/** Height steps a creature stands tall, for each square of its size. */
export const BODY_STEPS_PER_SQUARE = 2;

/** Fractions of the target's height that the four sight lines aim at. */
const TARGET_HEIGHTS = [0.125, 0.375, 0.625, 0.875] as const;

/** How far apart samples along a sight line are, in squares. */
const SAMPLE_STEP = 0.1;

function cellHeight(heights: BoardHeights | null | undefined, x: number, y: number): number {
  if (!heights || x < 0 || y < 0 || x >= heights.cols || y >= heights.rows) return 0;
  return heights.heights[y * heights.cols + x] ?? 0;
}

/** The ground a footprint stands on: the tallest cell under it. */
export function standingGround(creature: Standing, heights: BoardHeights | null | undefined): number {
  let tallest = 0;
  for (let dy = 0; dy < creature.size.height; dy++) {
    for (let dx = 0; dx < creature.size.width; dx++) {
      tallest = Math.max(tallest, cellHeight(heights, creature.cell.x + dx, creature.cell.y + dy));
    }
  }
  return tallest;
}

function bodySteps(creature: Standing): number {
  return BODY_STEPS_PER_SQUARE * Math.max(creature.size.width, creature.size.height);
}

function centre(creature: Standing): { x: number; y: number } {
  return { x: creature.cell.x + creature.size.width / 2, y: creature.cell.y + creature.size.height / 2 };
}

function covers(creature: Standing, x: number, y: number): boolean {
  return (
    x >= creature.cell.x &&
    x < creature.cell.x + creature.size.width &&
    y >= creature.cell.y &&
    y < creature.cell.y + creature.size.height
  );
}

/** Squares between the nearest edges of two footprints along one axis. 0 when they overlap or touch. */
function gap(aStart: number, aLength: number, bStart: number, bLength: number): number {
  return Math.max(0, bStart - (aStart + aLength - 1), aStart - (bStart + bLength - 1));
}

/**
 * Feet between two creatures. Neighbours are one square apart; creatures
 * sharing a square are 0 apart.
 */
export function distanceFeet(
  a: Standing,
  b: Standing,
  board: {
    heights: BoardHeights | null | undefined;
    feetPerSquare: number;
    diagonalRule: 'flat' | 'alternating';
  }
): number {
  const dx = gap(a.cell.x, a.size.width, b.cell.x, b.size.width);
  const dy = gap(a.cell.y, a.size.height, b.cell.y, b.size.height);
  const diagonals = Math.min(dx, dy);
  const squares =
    Math.max(dx, dy) + (board.diagonalRule === 'alternating' ? Math.floor(diagonals / 2) : 0);
  const rise = Math.abs(standingGround(a, board.heights) - standingGround(b, board.heights));
  return Math.max(squares * board.feetPerSquare, (rise * board.feetPerSquare) / 2);
}

/**
 * The cover a target has from an attacker: what the ground between them
 * hides of it, and whether another creature stands in the way. `others` are
 * the creatures that can give cover; the attacker and the target are ignored
 * if they are among them.
 */
export function coverBetween(
  attacker: Standing,
  target: Standing,
  board: { heights: BoardHeights | null | undefined; others: readonly Standing[] }
): Cover {
  const from = centre(attacker);
  const to = centre(target);
  const eye = standingGround(attacker, board.heights) + bodySteps(attacker);
  const targetGround = standingGround(target, board.heights);
  const targetBody = bodySteps(target);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = Math.max(1, Math.ceil(length / SAMPLE_STEP));
  const others = board.others.filter((other) => other !== attacker && other !== target);

  let blocked = 0;
  let creatureInTheWay = false;
  for (const fraction of TARGET_HEIGHTS) {
    const aim = targetGround + targetBody * fraction;
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      // The ground the two stand on is theirs, not an obstacle between them.
      if (covers(attacker, cellX, cellY) || covers(target, cellX, cellY)) continue;
      if (others.some((other) => covers(other, cellX, cellY))) creatureInTheWay = true;
      if (cellHeight(board.heights, cellX, cellY) > eye + (aim - eye) * t) {
        blocked++;
        break;
      }
    }
  }

  if (blocked >= 4) return 'total';
  if (blocked === 3) return 'three-quarters';
  if (blocked >= 1 || creatureInTheWay) return 'half';
  return 'none';
}

/** Cover as a hint words it, with the bonus the rules give to Armor Class. */
export function coverLabel(cover: Cover): string {
  switch (cover) {
    case 'none':
      return 'no cover';
    case 'half':
      return 'half cover (+2 AC)';
    case 'three-quarters':
      return 'three-quarters cover (+5 AC)';
    case 'total':
      return 'total cover, cannot be targeted';
  }
}
