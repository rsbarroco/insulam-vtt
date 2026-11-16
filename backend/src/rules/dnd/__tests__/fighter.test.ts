import type { CombatAction } from '../actions';
import { attackRoll } from '../d20';
import { deathSavingThrow } from '../deathSaves';
import { resolveCheck } from '../checks';
import { readConditions } from '../conditions';
import { resolveCharacterInitiative } from '../../../utils/rules/initiative';
import {
  criticalFrom,
  DEFY_DEATH,
  duelingBonus,
  hasRemarkableAthlete,
  hasStudiedAttacks,
  hasSurvivor,
  heroicRally,
  readInventory,
  withDamageBonus,
} from '../fighter';

const dice =
  (...faces: number[]) =>
  () =>
    faces.shift() ?? 10;
const features = (...names: string[]) => names.map((name) => ({ name }));
const longsword: CombatAction = {
  name: 'Longsword',
  cost: 'action',
  source: 'sheet',
  weapon: 'Longsword',
  attack: { kind: 'melee', bonus: 5, damage: [{ roll: { count: 1, sides: 8, bonus: 3 }, type: 'slashing' }] },
};
const greatsword: CombatAction = {
  name: 'Greatsword',
  cost: 'action',
  source: 'sheet',
  weapon: 'Greatsword',
  attack: { kind: 'melee', bonus: 5, twoHanded: true, damage: [{ roll: { count: 2, sides: 6, bonus: 3 }, type: 'slashing' }] },
};
const longbow: CombatAction = {
  name: 'Longbow',
  cost: 'action',
  source: 'sheet',
  weapon: 'Longbow',
  attack: { kind: 'ranged', bonus: 5, rangeFeet: { normal: 150, long: 600 }, damage: [{ roll: { count: 1, sides: 8, bonus: 3 }, type: 'piercing' }] },
};
const fireBolt: CombatAction = {
  name: 'Fire Bolt',
  cost: 'action',
  source: 'spell',
  spell: { id: 'fire-bolt', level: 0 },
  attack: { kind: 'ranged', bonus: 5, rangeFeet: { normal: 120, long: null }, damage: [{ roll: { count: 1, sides: 10 }, type: 'fire' }] },
};
const unarmed: CombatAction = {
  name: 'Unarmed Strike',
  cost: 'action',
  source: 'unarmed',
  unarmed: 'damage',
  attack: { kind: 'melee', bonus: 5, damage: [{ roll: { count: 0, sides: 1, bonus: 4 }, type: 'bludgeoning' }] },
};

describe('Improved and Superior Critical', () => {
  it('widens the range for weapons and Unarmed Strikes, not for spells', () => {
    expect(criticalFrom(features(), longsword)).toBe(20);
    expect(criticalFrom(features('Improved Critical (Fighter 3)'), longsword)).toBe(19);
    expect(criticalFrom(features('Improved Critical'), unarmed)).toBe(19);
    expect(criticalFrom(features('Improved Critical', 'Superior Critical (Fighter 15)'), longbow)).toBe(18);
    expect(criticalFrom(features('Superior Critical'), fireBolt)).toBe(20);
  });

  it('makes a 19 that hits a Critical Hit, and leaves a 19 that misses a miss', () => {
    expect(attackRoll({ bonus: 5, armorClass: 15, criticalFrom: 19 }, dice(19))).toMatchObject({ hit: true, critical: true });
    expect(attackRoll({ bonus: 5, armorClass: 15 }, dice(19))).toMatchObject({ hit: true, critical: false });
    expect(attackRoll({ bonus: 0, armorClass: 25, criticalFrom: 18 }, dice(19))).toMatchObject({ hit: false, critical: false });
    expect(attackRoll({ bonus: 5, armorClass: 15, criticalFrom: 18 }, dice(17))).toMatchObject({ hit: true, critical: false });
    expect(attackRoll({ bonus: 5, armorClass: 15, criticalFrom: 18 }, dice(18))).toMatchObject({ hit: true, critical: true });
  });
});

