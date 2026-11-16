/**
 * A Druid's features and the Circle of the Land's: Land's Aid, Elemental
 * Fury, Wild Resurgence, Wild Companion, Natural Recovery and Nature's Ward.
 */

import type { CombatAction } from '../actions';
import {
  elementalFury,
  landsAidActions,
  landsAidDice,
  landType,
  naturalRecovery,
  naturesWard,
  primalStrikeChoice,
  primalStrikeDice,
  shortRestRecovery,
  wildCompanion,
  wildResurgence,
  withDruidFeatures,
  withPotentSpellcasting,
} from '../druid';
import { resourcesOf, restoreResources } from '../resources';
import { spellActionsFromSheet } from '../spells';

const druid = (level: number, features: string[] = [], extra: Record<string, unknown> = {}) => ({
  class: 'Druid',
  level,
  proficiencyBonus: 3,
  stats: { wisdom: { score: 16, modifier: 3 } },
  featuresAndTraits: features.map((name) => ({ name, description: '' })),
  spellcasting: {
    spellAttackBonus: 6,
    spellSaveDC: 14,
    cantrips: ['Starry Wisp', 'Fire Bolt', 'Produce Flame'],
    spells: [],
    slots: { '1': { total: 4, expended: 2 }, '2': { total: 3, expended: 1 }, '3': { total: 2, expended: 2 } },
  },
  ...extra,
});
const slotsOf = (sheet: Record<string, unknown>) => (sheet.spellcasting as { slots: Record<string, { expended: number }> }).slots;

describe("Land's Aid", () => {
  it('rolls 2d6, 3d6 from Druid 10 and 4d6 from 14', () => {
    expect([3, 9, 10, 13, 14, 20].map(landsAidDice)).toEqual([2, 2, 3, 3, 4, 4]);
  });

  it('is listed for a Land Druid with a use of Wild Shape left: the saves with the healing, and the healing alone', () => {
    const [aid, healing] = landsAidActions(druid(10, ['Land’s Aid (Druid 3)']));
    expect(aid).toMatchObject({
      name: "Land's Aid",
      cost: 'action',
      channel: 'Wild Shape',
      rangeFeet: 60,
      area: { shape: 'sphere', sizeFeet: 10 },
      save: { ability: 'con', dc: 14, halfOnSuccess: true, damage: [{ roll: { count: 3, sides: 6 }, type: 'necrotic' }] },
      areaHeal: { count: 3, sides: 6 },
    });
    expect(healing).toMatchObject({ name: "Land's Aid (healing only)", channel: 'Wild Shape', rangeFeet: 70, heal: { roll: { count: 3, sides: 6 }, bonus: 0 } });
  });

  it('is not listed without the feature, below Druid 3 or with no use left', () => {
    expect(landsAidActions(druid(5))).toEqual([]);
    expect(landsAidActions(druid(2, ["Land's Aid"]))).toEqual([]);
    expect(landsAidActions(druid(5, ["Land's Aid"], { featureUses: { 'Wild Shape': 2 } }))).toEqual([]);
  });
});

