/**
 * Arcane Recovery: the slots a Wizard recovers as a Short Rest ends.
 */

import { arcaneRecovery, arcaneRecoveryBudget } from '../arcaneRecovery';

const wizard = (level: number, featureUses: Record<string, number> = {}) => ({
  class: 'Wizard',
  level,
  featureUses,
  spellcasting: { slots: { '1': { total: 4, expended: 3 }, '2': { total: 3, expended: 1 }, '3': { total: 2, expended: 0 } } },
});

describe('Arcane Recovery', () => {
  it('recovers slots of a combined level up to half the Wizard level, rounded up', () => {
    expect(arcaneRecoveryBudget(wizard(5))).toBe(3);
    const done = arcaneRecovery(wizard(5), [1, 2]);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const slots = (done.sheet.spellcasting as { slots: Record<string, { expended: number }> }).slots;
    expect([slots['1'].expended, slots['2'].expended]).toEqual([2, 0]);
    expect(done.sheet.featureUses).toEqual({ 'Arcane Recovery': 1 });
    expect(done.summary).toBe('Arcane Recovery: 2 spell slots recovered (level 1, level 2)');
  });

  it('refuses what the rules do not allow', () => {
    expect(arcaneRecovery(wizard(4), [2, 1])).toEqual({ ok: false, reason: 'Those slots come to level 3; Arcane Recovery recovers 2 at most' });
    expect(arcaneRecovery(wizard(5), [3])).toEqual({ ok: false, reason: 'No level 3 spell slot is expended to recover' });
    expect(arcaneRecovery(wizard(20), [6])).toEqual({ ok: false, reason: 'Arcane Recovery recovers no slot of level 6 or higher' });
    expect(arcaneRecovery(wizard(5, { 'Arcane Recovery': 1 }), [1])).toEqual({ ok: false, reason: 'Arcane Recovery is used until a Long Rest' });
    expect(arcaneRecovery({ ...wizard(5), class: 'Cleric' }, [1])).toEqual({ ok: false, reason: 'The sheet has no Arcane Recovery' });
  });
});
