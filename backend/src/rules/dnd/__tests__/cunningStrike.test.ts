/**
 * Cunning Strike: its save DC and the Poisoner's Kit the Poison effect needs.
 */

import { chooseCunningStrike, CUNNING_EFFECTS, cunningEffectsOf, cunningStrikeDC, hasPoisonersKit } from '../cunningStrike';

describe('Cunning Strike', () => {
  it('sets its DC at 8 + Dexterity modifier + Proficiency Bonus', () => {
    expect(cunningStrikeDC({ proficiencyBonus: 3, stats: { dexterity: { score: 18, modifier: 4 } } })).toBe(15);
  });

  it('finds a Poisoner’s Kit in the inventory, however its apostrophe is written', () => {
    expect(hasPoisonersKit({ inventory: [{ name: "Poisoner's Kit" }] })).toBe(true);
    expect(hasPoisonersKit({ inventory: [{ name: 'Poisoner’s Kit' }] })).toBe(true);
    expect(hasPoisonersKit({ inventory: [{ name: 'Thieves’ Tools' }] })).toBe(false);
    expect(hasPoisonersKit({})).toBe(false);
  });
});

describe('chooseCunningStrike', () => {
  const features = (...names: string[]) => new Set(names.map((name) => name.toLowerCase()));

  it('takes one effect from Cunning Strike, and its cost', () => {
    expect(chooseCunningStrike(['trip'], features('Cunning Strike'), 3)).toEqual({ ok: true, cost: 1, label: 'Trip' });
    expect(chooseCunningStrike(['trip'], features(), 3)).toEqual({ ok: false, reason: 'no Cunning Strike' });
  });

  it('takes two different effects with Improved Cunning Strike, paying for each', () => {
    const improved = features('Cunning Strike', 'Improved Cunning Strike', 'Devious Strikes');
    expect(chooseCunningStrike(['daze', 'obscure'], improved, 7)).toEqual({ ok: true, cost: 5, label: 'Daze and Obscure' });
    expect(chooseCunningStrike(['trip', 'trip'], improved, 7)).toMatchObject({ ok: false, reason: 'A Cunning Strike effect is used once on a Sneak Attack' });
    expect(chooseCunningStrike(['trip', 'withdraw'], features('Cunning Strike'), 7)).toMatchObject({
      ok: false,
      reason: 'Two Cunning Strike effects need Improved Cunning Strike',
    });
  });

  it('wants the feature that gives the effect, and the dice to pay for it', () => {
    expect(chooseCunningStrike(['knockOut'], features('Cunning Strike'), 7)).toMatchObject({ ok: false, reason: 'Knock Out needs Devious Strikes' });
    expect(chooseCunningStrike(['stealth'], features('Cunning Strike'), 7)).toMatchObject({ ok: false, reason: 'Stealth Attack needs Supreme Sneak' });
    expect(chooseCunningStrike(['knockOut', 'trip'], features('Cunning Strike', 'Improved Cunning Strike', 'Devious Strikes'), 6)).toMatchObject({
      ok: false,
      reason: 'Those Cunning Strike effects cost 7d6 of a 6d6 Sneak Attack',
    });
    expect(chooseCunningStrike(['trip'], features('Cunning Strike'), 0)).toMatchObject({ ok: false, reason: 'Cunning Strike needs a Sneak Attack to forgo dice from' });
    // The whole Sneak Attack may be forgone.
    expect(chooseCunningStrike(['knockOut'], features('Cunning Strike', 'Devious Strikes'), 6)).toMatchObject({ ok: true, cost: 6 });
  });

  it('lists the effects a sheet\'s features give', () => {
    expect(cunningEffectsOf(features('Cunning Strike'))).toEqual(['poison', 'trip', 'withdraw']);
    expect(cunningEffectsOf(features('Cunning Strike', 'Devious Strikes', 'Supreme Sneak'))).toEqual(CUNNING_EFFECTS);
    expect(cunningEffectsOf(features('Devious Strikes'))).toEqual([]);
  });
});
