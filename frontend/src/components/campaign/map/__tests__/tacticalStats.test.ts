/**
 * A token's movement numbers, and who stands in its way.
 */

import { describe, it, expect } from 'vitest';
import {
  readTacticalStats,
  reachObstacles,
  tacticalStatsPatch,
  TACTICAL_LIMITS,
} from '../iso/tacticalStats';
import { TokenDisposition, TokenLayer, type Token } from '@/types';

const token = (over: Partial<Token> = {}): Token =>
  ({
    id: 'mover',
    name: 'Mover',
    position: { x: 0, y: 0 },
    size: { width: 1, height: 1 },
    layer: TokenLayer.TOKEN,
    visible: true,
    disposition: TokenDisposition.FRIENDLY,
    metadata: {},
    ...over,
  }) as Token;

describe('readTacticalStats', () => {
  it('reads what the patch stores', () => {
    const metadata = tacticalStatsPatch({ move: 5, jump: 2 });
    expect(readTacticalStats({ metadata })).toEqual({ move: 5, jump: 2 });
  });

  it.each<[string, unknown]>([
    ['no metadata', undefined],
    ['no numbers', {}],
    ['cleared numbers', { tactical: null }],
    ['a missing jump', { tactical: { move: 4 } }],
    ['a move that is not whole', { tactical: { move: 2.5, jump: 1 } }],
    ['a negative jump', { tactical: { move: 4, jump: -1 } }],
    ['a move over the limit', { tactical: { move: TACTICAL_LIMITS.maxMove + 1, jump: 1 } }],
    ['text', { tactical: { move: '4', jump: '1' } }],
  ])('answers null for %s', (_label, metadata) => {
    expect(readTacticalStats({ metadata: metadata as Token['metadata'] })).toBeNull();
  });
});

describe('reachObstacles', () => {
  const mover = token();
  const friend = token({ id: 'friend', position: { x: 1, y: 0 } });
  const foe = token({ id: 'foe', position: { x: 2, y: 0 }, disposition: TokenDisposition.HOSTILE });

  it('lets a token through its own side and not through the other', () => {
    const { blocked, occupied } = reachObstacles(mover, [mover, friend, foe], {});

    expect(blocked({ x: 1, y: 0 })).toBe(false);
    expect(occupied({ x: 1, y: 0 })).toBe(true);
    expect(blocked({ x: 2, y: 0 })).toBe(true);
    expect(occupied({ x: 2, y: 0 })).toBe(true);
    expect(occupied({ x: 3, y: 0 })).toBe(false);
  });

  it('turns the sides round for a hostile mover', () => {
    const { blocked } = reachObstacles(foe, [mover, friend, foe], {});

    expect(blocked({ x: 1, y: 0 })).toBe(true);
  });

  it('never counts the mover itself', () => {
    const { occupied } = reachObstacles(mover, [mover], {});
    expect(occupied({ x: 0, y: 0 })).toBe(false);
  });

  it('lets anyone stand on a downed token', () => {
    const downed = token({
      id: 'downed',
      position: { x: 1, y: 0 },
      disposition: TokenDisposition.HOSTILE,
      hp: { current: 0, max: 8 },
    } as Partial<Token>);

    const { blocked, occupied } = reachObstacles(mover, [downed], {});

    expect(blocked({ x: 1, y: 0 })).toBe(false);
    expect(occupied({ x: 1, y: 0 })).toBe(false);
  });

  it('ignores tokens on the other plane', () => {
    const spirit = token({
      id: 'spirit',
      position: { x: 1, y: 0 },
      layer: TokenLayer.SPIRIT,
      disposition: TokenDisposition.HOSTILE,
    });

    const { blocked } = reachObstacles(mover, [spirit], {});

    expect(blocked({ x: 1, y: 0 })).toBe(false);
  });

  it('counts every cell of a large footprint', () => {
    const big = token({ id: 'big', size: { width: 2, height: 2 } });

    const { blocked } = reachObstacles(big, [foe], {});

    // The footprint at (1,0) covers (2,0), where the foe stands.
    expect(blocked({ x: 1, y: 0 })).toBe(true);
    expect(blocked({ x: 0, y: 1 })).toBe(false);
  });
});
