import type { CombatAction } from '../actions';
import { METAMAGIC, transmutedAction } from '../metamagic';
import { longRest } from '../rests';
import { resourcesOf, restoreResources } from '../resources';
import {
  convertSpellSlot, createSpellSlot, draconicResilienceHitPoints, elementalAffinity, sorcerousRestoration, useInnateSorcery, withElementalAffinity,
  withInnateSorcery, withoutCreatedSlots,
} from '../sorcery';
import { armorClassOf } from '../../../utils/srdArmor';

const sorcerer = (level: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  class: 'Sorcerer',
  level,
  stats: { charisma: { score: 18, modifier: 4 } },
  spellcasting: { slots: { '1': { total: 4, expended: 0 }, '2': { total: 3, expended: 0 }, '3': { total: 2, expended: 0 } } },
  ...extra,
});
const slot = (sheet: Record<string, unknown>, level: number) =>
  (sheet.spellcasting as { slots: Record<string, { total: number; expended: number }> }).slots[String(level)];
const used = (sheet: Record<string, unknown>, name: string) => (sheet.featureUses as Record<string, number> | undefined)?.[name] ?? 0;

const fireball: CombatAction = {
  name: 'Fireball',
  cost: 'action',
  source: 'spell',
  save: { ability: 'dex', dc: 15, damage: [{ roll: { count: 8, sides: 6 }, type: 'fire' }], halfOnSuccess: true },
};
const fireBolt: CombatAction = {
  name: 'Fire Bolt',
  cost: 'action',
  source: 'spell',
  attack: { kind: 'ranged', bonus: 7, rangeFeet: { normal: 120, long: null }, damage: [{ roll: { count: 1, sides: 10 }, type: 'fire' }] },
};

describe('Font of Magic', () => {
  it('creates a slot for the table cost: an expended one comes back first', () => {
    const sheet = sorcerer(5, { spellcasting: { slots: { '3': { total: 2, expended: 1 } } } });
    const made = createSpellSlot(sheet, 3);
    if (!made.ok) throw new Error(made.reason);
    expect(slot(made.sheet, 3)).toEqual({ total: 2, expended: 0 });
    expect(used(made.sheet, 'Sorcery Points')).toBe(5);
    expect(made.sheet.createdSlots).toBeUndefined();
    expect(made.left).toBe(0);
  });

  it('adds a slot when none is expended, and a Long Rest takes it away', () => {
    const made = createSpellSlot(sorcerer(5), 1);
    if (!made.ok) throw new Error(made.reason);
    expect(slot(made.sheet, 1)).toEqual({ total: 5, expended: 0 });
    expect(made.sheet.createdSlots).toEqual({ '1': 1 });
    const rested = longRest(made.sheet).sheet;
    expect(slot(rested, 1)).toEqual({ total: 4, expended: 0 });
    expect(rested.createdSlots).toBeUndefined();
  });

  it('keeps a created slot that was cast from taking the total below what is left', () => {
    const made = createSpellSlot(sorcerer(5), 1);
    if (!made.ok) throw new Error(made.reason);
    const cast = { ...made.sheet, spellcasting: { slots: { '1': { total: 5, expended: 5 } } } };
    expect(slot(withoutCreatedSlots(cast), 1)).toEqual({ total: 4, expended: 4 });
  });

  it('refuses a slot above level 5, a Sorcerer level too low, and points it has not got', () => {
    expect(createSpellSlot(sorcerer(20), 6)).toMatchObject({ ok: false });
    expect(createSpellSlot(sorcerer(4), 3)).toEqual({ ok: false, reason: 'A level 3 spell slot is created from Sorcerer level 5' });
    expect(createSpellSlot(sorcerer(5, { featureUses: { 'Sorcery Points': 1 } }), 3)).toEqual({ ok: false, reason: 'A level 3 spell slot costs 5 Sorcery Points' });
    expect(createSpellSlot({ class: 'Wizard', level: 5 }, 1)).toEqual({ ok: false, reason: 'The sheet has no Font of Magic' });
    expect(createSpellSlot(sorcerer(1), 1)).toMatchObject({ ok: false });
  });

  it('converts a slot into points equal to its level, never above the maximum', () => {
    const spent = sorcerer(5, { featureUses: { 'Sorcery Points': 4 } });
    const back = convertSpellSlot(spent, 3);
    if (!back.ok) throw new Error(back.reason);
    expect(slot(back.sheet, 3)).toEqual({ total: 2, expended: 1 });
    expect(used(back.sheet, 'Sorcery Points')).toBe(1);
    const capped = convertSpellSlot(sorcerer(5, { featureUses: { 'Sorcery Points': 1 } }), 3);
    if (!capped.ok) throw new Error(capped.reason);
    expect(used(capped.sheet, 'Sorcery Points')).toBe(0);
    expect(capped.summary).toContain('1 Sorcery Point ');
  });

  it('refuses to convert with no slot left or no point spent', () => {
    expect(convertSpellSlot(sorcerer(5, { featureUses: { 'Sorcery Points': 2 } }), 4)).toEqual({ ok: false, reason: 'No level 4 spell slot left to convert' });
    expect(convertSpellSlot(sorcerer(5), 1)).toMatchObject({ ok: false });
  });
});

