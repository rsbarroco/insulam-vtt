/**
 * A token's walking speed, and who stands in its way.
 */

import { describe, it, expect } from 'vitest';
import {
  readSpeedOverride,
  reachObstacles,
  speedPatch,
  TACTICAL_LIMITS,
  tokenSpeed,
  walkingSpeedFromLine,
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

const withStatBlock = (speed: string) => ({ statBlock: { speed } }) as Partial<Token>;

describe('walkingSpeedFromLine', () => {
  it.each<[string, number]>([
    ['30 ft.', 30],
    ['30 ft., fly 60 ft.', 30],
    ['40 ft., climb 30 ft.', 40],
    ['25 feet', 25],
    ['0 ft., fly 50 ft. (hover)', 0],
    ['walk 30 ft.', 30],
    ['30', 30],
  ])('reads %s as %i feet', (line, feet) => {
    expect(walkingSpeedFromLine(line)).toBe(feet);
  });

  it.each<[string, string | null | undefined]>([
    ['an empty line', ''],
    ['no line', undefined],
    ['a line that starts with another way of moving', 'fly 60 ft.'],
    ['words', 'varies'],
  ])('finds no walking speed in %s', (_label, line) => {
    expect(walkingSpeedFromLine(line)).toBeNull();
  });
});

describe('readSpeedOverride', () => {
  it('reads what the patch stores', () => {
    expect(readSpeedOverride({ metadata: speedPatch(35) })).toBe(35);
  });

  it.each<[string, unknown]>([
    ['no metadata', undefined],
    ['nothing set', {}],
    ['a cleared speed', speedPatch(null)],
    ['a speed that is not whole', { tactical: { speed: 27.5 } }],
    ['a negative speed', { tactical: { speed: -5 } }],
    ['a speed over the limit', { tactical: { speed: TACTICAL_LIMITS.maxSpeed + 5 } }],
    ['text', { tactical: { speed: '30' } }],
  ])('answers null for %s', (_label, metadata) => {
    expect(readSpeedOverride({ metadata: metadata as Token['metadata'] })).toBeNull();
  });
});

describe('tokenSpeed', () => {
  it('uses the stat block when the DM has set nothing', () => {
    expect(tokenSpeed(token(withStatBlock('30 ft., swim 30 ft.')))).toEqual({
      feet: 30,
      source: 'statBlock',
    });
  });

  it('lets the DM override the stat block', () => {
    expect(tokenSpeed(token({ ...withStatBlock('30 ft.'), metadata: speedPatch(15) }))).toEqual({
      feet: 15,
      source: 'token',
    });
  });

  it('is null for a token with neither', () => {
    expect(tokenSpeed(token())).toBeNull();
    expect(tokenSpeed(token({ statBlock: null }))).toBeNull();
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
