/**
 * Evasion (Rogue 7, Monk 7) and Danger Sense (Barbarian 2) on the saving
 * throws the server resolves.
 */

import { resolveSave, type SaveTarget } from '../resolveSave';
import { saveModifiers, readConditions } from '../conditions';
import { hasFeature } from '../featureEffects';
import type { CombatAction } from '../actions';
import type { Combatant } from '../resolveAttack';

const dice = (...values: number[]) => {
  const queue = [...values];
  return (sides: number) => queue.shift() ?? Math.ceil(sides / 2);
};
const at = (x: number) => ({ cell: { x, y: 0 }, size: { width: 1, height: 1 } });
const board = { heights: null, feetPerSquare: 5, diagonalRule: 'flat' as const, others: [] };
const mage: Combatant = { name: 'Mage', standing: at(0), armorClass: 12, hp: { current: 20, max: 20, temp: 0 }, conditions: [] };
const target = (name: string, extra: Partial<SaveTarget> = {}): SaveTarget => ({
  name, standing: at(4), armorClass: 12, hp: { current: 30, max: 30, temp: 0 }, conditions: [], saveBonus: 2, ...extra,
});
const fireball: CombatAction = {
  name: 'Fireball', cost: 'action', source: 'spell', rangeFeet: 150, area: { shape: 'sphere', sizeFeet: 20 },
  save: { ability: 'dex', dc: 15, halfOnSuccess: true, damage: [{ roll: { count: 2, sides: 6 }, type: 'fire' }] },
};
const ok = (result: ReturnType<typeof resolveSave>) => {
  if (!result.ok) throw new Error(result.reason);
  return result;
};

describe('Evasion', () => {
  it('takes no damage on a success and half on a failure', () => {
    // 4 + 6 = 10 fire; the rogue rolls 15 (saves), the monk 3 (fails).
    const result = ok(resolveSave({ source: mage, targets: [target('Rogue', { evasion: true }), target('Monk', { evasion: true })], action: fireball, board }, dice(4, 6, 15, 3)));
    expect(result.targets.map((t) => [t.outcome.success, t.dealt])).toEqual([[true, 0], [false, 5]]);
    expect(result.summary).toBe('Fireball (DC 15 Dexterity, 10 fire): Rogue saves (17), 0 damage (Evasion); Monk fails (5), 5 damage (Evasion)');
  });

  it('does not work while Incapacitated, or on a save that is not a Dexterity save for half', () => {
    const dazed = ok(resolveSave({ source: mage, targets: [target('Rogue', { evasion: true, conditions: ['incapacitated'] })], action: fireball, board }, dice(4, 6, 3)));
    expect(dazed.targets[0].dealt).toBe(10);
    const blast: CombatAction = { ...fireball, name: 'Thunderwave', save: { ...fireball.save!, ability: 'con' } };
    const shaken = ok(resolveSave({ source: mage, targets: [target('Rogue', { evasion: true })], action: blast, board }, dice(4, 6, 15)));
    expect(shaken.targets[0].dealt).toBe(5);
  });
});

describe('Danger Sense', () => {
  it('gives Advantage on Dexterity saves', () => {
    // 3 and 14: the better, 14 + 2 = 16, saves.
    const result = ok(resolveSave({ source: mage, targets: [target('Barbarian', { dangerSense: true })], action: fireball, board }, dice(4, 6, 3, 14)));
    expect(result.targets[0].outcome).toMatchObject({ success: true });
    expect(result.targets[0].dealt).toBe(5);
  });

  it('gives nothing while Incapacitated, or on another save, and cancels with Disadvantage', () => {
    expect(saveModifiers(readConditions(['incapacitated']), 'dex', { dangerSense: true }).mode).toBe('normal');
    expect(saveModifiers(readConditions([]), 'wis', { dangerSense: true }).mode).toBe('normal');
    expect(saveModifiers(readConditions(['restrained']), 'dex', { dangerSense: true }).mode).toBe('normal');
    expect(saveModifiers(readConditions([]), 'dex', { dangerSense: true }).mode).toBe('advantage');
  });
});

describe('hasFeature', () => {
  it('finds a feature by its name, whatever class and level it is listed with', () => {
    expect(hasFeature([{ name: 'Evasion (Rogue 7)' }], 'Evasion')).toBe(true);
    expect(hasFeature([{ name: 'danger sense' }], 'Danger Sense')).toBe(true);
    expect(hasFeature([{ name: 'Evasive Footwork' }], 'Evasion')).toBe(false);
  });
});

describe('Indomitable', () => {
  it('rerolls a failed save with the Fighter level added, and the reroll stands', () => {
    // 4 + 6 = 10 fire; the fighter rolls 3 (5, fails), then 6 + 2 + 9 = 17 (saves).
    const result = ok(resolveSave({ source: mage, targets: [target('Fighter', { indomitable: 9 })], action: fireball, board }, dice(4, 6, 3, 6)));
    expect(result.targets[0]).toMatchObject({ outcome: { success: true }, rerolled: { success: false }, dealt: 5 });
    expect(result.summary).toBe('Fireball (DC 15 Dexterity, 10 fire): Fighter fails (5), Indomitable: saves (17), 5 damage');
  });

  it('is not used by a save that succeeds, or one failed without a roll', () => {
    const saved = ok(resolveSave({ source: mage, targets: [target('Fighter', { indomitable: 9 })], action: fireball, board }, dice(4, 6, 15)));
    expect(saved.targets[0].rerolled).toBeUndefined();
    const asleep = ok(resolveSave({ source: mage, targets: [target('Fighter', { indomitable: 9, conditions: ['unconscious'] })], action: fireball, board }, dice(4, 6)));
    expect(asleep.targets[0].rerolled).toBeUndefined();
  });
});
