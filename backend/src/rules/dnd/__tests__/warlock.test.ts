import type { CombatAction } from '../actions';
import { resourcesOf } from '../resources';
import {
  darkOnesBlessing,
  devilsSightFeet,
  eldritchSmiteDamage,
  fiendishResilience,
  isFiend,
  isPactWeapon,
  magicalCunning,
  magicalCunningSlots,
  pactSlots,
  pactWeaponAttacks,
  restorePactSlots,
  warlockHas,
  warlockSaveDC,
  withPactDamage,
} from '../warlock';

const warlock = (level: number, features: string[] = [], extra: Record<string, unknown> = {}) => ({
  class: 'Warlock',
  level,
  stats: { charisma: { score: 16, modifier: 3 } },
  featuresAndTraits: features.map((name) => ({ name, description: '' })),
  ...extra,
});
const slots = (level: number, total: number, expended: number) => ({ spellcasting: { slots: { [String(level)]: { total, expended } } } });
const sword: CombatAction = {
  name: 'Longsword',
  cost: 'action',
  source: 'sheet',
  attack: { kind: 'melee', bonus: 5, damage: [{ roll: { count: 1, sides: 8, bonus: 3 }, type: 'slashing' }] },
};
const expendedAt = (sheet: Record<string, unknown>, level: number) =>
  (sheet.spellcasting as { slots: Record<string, { expended: number }> }).slots[String(level)].expended;

describe('reading a Warlock’s features', () => {
  it('finds a feature whichever apostrophe it is written with, for a Warlock only', () => {
    expect(warlockHas(warlock(3, ['Dark One’s Blessing (Warlock 3)']), "Dark One's Blessing")).toBe(true);
    expect(warlockHas(warlock(3, ["Dark One's Blessing"]), "Dark One's Blessing")).toBe(true);
    expect(warlockHas({ ...warlock(3, ["Dark One's Blessing"]), class: 'Wizard' }, "Dark One's Blessing")).toBe(false);
    expect(warlockHas(null, 'Lifedrinker')).toBe(false);
  });
});

describe('Pact Magic', () => {
  it('reads the slots and their level from the Warlock table', () => {
    expect(pactSlots(warlock(1))).toEqual({ count: 1, level: 1 });
    expect(pactSlots(warlock(5))).toEqual({ count: 2, level: 3 });
    expect(pactSlots(warlock(17))).toEqual({ count: 4, level: 5 });
    expect(pactSlots({ class: 'Wizard', level: 5 })).toBeNull();
  });

  it('gives the expended slots back as a Short Rest ends', () => {
    const rested = restorePactSlots(warlock(5, [], slots(3, 2, 2)));
    expect(expendedAt(rested.sheet, 3)).toBe(0);
    expect(rested.regained).toEqual(['2 Pact Magic slots']);
    expect(restorePactSlots(warlock(5, [], slots(3, 2, 0))).regained).toEqual([]);
    // A gestalt's other slots of that level stay expended past the Pact Magic count.
    expect(expendedAt(restorePactSlots({ ...warlock(5, [], slots(3, 4, 3)), class: 'Warlock / Wizard' }).sheet, 3)).toBe(1);
  });
});

describe('Magical Cunning', () => {
  it('gives back half the maximum, rounded up, and all of them at level 20', () => {
    expect(magicalCunningSlots(warlock(1))).toBe(0);
    expect(magicalCunningSlots(warlock(2))).toBe(1);
    expect(magicalCunningSlots(warlock(11))).toBe(2);
    expect(magicalCunningSlots(warlock(17))).toBe(2);
    expect(magicalCunningSlots(warlock(20))).toBe(4);
  });

  it('regains the slots and spends its use', () => {
    const rite = magicalCunning(warlock(11, [], slots(5, 3, 3)));
    expect(rite).toMatchObject({ ok: true, summary: 'Magical Cunning: 2 Pact Magic slots regained' });
    if (!rite.ok) return;
    expect(expendedAt(rite.sheet, 5)).toBe(1);
    expect(magicalCunning(rite.sheet)).toEqual({ ok: false, reason: 'Magical Cunning is used until a Long Rest' });
  });

  it('is refused with nothing to regain, and below level 2', () => {
    expect(magicalCunning(warlock(5, [], slots(3, 2, 0)))).toEqual({ ok: false, reason: 'No Pact Magic slot is expended to regain' });
    expect(magicalCunning(warlock(1, [], slots(1, 1, 1)))).toEqual({ ok: false, reason: 'The sheet has no Magical Cunning' });
  });
});

