import {
  conditionsIn,
  conditionsOnFailure,
  conditionsOnHit,
  fits,
  sizeOfSquares,
  turnLimit,
} from '../actionConditions';

describe('conditionsOnHit', () => {
  it('reads a grapple for a creature small enough, and its Restrained rider', () => {
    expect(
      conditionsOnHit(
        'Melee Attack Roll: +7, reach 10 ft. Hit: 11 (2d6 + 4) Slashing damage. If the target is a Large or smaller creature, it has the Grappled condition (escape DC 14) from one of two chains, and it has the Restrained condition until the grapple ends.'
      )
    ).toEqual([
      { condition: 'Grappled', largest: 'Large' },
      { condition: 'Restrained', largest: 'Large', until: 'grapple ends' },
    ]);
  });

  it('reads how long a condition lasts', () => {
    expect(
      conditionsOnHit(
        'Melee Attack Roll: +7, reach 5 ft. Hit: 7 (1d6 + 4) Piercing damage plus 17 (5d6) Poison damage, and the target has the Poisoned condition until the start of the assassin’s next turn.'
      )
    ).toEqual([{ condition: 'Poisoned', until: 'start of the assassin’s next turn' }]);
  });

  it('leaves a condition that hangs on anything else', () => {
    expect(
      conditionsIn('If the target fails by 5 or more, it has the Paralyzed condition.')
    ).toEqual([]);
    expect(
      conditionsOnHit('Melee Attack Roll: +5, reach 5 ft. Hit: 6 (1d8 + 2) Slashing damage.')
    ).toEqual([]);
  });
});

describe('conditionsOnFailure', () => {
  it('reads only the failure', () => {
    expect(
      conditionsOnFailure(
        'Strength Saving Throw: DC 12, each creature in a 30-foot Cone. Failure: The target is pushed up to 30 feet straight away from the dragon and has the Prone condition. Success: The target has the Prone condition.'
      )
    ).toEqual([{ condition: 'Prone' }]);
  });
});

describe('sizes', () => {
  it('takes one square as Medium, and checks the largest size', () => {
    expect(sizeOfSquares(1)).toBe('Medium');
    expect(sizeOfSquares(3)).toBe('Huge');
    expect(fits({ condition: 'Grappled', largest: 'Large' }, 'Huge')).toBe(false);
    expect(fits({ condition: 'Grappled', largest: 'Large' }, 'Medium')).toBe(true);
    expect(fits({ condition: 'Prone' }, 'Gargantuan')).toBe(true);
  });
});

describe('turnLimit', () => {
  it('ties a condition to the source’s turn, or the target’s own', () => {
    expect(
      turnLimit({ condition: 'Poisoned', until: 'start of the assassin’s next turn' })
    ).toEqual({ ends: 'start', whose: 'source' });
    expect(turnLimit({ condition: 'Restrained', until: "end of the devil's next turn" })).toEqual({
      ends: 'end',
      whose: 'source',
    });
    expect(turnLimit({ condition: 'Frightened', until: 'end of its next turn' })).toEqual({
      ends: 'end',
      whose: 'target',
    });
    expect(turnLimit({ condition: 'Restrained', until: 'grapple ends' })).toBeNull();
    expect(turnLimit({ condition: 'Prone' })).toBeNull();
  });
});
