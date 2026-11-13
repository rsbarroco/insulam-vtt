import { describe, it, expect } from 'vitest';
import { actionChange, formatFeet, markLabels, movementBudget, movementLeft, slowedSpeed, STANDARD_ACTIONS } from '../turn';

describe('movement on a turn', () => {
  it('is the speed, once more for each Dash', () => {
    expect(movementBudget(30, { dashes: 0 })).toBe(30);
    expect(movementBudget(30, { dashes: 1 })).toBe(60);
    expect(movementBudget(30, { dashes: 2 })).toBe(90);
  });

  it('leaves what has not been spent, never less than nothing', () => {
    expect(movementLeft(30, { dashes: 0, movementSpent: 12.5 })).toBe(17.5);
    expect(movementLeft(30, { dashes: 1, movementSpent: 45 })).toBe(15);
    expect(movementLeft(30, { dashes: 0, movementSpent: 40 })).toBe(0);
  });
});

describe('actionChange', () => {
  it('counts a Dash when Dash becomes the action', () => {
    expect(actionChange({ action: null, dashes: 0 }, 'Dash')).toEqual({
      action: 'Dash',
      dashes: 1,
    });
  });

  it('takes that Dash back when the action changes or is given up', () => {
    expect(actionChange({ action: 'Dash', dashes: 1 }, 'Attack')).toEqual({
      action: 'Attack',
      dashes: 0,
    });
    expect(actionChange({ action: 'Dash', dashes: 1 }, null)).toEqual({ action: null, dashes: 0 });
  });

  it('leaves a Dash that came from elsewhere alone', () => {
    expect(actionChange({ action: 'Attack', dashes: 1 }, 'Dodge')).toEqual({
      action: 'Dodge',
      dashes: 1,
    });
    expect(actionChange({ action: 'Dash', dashes: 2 }, null)).toEqual({ action: null, dashes: 1 });
  });

  it('does not count Dash twice', () => {
    expect(actionChange({ action: 'Dash', dashes: 1 }, 'Dash')).toEqual({
      action: 'Dash',
      dashes: 1,
    });
  });
});

describe('formatFeet', () => {
  it('shows whole feet plainly and half feet with the half', () => {
    expect(formatFeet(30)).toBe('30');
    expect(formatFeet(12.5)).toBe('12.5');
  });
});

describe('STANDARD_ACTIONS', () => {
  it('lists Dash, which the bar gives an effect', () => {
    expect(STANDARD_ACTIONS).toContain('Dash');
  });
});

describe('weapon marks', () => {
  const marks = [
    { kind: 'slow' as const, attackerId: 'a', targetId: 'ogre', turnEndsLeft: 1 },
    { kind: 'slow' as const, attackerId: 'b', targetId: 'ogre', turnEndsLeft: 1 },
    { kind: 'sap' as const, attackerId: 'a', targetId: 'ogre', turnEndsLeft: 1 },
    { kind: 'help' as const, attackerId: 'b', targetId: 'ogre', turnEndsLeft: 1 },
    { kind: 'vex' as const, attackerId: 'a', targetId: 'wolf', turnEndsLeft: 2 },
  ];

  it('takes 10 feet off a Slowed creature, once however many slowed it, never below 0', () => {
    expect(slowedSpeed(40, marks, 'ogre')).toBe(30);
    expect(slowedSpeed(5, marks, 'ogre')).toBe(0);
    expect(slowedSpeed(40, marks, 'wolf')).toBe(40);
  });

  it('names what a creature carries', () => {
    expect(markLabels(marks, 'ogre')).toEqual(['Sapped', 'Slowed', 'Distracted']);
    expect(markLabels(marks, 'wolf')).toEqual(['Vexed']);
    expect(markLabels(marks, 'hero')).toEqual([]);
    expect(markLabels([{ kind: 'rage', attackerId: 'hero', targetId: 'hero', turnEndsLeft: 2 }], 'hero')).toEqual(['Raging']);
  });
});