describe('Remarkable Athlete', () => {
  it('is read off the sheet', () => {
    expect(hasRemarkableAthlete(features('Remarkable Athlete (Fighter 3)'))).toBe(true);
    expect(hasRemarkableAthlete(features('Second Wind'))).toBe(false);
  });

  it('rolls Initiative with Advantage', () => {
    const sheet = { stats: { dexterity: { score: 14, modifier: 2 } }, featuresAndTraits: [{ name: 'Remarkable Athlete', description: '' }] };
    expect(resolveCharacterInitiative('DND_5E', sheet)).toMatchObject({ kind: 'roll', expression: '2d20kh1+2' });
    expect(resolveCharacterInitiative('DND_5E', { ...sheet, featuresAndTraits: [] })).toMatchObject({ kind: 'roll', expression: '1d20+2' });
  });

  it('gives a check Advantage through the caller’s reasons, cancelled by a Disadvantage', () => {
    const check = { name: 'Hero', label: 'Strength (Athletics)', bonus: 5, conditions: readConditions([]), extraReasons: ['Advantage: Remarkable Athlete'] };
    const rolled = resolveCheck(check, dice(4, 15));
    expect(rolled.roll.mode).toBe('advantage');
    expect(rolled.total).toBe(20);
    expect(resolveCheck({ ...check, conditions: readConditions(['Poisoned']) }, dice(4, 15)).roll.mode).toBe('normal');
  });
});

describe('Dueling', () => {
  const dueling = features('Fighting Style: Dueling');

  it('adds 2 with a one-handed Melee weapon and no other weapon equipped', () => {
    expect(duelingBonus(dueling, longsword, [{ name: 'Longsword', equipped: true }, { name: 'Shield', equipped: true }])).toBe(2);
    expect(duelingBonus(dueling, longsword, [])).toBe(2);
    expect(duelingBonus(dueling, longsword, [{ name: 'Dagger', equipped: false }])).toBe(2);
  });

  it('adds nothing with another weapon equipped, a Two-Handed or Ranged weapon, an Unarmed Strike, or without the feat', () => {
    expect(duelingBonus(dueling, longsword, [{ name: 'Longsword', equipped: true }, { name: 'Dagger', equipped: true }])).toBe(0);
    expect(duelingBonus(dueling, greatsword, [])).toBe(0);
    expect(duelingBonus(dueling, longbow, [])).toBe(0);
    expect(duelingBonus(dueling, unarmed, [])).toBe(0);
    expect(duelingBonus(dueling, fireBolt, [])).toBe(0);
    expect(duelingBonus(features('Fighting Style: Defense'), longsword, [])).toBe(0);
  });

  it('reads the inventory and adds the bonus to the first damage line', () => {
    expect(readInventory({ inventory: [{ name: 'Longsword', equipped: true }, { name: 'Dagger' }, { name: 'Javelin', equipped: true, quantity: 0 }, 7] })).toEqual([
      { name: 'Longsword', equipped: true },
      { name: 'Dagger', equipped: false },
    ]);
    expect(readInventory(null)).toEqual([]);
    expect(withDamageBonus(longsword, 2).attack!.damage[0].roll.bonus).toBe(5);
    expect(withDamageBonus(longsword, 0)).toBe(longsword);
  });
});

describe('Studied Attacks and Survivor', () => {
  it('are read off the sheet', () => {
    expect(hasStudiedAttacks(features('Studied Attacks (Fighter 13)'))).toBe(true);
    expect(hasSurvivor(features('Survivor (Fighter 18)'))).toBe(true);
    expect(hasSurvivor(features())).toBe(false);
  });

  it('rolls death saves with Advantage, an 18 counting as a 20', () => {
    const none = { successes: 1, failures: 1 };
    expect(deathSavingThrow(none, dice(3, 18), DEFY_DEATH)).toEqual({ natural: 18, dice: [3, 18], saves: { successes: 0, failures: 0 }, result: 'revived' });
    expect(deathSavingThrow(none, dice(1, 12), DEFY_DEATH)).toMatchObject({ natural: 12, saves: { successes: 2, failures: 1 }, result: 'continues' });
    expect(deathSavingThrow(none, dice(1, 1), DEFY_DEATH)).toMatchObject({ natural: 1, result: 'dead' });
    // Without Survivor: one die, and an 18 is only a success.
    expect(deathSavingThrow(none, dice(18, 20))).toEqual({ natural: 18, saves: { successes: 2, failures: 1 }, result: 'continues' });
  });

  it('rallies 5 + Constitution modifier while Bloodied and above 0', () => {
    expect(heroicRally({ current: 20, max: 40 }, 3)).toBe(8);
    expect(heroicRally({ current: 21, max: 40 }, 3)).toBe(0);
    expect(heroicRally({ current: 0, max: 40 }, 3)).toBe(0);
    expect(heroicRally({ current: 1, max: 5 }, 3)).toBe(4);
    expect(heroicRally({ current: 5, max: 40 }, -1)).toBe(4);
  });
});
