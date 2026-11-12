// ============================================
// Areas of effect on the board
//
// Which squares a Sphere, Cone, Cube, Line, Cylinder or Emanation covers,
// for an effect a creature aims at another creature. The conventions, also
// in docs/TACTICAL_MODE.md ("Where the rules meet the board"):
//
//   • A square is in an area when its centre is.
//   • A Sphere or Cylinder is centred on the middle of the aimed creature,
//     and reaches its radius from there.
//   • A Cone and a Line start at the middle of the caster and point at the
//     middle of the aimed creature. A Cone is as wide as it is long at every
//     distance; a Line is one square wide. Neither covers the caster's own
//     squares.
//   • A Cube is placed with the aimed creature at its centre.
//   • An Emanation reaches its size from the caster's edges, and does not
//     cover the caster's own squares.
//   • Heights are not counted: an area covers the column over each square.
//
// Pure: no imports beyond the Standing type.
// ============================================

import type { Standing } from './boardSight';

export interface AreaOfEffect {
  shape: 'sphere' | 'cone' | 'cube' | 'line' | 'cylinder' | 'emanation';
  /** Radius of a sphere, cylinder or emanation; length of a cone, cube or line. In feet. */
  sizeFeet: number;
}

export interface AreaBoard {
  cols: number;
  rows: number;
  feetPerSquare: number;
}

const centreOf = (creature: Standing) => ({
  x: creature.cell.x + creature.size.width / 2,
  y: creature.cell.y + creature.size.height / 2,
});

const inside = (creature: Standing, x: number, y: number) =>
  x >= creature.cell.x &&
  y >= creature.cell.y &&
  x < creature.cell.x + creature.size.width &&
  y < creature.cell.y + creature.size.height;

/** A hair, so a centre exactly on the edge counts as in. */
const EPSILON = 1e-6;

/** The squares an area covers, as `x,y` keys, for an effect `caster` aims at `aimedAt`. */
export function areaCells(
  area: AreaOfEffect,
  caster: Standing,
  aimedAt: Standing,
  board: AreaBoard
): Set<string> {
  const size = area.sizeFeet / board.feetPerSquare;
  const from = centreOf(caster);
  const to = centreOf(aimedAt);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  // An effect aimed at the caster's own square has no direction; it points north.
  const direction =
    length > EPSILON
      ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
      : { x: 0, y: 1 };

  const covered = (x: number, y: number): boolean => {
    const cx = x + 0.5;
    const cy = y + 0.5;
    switch (area.shape) {
      case 'sphere':
      case 'cylinder':
        return Math.hypot(cx - to.x, cy - to.y) <= size + EPSILON;
      case 'cube':
        return (
          Math.abs(cx - to.x) <= size / 2 + EPSILON && Math.abs(cy - to.y) <= size / 2 + EPSILON
        );
      case 'emanation': {
        if (inside(caster, x, y)) return false;
        const dx = Math.max(caster.cell.x - cx, 0, cx - (caster.cell.x + caster.size.width));
        const dy = Math.max(caster.cell.y - cy, 0, cy - (caster.cell.y + caster.size.height));
        return Math.hypot(dx, dy) <= size + EPSILON;
      }
      case 'cone':
      case 'line': {
        if (inside(caster, x, y)) return false;
        const along = (cx - from.x) * direction.x + (cy - from.y) * direction.y;
        if (along <= EPSILON || along > size + EPSILON) return false;
        const across = Math.abs((cx - from.x) * -direction.y + (cy - from.y) * direction.x);
        return across <= (area.shape === 'cone' ? along / 2 : 0.5) + EPSILON;
      }
    }
  };

  const cells = new Set<string>();
  for (let y = 0; y < board.rows; y++) {
    for (let x = 0; x < board.cols; x++) {
      if (covered(x, y)) cells.add(`${x},${y}`);
    }
  }
  return cells;
}

/** Whether any square of a creature's footprint is in the area. */
export function standsIn(creature: Standing, cells: ReadonlySet<string>): boolean {
  for (let dy = 0; dy < creature.size.height; dy++) {
    for (let dx = 0; dx < creature.size.width; dx++) {
      if (cells.has(`${creature.cell.x + dx},${creature.cell.y + dy}`)) return true;
    }
  }
  return false;
}