describe('the pact weapon', () => {
  it('is the attack Pact of the Blade names, or one with "pact" in its name', () => {
    expect(isPactWeapon(warlock(5, ['Pact of the Blade (Longsword)']), sword)).toBe(true);
    expect(isPactWeapon(warlock(5, ['Pact of the Blade: longsword']), sword)).toBe(true);
    expect(isPactWeapon(warlock(5, ['Pact of the Blade']), sword)).toBe(false);
    expect(isPactWeapon(warlock(5, ['Pact of the Blade (Warlock 1)']), sword)).toBe(false);
    expect(isPactWeapon(warlock(5, ['Pact of the Blade']), { ...sword, name: 'Pact Longsword' })).toBe(true);
    expect(isPactWeapon(warlock(5, []), { ...sword, name: 'Pact Longsword' })).toBe(false);
    expect(isPactWeapon(warlock(5, ['Pact of the Blade (Longsword)']), { ...sword, source: 'spell' })).toBe(false);
  });

  it('attacks twice with Thirsting Blade and three times with Devouring Blade', () => {
    expect(pactWeaponAttacks(warlock(5, ['Pact of the Blade (Longsword)']))).toBe(1);
    expect(pactWeaponAttacks(warlock(5, ['Pact of the Blade (Longsword)', 'Thirsting Blade']))).toBe(2);
    expect(pactWeaponAttacks(warlock(12, ['Pact of the Blade (Longsword)', 'Thirsting Blade', 'Devouring Blade']))).toBe(3);
    expect(pactWeaponAttacks(warlock(12, ['Devouring Blade']))).toBe(1);
  });

  it('deals the chosen type with its own dice', () => {
    expect(withPactDamage(sword, 'psychic').attack?.damage).toEqual([{ roll: { count: 1, sides: 8, bonus: 3 }, type: 'psychic' }]);
  });

  it('smites for 1d8 plus 1d8 a slot level', () => {
    expect(eldritchSmiteDamage(3)).toEqual({ roll: { count: 4, sides: 8 }, type: 'force' });
  });
});

describe('the Fiend Patron', () => {
  it('blesses with the Charisma modifier plus the Warlock level, at least 1', () => {
    expect(darkOnesBlessing(warlock(5, ["Dark One's Blessing"]))).toBe(8);
    expect(darkOnesBlessing(warlock(3, ["Dark One's Blessing"], { stats: { charisma: { score: 1, modifier: -5 } } }))).toBe(1);
    expect(darkOnesBlessing(warlock(5))).toBe(0);
  });

  it('counts Dark One’s Own Luck and Hurl Through Hell for a sheet that lists them', () => {
    const names = (sheet: Record<string, unknown>) => resourcesOf(sheet).map((entry) => `${entry.name} ${entry.max}`);
    expect(names(warlock(14, ['Dark One’s Own Luck', 'Hurl Through Hell (Warlock 14)']))).toEqual(['Magical Cunning 1', "Dark One's Own Luck 3", 'Hurl Through Hell 1']);
    expect(names(warlock(5, ["Dark One's Own Luck"]))).toEqual(['Magical Cunning 1']);
    expect(names(warlock(6, ["Dark One's Own Luck"], { stats: { charisma: { score: 8, modifier: -1 } } }))).toContain("Dark One's Own Luck 1");
  });

  it('reads the damage type Fiendish Resilience names, never Force', () => {
    expect(fiendishResilience(warlock(10, ['Fiendish Resilience (Fire)']))).toBe('fire');
    expect(fiendishResilience(warlock(10, ['Fiendish Resilience: cold']))).toBe('cold');
    expect(fiendishResilience(warlock(10, ['Fiendish Resilience (Force)']))).toBeNull();
    expect(fiendishResilience(warlock(10, ['Fiendish Resilience (Warlock 10)']))).toBeNull();
  });

  it('knows a Fiend, the save DC and Devil’s Sight', () => {
    expect(isFiend('Large Fiend (Devil)')).toBe(true);
    expect(isFiend('Medium Humanoid')).toBe(false);
    expect(warlockSaveDC(warlock(5, [], { proficiencyBonus: 3 }))).toBe(14);
    expect(warlockSaveDC(warlock(5, [], { spellcasting: { spellSaveDC: 15 } }))).toBe(15);
    expect(devilsSightFeet(warlock(2, ['Devil’s Sight']))).toBe(120);
    expect(devilsSightFeet(warlock(2))).toBe(0);
  });
});
