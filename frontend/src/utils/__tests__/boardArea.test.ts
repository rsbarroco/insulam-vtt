/**
 * Areas of effect on the board: which squares each shape covers.
 */

import { describe, it, expect } from 'vitest';
import { areaCells, standsIn } from '../boardArea';

const board = { cols: 20, rows: 20, feetPerSquare: 5 };
const at = (x: number, y: number, size = 1) => ({
  cell: { x, y },
  size: { width: size, height: size },
});
const sorted = (cells: Set<string>) => [...cells].sort();

describe('areaCells', () => {
  it('centres a sphere on the creature aimed at', () => {
    const cells = areaCells({ shape: 'sphere', sizeFeet: 10 }, at(0, 0), at(10, 10), board);
    expect(cells.has('10,10')).toBe(true);
    expect(cells.has('12,10')).toBe(true);
    expect(cells.has('13,10')).toBe(false);
    // Two squares on the diagonal are 14 ft away, beyond 10.
    expect(cells.has('12,12')).toBe(false);
    expect(cells.has('11,11')).toBe(true);
    expect(cells.size).toBe(13);
    expect(cells.has('0,0')).toBe(false);
  });

  it('covers a 20-foot radius sphere roughly as the circle it is', () => {
    const cells = areaCells({ shape: 'sphere', sizeFeet: 20 }, at(0, 0), at(10, 10), board);
    // Area of the circle in squares: pi * 4^2 = 50.3.
    expect(cells.size).toBeGreaterThanOrEqual(45);
    expect(cells.size).toBeLessThanOrEqual(53);
  });

  it('runs a line one square wide from the caster towards the target', () => {
    const cells = areaCells({ shape: 'line', sizeFeet: 30 }, at(2, 5), at(9, 5), board);
    expect(sorted(cells)).toEqual(['3,5', '4,5', '5,5', '6,5', '7,5', '8,5']);
  });

  it('opens a cone as wide as it is long, away from the caster', () => {
    const cells = areaCells({ shape: 'cone', sizeFeet: 15 }, at(5, 5), at(5, 9), board);
    expect(sorted(cells)).toEqual(['4,7', '4,8', '5,6', '5,7', '5,8', '6,7', '6,8']);
    expect(cells.has('5,5')).toBe(false);
    expect(cells.has('5,4')).toBe(false);
  });

  it('points a cone along a diagonal', () => {
    const cells = areaCells({ shape: 'cone', sizeFeet: 15 }, at(5, 5), at(8, 8), board);
    expect(cells.has('6,6')).toBe(true);
    expect(cells.has('7,7')).toBe(true);
    expect(cells.has('4,4')).toBe(false);
    expect(cells.has('5,5')).toBe(false);
  });

  it('places a cube around the creature aimed at', () => {
    const cells = areaCells({ shape: 'cube', sizeFeet: 15 }, at(0, 0), at(10, 10), board);
    expect(cells.size).toBe(9);
    expect(cells.has('9,9')).toBe(true);
    expect(cells.has('11,11')).toBe(true);
    expect(cells.has('12,10')).toBe(false);
  });

  it('spreads an emanation from the edges of the caster, leaving its own squares out', () => {
    const cells = areaCells({ shape: 'emanation', sizeFeet: 10 }, at(10, 10, 2), at(0, 0), board);
    expect(cells.has('10,10')).toBe(false);
    expect(cells.has('11,11')).toBe(false);
    // Two squares out from each edge.
    expect(cells.has('8,10')).toBe(true);
    expect(cells.has('7,10')).toBe(false);
    expect(cells.has('13,11')).toBe(true);
    expect(cells.has('14,11')).toBe(false);
  });

  it('keeps to the board', () => {
    const cells = areaCells({ shape: 'sphere', sizeFeet: 20 }, at(5, 5), at(0, 0), board);
    expect([...cells].every((key) => key.split(',').every((n) => Number(n) >= 0))).toBe(true);
  });

  it('follows the size of a square', () => {
    const cells = areaCells({ shape: 'line', sizeFeet: 30 }, at(2, 5), at(9, 5), {
      ...board,
      feetPerSquare: 10,
    });
    expect(sorted(cells)).toEqual(['3,5', '4,5', '5,5']);
  });
});

describe('standsIn', () => {
  it('catches a creature with any square in the area', () => {
    const cells = new Set(['4,4']);
    expect(standsIn(at(4, 4), cells)).toBe(true);
    expect(standsIn(at(3, 3, 2), cells)).toBe(true);
    expect(standsIn(at(5, 5, 2), cells)).toBe(false);
  });
});
