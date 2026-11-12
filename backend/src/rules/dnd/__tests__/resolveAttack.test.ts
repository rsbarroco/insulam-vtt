import { resolveAttack, type AttackRequest, type Combatant } from '../resolveAttack';
import type { CombatAction } from '../actions';
import type { RollDie } from '../d20';

const dice = (...values: number[]): RollDie => {
  let next = 0;
  return () => values[next++];
};

const creature = (name: string, x: number, over: Partial<Combatant> = {}): Combatant => ({
  name,
  standing: { cell: { x, y: 2 }, size: { width: 1, height: 1 } },
  armorClass: 14,
  hp: { current: 20, max: 20, temp: 0 },
  conditions: [],
  ...over,
});

const sword: CombatAction = {
  name: 'Longsword',
  cost: 'action',
  source: 'sheet',
  attack: { kind: 'melee', bonus: 5, reachFeet: 5, damage: [{ roll: { count: 1, sides: 8, bonus: 3 }, type: 'slashing' }] },
};
const bow: CombatAction = {
  name: 'Longbow',
  cost: 'action',
  source: 'sheet',
  attack: { kind: 'ranged', bonus: 6, rangeFeet: { normal: 30, long: 60 }, damage: [{ roll: { count: 1, sides: 8, bonus: 4 }, type: 'piercing' }] },
};

const request = (over: Partial<AttackRequest> = {}): AttackRequest => ({
  attacker: creature('Knight', 2),
  target: creature('Ogre', 3),
  action: sword,
  board: { heights: null, feetPerSquare: 5, diagonalRule: 'flat', others: [] },
  ...over,
});

const ok = (result: ReturnType<typeof resolveAttack>) => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
};
const refusal = (result: ReturnType<typeof resolveAttack>) => {
  if (result.ok) throw new Error('expected a refusal');
  return result.reason;
};

describe('a hit', () => {
  it('rolls the damage and takes it from the target', () => {
    const result = ok(resolveAttack(request(), dice(12, 6)));

    expect(result.outcome.hit).toBe(true);
    expect(result.dealt).toBe(9);
    expect(result.hp).toEqual({ current: 11, max: 20, temp: 0 });
    expect(result.summary).toBe('Longsword vs Ogre (AC 14): hit, 9 slashing damage');
  });

  it('rolls the dice twice on a 20', () => {
    const result = ok(resolveAttack(request(), dice(20, 6, 5)));

    expect(result.outcome.critical).toBe(true);
    expect(result.dealt).toBe(14);
    expect(result.summary).toContain('critical hit');
  });

  it('halves damage the target resists', () => {
    const target = creature('Ogre', 3, { defences: { resistances: ['slashing'] } });
    expect(ok(resolveAttack(request({ target }), dice(12, 6))).dealt).toBe(4);
  });

  it('says when the target drops, and when it is killed outright', () => {
    const weak = creature('Goblin', 3, { hp: { current: 5, max: 7, temp: 0 } });
    const dropped = ok(resolveAttack(request({ target: weak }), dice(12, 4)));
    expect(dropped.hp?.current).toBe(0);
    expect(dropped.summary).toBe('Longsword vs Goblin (AC 14): hit, 7 slashing damage; Goblin drops to 0 hit points');

    const frail = creature('Rat', 3, { hp: { current: 1, max: 2, temp: 0 } });
    expect(ok(resolveAttack(request({ target: frail }), dice(12, 8))).summary).toContain('killed outright');
  });

  it('reports the damage of a target that tracks no hit points, and changes nothing', () => {
    const result = ok(resolveAttack(request({ target: creature('Door', 3, { hp: null }) }), dice(12, 6)));
    expect(result.dealt).toBe(9);
    expect(result.hp).toBeNull();
  });
});

describe('a miss', () => {
  it('rolls no damage and leaves the target alone', () => {
    const result = ok(resolveAttack(request(), dice(3)));

    expect(result.outcome.hit).toBe(false);
    expect(result.damage).toEqual([]);
    expect(result.hp).toEqual({ current: 20, max: 20, temp: 0 });
    expect(result.summary).toBe('Longsword vs Ogre (AC 14): miss');
  });
});

