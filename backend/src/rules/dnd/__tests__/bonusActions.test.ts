import { hasTurnFeature, turnFeatureEffect } from '../bonusActions';

describe('hasTurnFeature', () => {
  it('gives Cunning Action to a Rogue from level 2, and the Focus features to a Monk from level 2', () => {
    expect(hasTurnFeature({ class: 'Rogue', level: 2 }, 'Cunning Action')).toBe(true);
    expect(hasTurnFeature({ class: 'Rogue', level: 1 }, 'Cunning Action')).toBe(false);
    expect(hasTurnFeature({ class: 'Fighter / Monk', level: 3 }, 'Flurry of Blows')).toBe(true);
    expect(hasTurnFeature({ class: 'Rogue', level: 5 }, 'Patient Defense')).toBe(false);
  });
});

describe('turnFeatureEffect', () => {
  it('reads what each does to the turn and what it costs', () => {
    expect(turnFeatureEffect('Cunning Action', { as: 'Dash' })).toEqual({
      dash: true,
      disengage: false,
      dodge: false,
      strikes: 0,
      focus: 0,
    });
    expect(turnFeatureEffect('Cunning Action', {})).toEqual({
      refusal: 'Cunning Action takes the Dash, Disengage or Hide action',
    });
    expect(turnFeatureEffect('Flurry of Blows', {})).toMatchObject({ strikes: 2, focus: 1 });
    expect(turnFeatureEffect('Patient Defense', {})).toMatchObject({
      disengage: true,
      dodge: false,
      focus: 0,
    });
    expect(turnFeatureEffect('Patient Defense', { focus: true })).toMatchObject({
      disengage: true,
      dodge: true,
      focus: 1,
    });
    expect(turnFeatureEffect('Step of the Wind', { focus: true })).toMatchObject({
      dash: true,
      disengage: true,
      focus: 1,
    });
  });
});