describe('Innate Sorcery', () => {
  it('has two uses from level 1, back on a Long Rest only', () => {
    expect(resourcesOf(sorcerer(1)).map((entry) => [entry.name, entry.max, entry.shortRest])).toEqual([['Innate Sorcery', 2, 'none']]);
    const spent = sorcerer(1, { featureUses: { 'Innate Sorcery': 2 } });
    expect(used(restoreResources(spent, 'short').sheet, 'Innate Sorcery')).toBe(2);
    expect(used(restoreResources(spent, 'long').sheet, 'Innate Sorcery')).toBe(0);
  });

  it('spends a use, then 2 Sorcery Points from level 7 (Sorcery Incarnate)', () => {
    const first = useInnateSorcery(sorcerer(7));
    expect(first).toMatchObject({ ok: true, left: 1, incarnate: false });
    const out = sorcerer(7, { featureUses: { 'Innate Sorcery': 2 } });
    const paid = useInnateSorcery(out);
    if (!paid.ok) throw new Error(paid.reason);
    expect(paid.incarnate).toBe(true);
    expect(used(paid.sheet, 'Sorcery Points')).toBe(2);
    expect(useInnateSorcery(sorcerer(6, { featureUses: { 'Innate Sorcery': 2 } }))).toEqual({ ok: false, reason: 'No uses of Innate Sorcery left until a Long Rest' });
    expect(useInnateSorcery(sorcerer(7, { featureUses: { 'Innate Sorcery': 2, 'Sorcery Points': 6 } }))).toMatchObject({ ok: false });
    expect(useInnateSorcery({ class: 'Wizard', level: 7 })).toMatchObject({ ok: false });
  });

  it('raises the save DC of a spell by 1, and of nothing else', () => {
    expect(withInnateSorcery(fireball).save?.dc).toBe(16);
    expect(withInnateSorcery({ ...fireball, source: 'sheet' }).save?.dc).toBe(15);
    expect(withInnateSorcery(fireBolt)).toBe(fireBolt);
  });
});

describe('Sorcerous Restoration', () => {
  it('gives back half the Sorcerer level in points as a Short Rest ends, once until a Long Rest', () => {
    const spent = sorcerer(7, { featureUses: { 'Sorcery Points': 5 } });
    const back = sorcerousRestoration(spent);
    if (!back.ok) throw new Error(back.reason);
    expect(used(back.sheet, 'Sorcery Points')).toBe(2);
    expect(back.summary).toBe('Sorcerous Restoration: 3 Sorcery Points regained');
    expect(sorcerousRestoration(back.sheet)).toEqual({ ok: false, reason: 'Sorcerous Restoration is used until a Long Rest' });
    expect(used(restoreResources(back.sheet, 'long').sheet, 'Sorcerous Restoration')).toBe(0);
  });

  it('is refused below level 5 and with no point spent, and keeps its use then', () => {
    expect(sorcerousRestoration(sorcerer(4, { featureUses: { 'Sorcery Points': 2 } }))).toEqual({ ok: false, reason: 'The sheet has no Sorcerous Restoration' });
    expect(sorcerousRestoration(sorcerer(5))).toEqual({ ok: false, reason: 'No Sorcery Points are spent to regain' });
  });
});

