/**
 * Distance, line of sight and cover between two creatures on the tactical
 * board, by the conventions in docs/TACTICAL_MODE.md.
 */

import { describe, it, expect } from 'vitest';
import { coverBetween, coverLabel, distanceFeet, type Standing } from '../iso/sight';
import { createHeightGrid, withHeight, type HeightGrid } from '../iso/heightGrid';

const COLS = 12;
const ROWS = 8;

const at = (x: number, y: number, size = 1): Standing => ({
  cell: { x, y },
  size: { width: size, height: size },
});
const raise = (
  cells: Array<[number, number, number]>,
  grid: HeightGrid = createHeightGrid(COLS, ROWS)
) => cells.reduce((g, [x, y, h]) => withHeight(g, x, y, h), grid);
const flat = { heights: null, feetPerSquare: 5, diagonalRule: 'flat' as const };

describe('distanceFeet', () => {
  it('is 5 feet between neighbours, straight or diagonal', () => {
    expect(distanceFeet(at(2, 2), at(3, 2), flat)).toBe(5);
    expect(distanceFeet(at(2, 2), at(3, 3), flat)).toBe(5);
  });

  it('is 0 for creatures in the same square', () => {
    expect(distanceFeet(at(2, 2), at(2, 2), flat)).toBe(0);
  });

  it('counts squares in a line', () => {
    expect(distanceFeet(at(1, 1), at(7, 1), flat)).toBe(30);
  });

  it('counts a diagonal as one square under the flat rule', () => {
    expect(distanceFeet(at(1, 1), at(5, 5), flat)).toBe(20);
  });

  it('counts every second diagonal double under the alternating rule', () => {
    const alternating = { ...flat, diagonalRule: 'alternating' as const };
    expect(distanceFeet(at(1, 1), at(5, 5), alternating)).toBe(30);
    expect(distanceFeet(at(1, 1), at(5, 2), alternating)).toBe(20);
  });

  it('measures from the nearest edges of large creatures', () => {
    // A 2 by 2 creature at (1,1) covers x 1 to 2; the target is at x 5.
    expect(distanceFeet(at(1, 1, 2), at(5, 1), flat)).toBe(15);
    expect(distanceFeet(at(5, 1), at(1, 1, 2), flat)).toBe(15);
  });

  it('uses the map scale', () => {
    expect(distanceFeet(at(1, 1), at(4, 1), { ...flat, feetPerSquare: 10 })).toBe(30);
  });

  it('is the difference in height when that is the greater', () => {
    // Next to a tower 16 steps (40 feet) tall.
    const heights = raise([[3, 2, 16]]);
    expect(distanceFeet(at(2, 2), at(3, 2), { ...flat, heights })).toBe(40);
    // Far enough away that the ground distance is greater again.
    expect(distanceFeet(at(3, 2), at(11, 2), { ...flat, heights })).toBe(40);
    expect(distanceFeet(at(3, 2), at(11, 7), { ...flat, heights })).toBe(40);
  });
});

describe('coverBetween', () => {
  const attacker = at(1, 3);
  const target = at(8, 3);
  const none = { heights: null, others: [] as Standing[] };

  it('is none across open ground', () => {
    expect(coverBetween(attacker, target, none)).toBe('none');
  });

  it('is none for neighbours whatever is around them', () => {
    const heights = raise([
      [1, 4, 9],
      [2, 4, 9],
      [1, 2, 9],
      [2, 2, 9],
    ]);
    expect(coverBetween(at(1, 3), at(2, 3), { heights, others: [] })).toBe('none');
  });

  it('is half behind a low wall next to the target', () => {
    // A wall one step tall hides the lowest of the four heights.
    const heights = raise([[7, 3, 1]]);
    expect(coverBetween(attacker, target, { heights, others: [] })).toBe('half');
  });

  it('is total behind a wall as tall as the two creatures', () => {
    // Two steps is the height of a creature one square in size: the attacker
    // looks level along the top of the wall and sees nothing behind it.
    const cover = (wall: number) =>
      coverBetween(attacker, target, { heights: raise([[7, 3, wall]]), others: [] });
    expect(cover(1)).toBe('half');
    expect(cover(2)).toBe('total');
  });

  it('is three-quarters when only the top of the target shows', () => {
    // The same wall, seen from ground four steps higher.
    const heights = raise([
      [7, 3, 2],
      [1, 3, 4],
    ]);
    expect(coverBetween(attacker, target, { heights, others: [] })).toBe('three-quarters');
  });

  it('is total behind ground taller than both creatures', () => {
    const heights = raise([[4, 3, 10]]);
    expect(coverBetween(attacker, target, { heights, others: [] })).toBe('total');
  });

  it('lets an attacker on high ground see over a wall', () => {
    // The same wall that gives total cover from the ground.
    const wall: Array<[number, number, number]> = [[7, 3, 3]];
    expect(coverBetween(attacker, target, { heights: raise(wall), others: [] })).toBe('total');
    const fromATower = raise([...wall, [1, 3, 30]]);
    expect(coverBetween(attacker, target, { heights: fromATower, others: [] })).not.toBe('total');
  });

  it('does not count the ground the two stand on', () => {
    const heights = raise([
      [1, 3, 6],
      [8, 3, 6],
    ]);
    expect(coverBetween(attacker, target, { heights, others: [] })).toBe('none');
  });

  it('is at least half with another creature in the way', () => {
    const between = at(4, 3);
    expect(coverBetween(attacker, target, { heights: null, others: [between] })).toBe('half');
  });

  it('is not changed by a creature off the line, nor by the two themselves', () => {
    expect(
      coverBetween(attacker, target, { heights: null, others: [at(4, 6), attacker, target] })
    ).toBe('none');
  });

  it('keeps the greater cover when a creature stands in front of a tall wall', () => {
    const heights = raise([[7, 3, 3]]);
    expect(coverBetween(attacker, target, { heights, others: [at(4, 3)] })).toBe('total');
  });

  it('sees a large target over a wall that hides a small one', () => {
    const heights = raise([
      [6, 3, 2],
      [6, 4, 2],
    ]);
    const small = coverBetween(attacker, at(8, 3), { heights, others: [] });
    const large = coverBetween(attacker, at(8, 3, 2), { heights, others: [] });
    expect(small).toBe('total');
    expect(large).toBe('half');
  });
});

describe('coverLabel', () => {
  it('gives the bonus the rules give', () => {
    expect(coverLabel('none')).toBe('no cover');
    expect(coverLabel('half')).toContain('+2');
    expect(coverLabel('three-quarters')).toContain('+5');
    expect(coverLabel('total')).toContain('cannot be targeted');
  });
});