describe('reach and range', () => {
  it('refuses a melee attack on a target out of reach', () => {
    expect(refusal(resolveAttack(request({ target: creature('Ogre', 5) }), dice()))).toBe('Ogre is 15 ft away, beyond the reach of 5 ft');
  });

  it('refuses a ranged attack past the long range', () => {
    const far = request({ action: bow, attacker: creature('Archer', 0), target: creature('Ogre', 14) });
    expect(refusal(resolveAttack(far, dice()))).toContain('beyond the range of 60 ft');
  });

  it('gives Disadvantage at long range', () => {
    const long = request({ action: bow, attacker: creature('Archer', 0), target: creature('Ogre', 9) });
    const result = ok(resolveAttack(long, dice(17, 2)));

    expect(result.outcome.roll.mode).toBe('disadvantage');
    expect(result.reasons).toContain('Disadvantage: the target is at long range');
    expect(result.outcome.hit).toBe(false);
  });
});

describe('cover', () => {
  // A wall one step tall next to the target: half cover.
  const heights = { cols: 12, rows: 5, heights: new Array<number>(60).fill(0) };
  heights.heights[2 * 12 + 8] = 1;
  const behindWall = request({
    action: bow,
    attacker: creature('Archer', 2),
    target: creature('Ogre', 9),
    board: { heights, feetPerSquare: 5, diagonalRule: 'flat', others: [] },
  });

  it('adds to the Armor Class', () => {
    const result = ok(resolveAttack(behindWall, dice(9, 3, 3)));
    expect(result.cover).toBe('half');
    expect(result.outcome.armorClass).toBe(16);
    // 9 + 6 = 15: a hit on AC 14, a miss behind half cover.
    expect(result.outcome.hit).toBe(false);
  });

  it('refuses a target behind total cover', () => {
    const tall = { ...heights, heights: [...heights.heights] };
    tall.heights[2 * 12 + 8] = 9;
    const hidden = { ...behindWall, board: { ...behindWall.board, heights: tall } };
    expect(refusal(resolveAttack(hidden, dice()))).toBe('Ogre is behind total cover');
  });
});

describe('conditions', () => {
  it('gives Advantage against a Prone target up close, and a Critical Hit on a Paralyzed one', () => {
    const prone = ok(resolveAttack(request({ target: creature('Ogre', 3, { conditions: ['Prone'] }) }), dice(2, 15, 4)));
    expect(prone.outcome.roll.mode).toBe('advantage');
    expect(prone.outcome.hit).toBe(true);

    const helpless = ok(resolveAttack(request({ target: creature('Ogre', 3, { conditions: ['Paralyzed'] }) }), dice(10, 10, 4, 4)));
    expect(helpless.outcome.critical).toBe(true);
  });

  it('takes Exhaustion from the roll', () => {
    const tired = ok(resolveAttack(request({ attacker: creature('Knight', 2, { exhaustion: 2 }) }), dice(12)));
    // 12 + 5 - 4 = 13, a miss on AC 14.
    expect(tired.outcome.roll.total).toBe(13);
    expect(tired.outcome.hit).toBe(false);
  });

  it('refuses an Incapacitated attacker', () => {
    const stunned = request({ attacker: creature('Knight', 2, { conditions: ['Stunned'] }) });
    expect(refusal(resolveAttack(stunned, dice()))).toBe('Knight is Incapacitated and cannot attack');
  });

  it('lets the table grant Advantage, which a Disadvantage cancels', () => {
    expect(ok(resolveAttack(request({ mode: 'advantage' }), dice(2, 15, 4))).outcome.roll.mode).toBe('advantage');
    const poisoned = request({ mode: 'advantage', attacker: creature('Knight', 2, { conditions: ['Poisoned'] }) });
    expect(ok(resolveAttack(poisoned, dice(12, 4))).outcome.roll.mode).toBe('normal');
  });
});

describe('what cannot be resolved', () => {
  it('refuses an action with no attack roll', () => {
    const text: CombatAction = { name: 'Multiattack', cost: 'action', source: 'statBlock', text: 'Two attacks.' };
    expect(refusal(resolveAttack(request({ action: text }), dice()))).toBe('Multiattack has no attack roll the VTT can make');
  });

  it('refuses a target with no Armor Class', () => {
    expect(refusal(resolveAttack(request({ target: creature('Crate', 3, { armorClass: null }) }), dice()))).toBe('Crate has no Armor Class to roll against');
  });
});