describe('Elemental Fury', () => {
  const sword: CombatAction = { name: 'Scimitar', cost: 'action', source: 'sheet', attack: { kind: 'melee', bonus: 5, damage: [{ roll: { count: 1, sides: 6 }, type: 'slashing' }] } };
  const bite: CombatAction = { ...sword, name: 'Bite', source: 'statBlock' };

  it('reads the option from the sheet, from Druid 7', () => {
    expect(elementalFury(druid(7, ['Elemental Fury: Primal Strike (Druid 7)']))).toBe('primal');
    expect(elementalFury(druid(7, ['Potent Spellcasting']))).toBe('potent');
    expect(elementalFury(druid(7, ['Elemental Fury (Druid 7)']))).toBeNull();
    expect(elementalFury(druid(6, ['Primal Strike']))).toBeNull();
  });

  it('adds 1d8 to a weapon hit, 2d8 from Druid 15, and to a Beast form’s attack in the form only', () => {
    expect(primalStrikeDice(druid(7, ['Primal Strike']), sword, false)).toEqual({ count: 1, sides: 8 });
    expect(primalStrikeDice(druid(15, ['Primal Strike']), sword, false)).toEqual({ count: 2, sides: 8 });
    expect(primalStrikeDice(druid(7, ['Primal Strike']), bite, true)).toEqual({ count: 1, sides: 8 });
    expect(primalStrikeDice(druid(7, ['Primal Strike']), bite, false)).toBeNull();
    expect(primalStrikeDice(druid(7, ['Primal Strike']), { ...sword, source: 'unarmed', unarmed: 'damage' }, false)).toBeNull();
    expect(primalStrikeDice(druid(7, ['Primal Strike']), { ...sword, source: 'spell' }, false)).toBeNull();
    expect(primalStrikeDice(druid(7, ['Potent Spellcasting']), sword, false)).toBeNull();
  });

  it('reads the damage type chosen on the hit', () => {
    expect(primalStrikeChoice('Primal Strike (Thunder)')).toBe('thunder');
    expect(primalStrikeChoice('Divine Smite (level 1)')).toBeNull();
    expect(primalStrikeChoice(null)).toBeNull();
  });

  it('adds the Wisdom modifier to a Druid cantrip’s damage, not to another class’s', () => {
    const sheet = druid(7, ['Potent Spellcasting']);
    const changed = withPotentSpellcasting(sheet, spellActionsFromSheet(sheet));
    const bonus = (name: string) => changed.find((action) => action.name === name)!.attack!.damage[0].roll.bonus;
    expect(bonus('Starry Wisp')).toBe(3);
    expect(bonus('Produce Flame')).toBe(3);
    expect(bonus('Fire Bolt')).toBeUndefined();
    expect(changed.find((action) => action.name === 'Starry Wisp')!.rangeFeet).toBe(60);
  });

  it('counts the cantrip of the land’s Circle spells, and reaches 300 feet farther from Druid 15', () => {
    const sheet = druid(15, ['Potent Spellcasting', 'Circle of the Land Spells (Arid)']);
    const changed = withPotentSpellcasting(sheet, spellActionsFromSheet(sheet));
    const fireBolt = changed.find((action) => action.name === 'Fire Bolt')!;
    expect(fireBolt.attack!.damage[0].roll.bonus).toBe(3);
    expect(fireBolt.rangeFeet).toBe(420);
    expect(fireBolt.attack!.rangeFeet).toEqual({ normal: 420, long: null });
    // Produce Flame's range is the caster's own space: not 10 feet or more.
    expect(changed.find((action) => action.name === 'Produce Flame')!.rangeFeet).toBe(0);
    const polar = druid(15, ['Potent Spellcasting', 'Circle of the Land Spells (Polar)']);
    expect(withPotentSpellcasting(polar, spellActionsFromSheet(polar)).find((action) => action.name === 'Fire Bolt')!.attack!.damage[0].roll.bonus).toBeUndefined();
  });

  it('leaves a sheet without the option as it is', () => {
    const sheet = druid(7);
    expect(withPotentSpellcasting(sheet, spellActionsFromSheet(sheet))).toEqual(spellActionsFromSheet(sheet));
  });
});

describe('a Druid’s actions in and out of a form', () => {
  const beast: CombatAction[] = [{ name: 'Bite', cost: 'action', source: 'statBlock' }];

  it('keeps Land’s Aid in a Wild Shape form, and casts spells there from Druid 18', () => {
    const names = (level: number) => withDruidFeatures(druid(level, ["Land's Aid"]), beast, true).map((action) => action.name);
    expect(names(10)).toEqual(['Bite', "Land's Aid", "Land's Aid (healing only)"]);
    expect(names(18)).toEqual(['Bite', 'Starry Wisp', 'Fire Bolt', 'Produce Flame', "Land's Aid", "Land's Aid (healing only)"]);
  });

  it('changes nothing for another class', () => {
    expect(withDruidFeatures({ class: 'Cleric', level: 10 }, beast, false)).toEqual(beast);
  });
});

describe('Wild Resurgence', () => {
  it('expends a spell slot for a use of Wild Shape when none is left', () => {
    const done = wildResurgence(druid(5, [], { featureUses: { 'Wild Shape': 2 } }), 2);
    if (!done.ok) throw new Error(done.reason);
    expect(slotsOf(done.sheet)['2'].expended).toBe(2);
    expect(done.sheet.featureUses).toEqual({ 'Wild Shape': 1 });
    expect(done.summary).toBe('Wild Resurgence: a level 2 spell slot expended for a use of Wild Shape');
  });

  it('refuses a use while one is left, a slot the sheet has not, and a Druid below level 5', () => {
    expect(wildResurgence(druid(5, [], { featureUses: { 'Wild Shape': 1 } }), 1)).toEqual({ ok: false, reason: 'Wild Resurgence gives a use of Wild Shape when none is left' });
    expect(wildResurgence(druid(5, [], { featureUses: { 'Wild Shape': 2 } }), 3)).toEqual({ ok: false, reason: 'No level 3 spell slot left to expend' });
    expect(wildResurgence(druid(4, [], { featureUses: { 'Wild Shape': 2 } }), 1)).toEqual({ ok: false, reason: 'The sheet has no Wild Resurgence' });
  });

  it('expends a use of Wild Shape for a level 1 spell slot, once until a Long Rest', () => {
    const done = wildResurgence(druid(5));
    if (!done.ok) throw new Error(done.reason);
    expect(slotsOf(done.sheet)['1'].expended).toBe(1);
    expect(done.sheet.featureUses).toEqual({ 'Wild Shape': 1, 'Wild Resurgence': 1 });
    expect(done.summary).toBe('Wild Resurgence: a use of Wild Shape expended for a level 1 spell slot (1 use of Wild Shape left)');
    expect(wildResurgence(done.sheet)).toEqual({ ok: false, reason: 'Wild Resurgence has given its spell slot until a Long Rest' });
    // A Short Rest does not give it back; a Long Rest does.
    expect(wildResurgence(restoreResources(done.sheet, 'short').sheet).ok).toBe(false);
    expect(resourcesOf(restoreResources(done.sheet, 'long').sheet).find((entry) => entry.name === 'Wild Resurgence')).toMatchObject({ used: 0 });
  });

  it('needs a use of Wild Shape and an expended level 1 slot for that', () => {
    expect(wildResurgence(druid(5, [], { featureUses: { 'Wild Shape': 2 } }))).toEqual({ ok: false, reason: 'No uses of Wild Shape left until a rest' });
    const full = druid(5);
    full.spellcasting.slots['1'].expended = 0;
    expect(wildResurgence(full)).toEqual({ ok: false, reason: 'No level 1 spell slot is expended to give back' });
  });
});