describe('Draconic Sorcery', () => {
  it('adds a Hit Point a Sorcerer level from level 3', () => {
    expect([2, 3, 4, 20].map(draconicResilienceHitPoints)).toEqual([0, 3, 4, 20]);
  });

  it('sets the unarmored Armor Class to 10 + Dexterity + Charisma', () => {
    const input = { dex: 2, cha: 4, classes: ['Sorcerer'], features: ['Draconic Resilience (Sorcerer 3)'], equipped: [] as string[] };
    expect(armorClassOf(input)).toMatchObject({ armorClass: 16, from: 'Draconic Resilience 10 + 2 Dexterity + 4 Charisma' });
    expect(armorClassOf({ ...input, features: [] }).armorClass).toBe(12);
    expect(armorClassOf({ ...input, equipped: ['Leather Armor'] }).armorClass).toBe(13);
  });

  it('reads the Elemental Affinity type from the feature name', () => {
    expect(elementalAffinity({ featuresAndTraits: [{ name: 'Elemental Affinity: Fire (Sorcerer 6)' }] })).toBe('fire');
    expect(elementalAffinity({ featuresAndTraits: ['Elemental Affinity (Lightning)'] })).toBe('lightning');
    expect(elementalAffinity({ featuresAndTraits: [{ name: 'Elemental Affinity (Sorcerer 6)' }] })).toBeNull();
    expect(elementalAffinity({ featuresAndTraits: [{ name: 'Fire Resistance' }] })).toBeNull();
  });

  it('adds the Charisma modifier to one damage roll of a spell of that type', () => {
    const sheet = sorcerer(6, { featuresAndTraits: [{ name: 'Elemental Affinity: Fire' }] });
    expect(withElementalAffinity(fireball, sheet).save?.damage).toEqual([{ roll: { count: 8, sides: 6, bonus: 4 }, type: 'fire' }]);
    expect(withElementalAffinity(fireBolt, sheet).attack?.damage[0].roll.bonus).toBe(4);
    const two: CombatAction = { ...fireball, save: { ...fireball.save!, damage: [...fireball.save!.damage, { roll: { count: 1, sides: 6 }, type: 'fire' }] } };
    expect(withElementalAffinity(two, sheet).save?.damage[1].roll.bonus).toBeUndefined();
    expect(withElementalAffinity({ ...fireball, source: 'sheet' }, sheet)).toMatchObject({ source: 'sheet', save: { damage: [{ roll: { count: 8, sides: 6 } }] } });
    const cold = transmutedAction(fireball, 'cold')!;
    expect(withElementalAffinity(cold, sheet)).toBe(cold);
    expect(withElementalAffinity(fireball, sorcerer(6))).toBe(fireball);
  });
});

describe('Transmuted Spell', () => {
  it('costs 1 Sorcery Point and changes the listed damage types to another', () => {
    expect(METAMAGIC.transmuted).toEqual({ name: 'Transmuted Spell', cost: 1 });
    expect(transmutedAction(fireball, 'thunder')?.save?.damage[0].type).toBe('thunder');
    expect(transmutedAction(fireBolt, 'acid')?.attack?.damage[0].type).toBe('acid');
  });

  it('is refused for the same type, and for damage outside the list', () => {
    expect(transmutedAction(fireball, 'fire')).toBeNull();
    const force: CombatAction = { ...fireBolt, attack: { ...fireBolt.attack!, damage: [{ roll: { count: 1, sides: 10 }, type: 'force' }] } };
    expect(transmutedAction(force, 'fire')).toBeNull();
  });
});
