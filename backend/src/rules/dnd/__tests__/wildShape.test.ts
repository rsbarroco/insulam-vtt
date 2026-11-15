/**
 * Wild Shape: the forms a Druid's level allows, and the form a token is in.
 */

import { wildShapeForms, wildShapeLimit, wildShapeOf, wildShapeTemporaryHitPoints } from '../wildShape';

const druid = (level: number) => ({ class: 'Druid', level });

describe('Wild Shape', () => {
  it('allows Challenge Rating 1/4 without flying from level 2, 1/2 from 4, 1 with flying from 8', () => {
    expect(wildShapeLimit(1)).toBeNull();
    expect(wildShapeLimit(2)).toEqual({ maxCr: 0.25, fly: false });
    expect(wildShapeLimit(4)).toEqual({ maxCr: 0.5, fly: false });
    expect(wildShapeLimit(8)).toEqual({ maxCr: 1, fly: true });
  });

  it('offers the Beasts of the reference document the level allows', () => {
    const second = wildShapeForms(druid(2));
    expect(second).toContain('Wolf');
    expect(second).not.toContain('Bat');
    expect(second).not.toContain('Brown Bear');
    const eighth = wildShapeForms(druid(8));
    expect(eighth).toEqual(expect.arrayContaining(['Bat', 'Brown Bear']));
    expect(wildShapeForms({ class: 'Wizard', level: 8 })).toEqual([]);
  });

  it('reads the form from the token, and the Temporary Hit Points from the Druid level', () => {
    expect(wildShapeOf({ metadata: { wildShape: 'Wolf' } })?.statBlock.ac).toBe(12);
    expect(wildShapeOf({ metadata: {} })).toBeNull();
    expect(wildShapeTemporaryHitPoints({ class: 'Druid / Fighter', level: 5 })).toBe(5);
  });
});
