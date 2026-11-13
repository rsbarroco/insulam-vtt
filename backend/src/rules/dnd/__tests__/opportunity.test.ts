import { leavesReachOf, sideOf, type Bystander } from '../opportunity';

const board = { heights: null, feetPerSquare: 5, diagonalRule: 'flat' as const };
const at = (x: number, y: number, size = 1) => ({
  cell: { x, y },
  size: { width: size, height: size },
});
const guard = (id: string, x: number, y: number, reachFeet = 5, size = 1): Bystander => ({
  id,
  standing: at(x, y, size),
  reachFeet,
});

describe('leavesReachOf', () => {
  it('names the creature whose reach a move leaves', () => {
    expect(leavesReachOf(at(1, 0), at(3, 0), [guard('ogre', 0, 0)], board)).toEqual(['ogre']);
  });

  it('names nobody for a move that stays within reach', () => {
    // From one side of the ogre to another: still next to it.
    expect(leavesReachOf(at(1, 0), at(1, 1), [guard('ogre', 0, 0)], board)).toEqual([]);
  });

  it('names nobody for a move that starts out of reach, towards or past', () => {
    expect(leavesReachOf(at(3, 0), at(1, 0), [guard('ogre', 0, 0)], board)).toEqual([]);
    expect(leavesReachOf(at(3, 0), at(6, 0), [guard('ogre', 0, 0)], board)).toEqual([]);
  });

  it('measures by the bystander’s own reach', () => {
    const pike = guard('pikeman', 0, 0, 10);
    expect(leavesReachOf(at(1, 0), at(2, 0), [pike], board)).toEqual([]);
    expect(leavesReachOf(at(2, 0), at(3, 0), [pike], board)).toEqual(['pikeman']);
  });

  it('measures from the edge of a large creature', () => {
    // A 2-by-2 ogre at (0,0) fills columns 0 and 1: column 2 is next to it.
    const ogre = guard('ogre', 0, 0, 5, 2);
    expect(leavesReachOf(at(2, 0), at(3, 0), [ogre], board)).toEqual(['ogre']);
    expect(leavesReachOf(at(2, 0), at(2, 2), [ogre], board)).toEqual([]);
  });

  it('names each of several, and only those it leaves', () => {
    const made = leavesReachOf(
      at(1, 1),
      at(1, 3),
      [guard('a', 0, 0), guard('b', 2, 0), guard('c', 1, 2)],
      board
    );
    expect(made).toEqual(['a', 'b']);
  });
});

describe('sideOf', () => {
  it('puts players and friendly creatures on one side and hostile ones on the other', () => {
    expect(sideOf({ type: 'player', disposition: null })).toBe('party');
    expect(sideOf({ type: 'npc', disposition: 'friendly' })).toBe('party');
    expect(sideOf({ type: 'npc', disposition: 'hostile' })).toBe('foes');
  });

  it('gives no side to a neutral or unmarked creature, or an object', () => {
    expect(sideOf({ type: 'npc', disposition: 'neutral' })).toBeNull();
    expect(sideOf({ type: 'npc', disposition: null })).toBeNull();
    expect(sideOf({ type: 'object', disposition: 'hostile' })).toBeNull();
  });
});