describe('Wild Companion', () => {
  it('casts Find Familiar with a use of Wild Shape or a spell slot', () => {
    const shaped = wildCompanion(druid(2));
    if (!shaped.ok) throw new Error(shaped.reason);
    expect(shaped.sheet.featureUses).toEqual({ 'Wild Shape': 1 });
    expect(shaped.summary).toBe('Wild Companion: Find Familiar cast with a use of Wild Shape (1 left)');
    const slotted = wildCompanion(druid(2), 1);
    if (!slotted.ok) throw new Error(slotted.reason);
    expect(slotsOf(slotted.sheet)['1'].expended).toBe(3);
    expect(wildCompanion(druid(1))).toEqual({ ok: false, reason: 'The sheet has no Wild Companion' });
    expect(wildCompanion(druid(2), 3)).toEqual({ ok: false, reason: 'No level 3 spell slot left to expend' });
  });
});

describe('Natural Recovery', () => {
  it('recovers slots of a combined level up to half the Druid level, once until a Long Rest', () => {
    const done = naturalRecovery(druid(6, ['Natural Recovery (Druid 6)']), [1, 2]);
    if (!done.ok) throw new Error(done.reason);
    expect(slotsOf(done.sheet)['1'].expended).toBe(1);
    expect(slotsOf(done.sheet)['2'].expended).toBe(0);
    expect(done.summary).toBe('Natural Recovery: 2 spell slots recovered (level 1, level 2)');
    expect(naturalRecovery(done.sheet, [1])).toEqual({ ok: false, reason: 'Natural Recovery is used until a Long Rest' });
    expect(naturalRecovery(druid(6, ['Natural Recovery']), [3, 1])).toEqual({ ok: false, reason: 'Those slots come to level 4; Natural Recovery recovers 3 at most' });
  });

  it('is a Land Druid’s of level 6: not without the feature on the sheet', () => {
    expect(naturalRecovery(druid(6), [1])).toEqual({ ok: false, reason: 'The sheet has no Natural Recovery' });
    expect(naturalRecovery(druid(5, ['Natural Recovery']), [1])).toEqual({ ok: false, reason: 'The sheet has no Natural Recovery' });
  });

  it('is what a Druid recovers with as a Short Rest ends; a gestalt Wizard uses Arcane Recovery first', () => {
    const land = shortRestRecovery(druid(6, ['Natural Recovery']), [1]);
    expect(land.ok && land.summary).toBe('Natural Recovery: a spell slot recovered (level 1)');
    const both = { ...druid(6, ['Natural Recovery']), class: 'Druid / Wizard' };
    const first = shortRestRecovery(both, [1]);
    if (!first.ok) throw new Error(first.reason);
    expect(first.summary).toBe('Arcane Recovery: a spell slot recovered (level 1)');
    const second = shortRestRecovery(first.sheet, [1]);
    expect(second.ok && second.summary).toBe('Natural Recovery: a spell slot recovered (level 1)');
    expect(shortRestRecovery({ class: 'Fighter', level: 6 }, [1])).toEqual({ ok: false, reason: 'The sheet has no Arcane Recovery' });
  });
});

describe("Nature's Ward", () => {
  it('reads the land from the feature’s name and gives its Resistance', () => {
    expect(landType(druid(10, ['Nature’s Ward (Polar)']))).toBe('polar');
    expect(naturesWard(druid(10, ['Nature’s Ward (Polar)']))).toEqual({ resistance: 'cold' });
    expect(naturesWard(druid(10, ["Nature's Ward (Druid 10)", 'Circle of the Land Spells (Tropical)']))).toEqual({ resistance: 'poison' });
    expect(naturesWard(druid(12, ["Nature's Ward (Arid)"]))).toEqual({ resistance: 'fire' });
    expect(naturesWard(druid(12, ["Nature's Ward (Temperate)"]))).toEqual({ resistance: 'lightning' });
  });

  it('gives the immunity alone when the sheet names no land, and nothing below Druid 10 or without the feature', () => {
    expect(naturesWard(druid(10, ['Nature’s Ward (Druid 10)']))).toEqual({ resistance: null });
    expect(naturesWard(druid(9, ["Nature's Ward (Arid)"]))).toBeNull();
    expect(naturesWard(druid(10))).toBeNull();
    expect(naturesWard(null)).toBeNull();
  });
});
