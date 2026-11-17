import type { D20Roll } from '../d20';
import { hasHeroicInspiration, hasHeroicWarrior, isResourceful, rerollD20, rerolledSave, resourcefulLongRest, withHeroicInspiration } from '../heroicInspiration';
import { overcomeDefences, overwhelmingStrike, punchAndGrabApplies } from '../feats';
import { unarmedActions } from '../unarmed';
import { resolveCheck } from '../checks';
import { readConditions } from '../conditions';

const fixed = (...values: number[]) => () => values.shift() ?? 10;
const roll = (mode: D20Roll['mode'], dice: number[], modifier = 3): D20Roll => {
  const natural = mode === 'disadvantage' ? Math.min(...dice) : Math.max(...dice);
  return { mode, dice, natural, modifier, total: natural + modifier };
};

describe('Heroic Inspiration', () => {
  it('is a flag on the sheet', () => {
    expect(hasHeroicInspiration(null)).toBe(false);
    expect(hasHeroicInspiration({})).toBe(false);
    expect(hasHeroicInspiration(withHeroicInspiration({ name: 'x' }, true))).toBe(true);
    expect(withHeroicInspiration({ inspiration: true }, false)).toEqual({ inspiration: false });
  });

  it('rolls one d20 again, and the new roll stands even when it is worse', () => {
    expect(rerollD20(roll('normal', [12]), fixed(4))).toMatchObject({ dice: [4], natural: 4, total: 7 });
  });

  it('rolls the lower of two dice again and reads the roll as its mode says', () => {
    expect(rerollD20(roll('advantage', [4, 9]), fixed(15))).toMatchObject({ dice: [9, 15], natural: 15, total: 18 });
    expect(rerollD20(roll('advantage', [4, 9]), fixed(2))).toMatchObject({ natural: 9, total: 12 });
    expect(rerollD20(roll('disadvantage', [4, 9]), fixed(15))).toMatchObject({ dice: [9, 15], natural: 9, total: 12 });
    expect(rerollD20(roll('disadvantage', [4, 9]), fixed(6))).toMatchObject({ natural: 6, total: 9 });
  });

  it('drops what was added after the first roll', () => {
    expect(rerollD20({ ...roll('normal', [5]), total: 12 }, fixed(6)).total).toBe(9);
  });

  it('rerolls a failed save against the same DC, and leaves one that was not rolled', () => {
    expect(rerolledSave({ roll: roll('normal', [2]), dc: 13, success: false }, fixed(10))).toMatchObject({ success: true, dc: 13 });
    expect(rerolledSave({ roll: roll('normal', [2]), dc: 13, success: false }, fixed(9)).success).toBe(false);
    const none = { roll: null, dc: 13, success: false };
    expect(rerolledSave(none, fixed(20))).toBe(none);
  });

  it('comes back to a Human on a Long Rest, by species or by the trait listed', () => {
    expect(isResourceful({ race: 'Human' })).toBe(true);
    expect(isResourceful({ race: 'Dwarf' })).toBe(false);
    expect(isResourceful({ featuresAndTraits: [{ name: 'Resourceful (Human)' }] })).toBe(true);
    expect(resourcefulLongRest({ race: 'Human' })).toEqual({ sheet: { race: 'Human', inspiration: true }, regained: ['Heroic Inspiration (Resourceful)'] });
    expect(resourcefulLongRest({ race: 'Human', inspiration: true }).regained).toEqual([]);
    expect(resourcefulLongRest({ race: 'Elf' }).regained).toEqual([]);
  });

  it('reads Heroic Warrior from the features', () => {
    expect(hasHeroicWarrior({ featuresAndTraits: [{ name: 'Heroic Warrior (Fighter 10)' }] })).toBe(true);
    expect(hasHeroicWarrior({ featuresAndTraits: [] })).toBe(false);
    expect(hasHeroicWarrior(null)).toBe(false);
  });

  it('rerolls a check with the new d20', () => {
    const request = { name: 'Hero', label: 'Strength', bonus: 3, dc: 15, conditions: readConditions([]) };
    const first = resolveCheck(request, fixed(5));
    expect(first.success).toBe(false);
    const again = resolveCheck({ ...request, rerolled: { roll: first.roll, label: 'Heroic Inspiration' } }, fixed(14));
    expect(again).toMatchObject({ total: 17, success: true });
    expect(again.summary).toBe('Hero Strength check: 17 vs DC 15: success (Heroic Inspiration: the d20 is rolled again, 5 becomes 14)');
  });
});

describe('Grappler and the Epic Boons', () => {
  const [strike, grapple] = unarmedActions(3, 2);
  const sword = { name: 'Longsword', cost: 'action' as const, source: 'sheet' as const, attack: { kind: 'melee' as const, bonus: 5, damage: [{ type: 'slashing' as const, roll: { count: 1, sides: 8, bonus: 3 } }] } };

  it('Punch and Grab follows an Unarmed Strike that deals damage', () => {
    const grappler = [{ name: 'Grappler (General feat)' }];
    expect(punchAndGrabApplies(grappler, strike)).toBe(true);
    expect(punchAndGrabApplies(grappler, grapple)).toBe(false);
    expect(punchAndGrabApplies(grappler, sword)).toBe(false);
    expect(punchAndGrabApplies([], strike)).toBe(false);
  });

  it('Overcome Defenses takes Resistance to Bludgeoning, Piercing and Slashing away, and nothing else', () => {
    const boon = [{ name: 'Boon of Irresistible Offense (Epic Boon feat)' }];
    const defences = { resistances: ['slashing', 'fire'] as const, immunities: ['piercing'] as const };
    expect(overcomeDefences(boon, defences)).toEqual({ resistances: ['fire'], immunities: ['piercing'] });
    expect(overcomeDefences([], defences)).toBe(defences);
    expect(overcomeDefences(boon, undefined)).toBeUndefined();
  });

  it('Overwhelming Strike adds the ability score on a 20, of the attack’s type', () => {
    const boon = [{ name: 'Boon of Irresistible Offense (Epic Boon feat)' }];
    const scores = { str: 16, dex: 18 };
    expect(overwhelmingStrike(boon, scores, sword, 20)).toEqual({ label: 'Overwhelming Strike (+18)', damage: { type: 'slashing', roll: { count: 0, sides: 1, bonus: 18 } } });
    expect(overwhelmingStrike([{ name: 'Boon of Irresistible Offense (Strength)' }], scores, sword, 20)?.damage.roll.bonus).toBe(16);
    expect(overwhelmingStrike(boon, scores, sword, 19)).toBeNull();
    expect(overwhelmingStrike([], scores, sword, 20)).toBeNull();
    expect(overwhelmingStrike(boon, undefined, sword, 20)).toBeNull();
  });
});
