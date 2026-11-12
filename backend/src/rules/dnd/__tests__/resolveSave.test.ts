/**
 * An effect with a saving throw: one damage roll, a save for each target.
 */

import { resolveSave, type SaveTarget } from '../resolveSave';
import type { CombatAction } from '../actions';
import type { Combatant } from '../resolveAttack';

const dice = (...values: number[]) => {
  const queue = [...values];
  return (sides: number) => queue.shift() ?? Math.ceil(sides / 2);
};
const at = (x: number, y = 0) => ({ cell: { x, y }, size: { width: 1, height: 1 } });
const board = { heights: null, feetPerSquare: 5, diagonalRule: 'flat' as const, others: [] };

const mage: Combatant = { name: 'Mage', standing: at(0), armorClass: 12, hp: { current: 20, max: 20, temp: 0 }, conditions: [] };
const target = (name: string, x: number, extra: Partial<SaveTarget> = {}): SaveTarget => ({
  name, standing: at(x), armorClass: 12, hp: { current: 30, max: 30, temp: 0 }, conditions: [], saveBonus: 2, ...extra,
});
const fireball: CombatAction = {
  name: 'Fireball', cost: 'action', source: 'spell', rangeFeet: 150, area: { shape: 'sphere', sizeFeet: 20 },
  save: { ability: 'dex', dc: 15, halfOnSuccess: true, damage: [{ roll: { count: 2, sides: 6 }, type: 'fire' }] },
};
const hold: CombatAction = { name: 'Hold Person', cost: 'action', source: 'spell', rangeFeet: 60, save: { ability: 'wis', dc: 15, halfOnSuccess: false, damage: [] } };

const ok = (result: ReturnType<typeof resolveSave>) => {
  if (!result.ok) throw new Error(result.reason);
  return result;
};

describe('resolveSave', () => {
  it('rolls the damage once, and each target saves for half or takes it all', () => {
    // Damage 4 + 6 = 10; the ogre rolls 5 (+2 = 7, fails), the knight 15 (+2 = 17, saves).
    const result = ok(resolveSave({ source: mage, targets: [target('Ogre', 4), target('Knight', 5)], action: fireball, board }, dice(4, 6, 5, 15)));
    expect(result.damage[0].rolled.total).toBe(10);
    expect(result.targets.map((t) => [t.outcome.success, t.dealt, t.hp?.current])).toEqual([
      [false, 10, 20],
      [true, 5, 25],
    ]);
    expect(result.summary).toBe('Fireball (DC 15 Dexterity, 10 fire): Ogre fails (7), 10 damage; Knight saves (17), 5 damage');
  });

  it('applies each target’s own defences', () => {
    const result = ok(
      resolveSave(
        { source: mage, targets: [target('Imp', 4, { defences: { immunities: ['fire'] } }), target('Treant', 5, { defences: { vulnerabilities: ['fire'] } })], action: fireball, board },
        dice(4, 6, 1, 1)
      )
    );
    expect(result.targets.map((t) => t.dealt)).toEqual([0, 20]);
  });

  it('deals nothing on a success when the effect is not for half, and no damage at all when it has none', () => {
    const result = ok(resolveSave({ source: mage, targets: [target('Guard', 4)], action: hold, board }, dice(3)));
    expect(result.targets[0]).toMatchObject({ dealt: 0, outcome: { success: false } });
    expect(result.summary).toBe('Hold Person (DC 15 Wisdom): Guard fails (5)');
  });

  it('fails a Dexterity save without a roll for a creature that cannot move', () => {
    const result = ok(resolveSave({ source: mage, targets: [target('Sleeper', 4, { conditions: ['unconscious'] })], action: fireball, board }, dice(1, 1, 20)));
    expect(result.targets[0].outcome).toMatchObject({ roll: null, success: false });
    expect(result.summary).toContain('Sleeper fails (no roll)');
  });

  it('adds cover to a Dexterity save', () => {
    const others = [at(2)];
    const result = ok(resolveSave({ source: mage, targets: [target('Ogre', 4)], action: fireball, board: { ...board, others } }, dice(1, 1, 11)));
    // 11 + 2 + 2 for half cover = 15.
    expect(result.targets[0].outcome).toMatchObject({ success: true });
  });

  it('refuses what cannot be done', () => {
    const none = { name: 'Roar', cost: 'action', source: 'statBlock' } as CombatAction;
    expect(resolveSave({ source: mage, targets: [target('Ogre', 4)], action: none, board })).toMatchObject({ ok: false });
    expect(resolveSave({ source: mage, targets: [], action: fireball, board })).toMatchObject({ ok: false });
    expect(resolveSave({ source: { ...mage, conditions: ['stunned'] }, targets: [target('Ogre', 4)], action: fireball, board })).toMatchObject({ ok: false });
    expect(resolveSave({ source: mage, targets: [target('Ogre', 4, { saveBonus: null })], action: fireball, board })).toEqual({ ok: false, reason: 'Ogre has no Dexterity save to roll' });
    expect(resolveSave({ source: mage, targets: [target('Guard', 13)], action: hold, board })).toEqual({
      ok: false,
      reason: 'Guard is 65 ft away, beyond what Hold Person can reach (60 ft)',
    });
  });

  it('does not check the range of an action that gives none', () => {
    const breath: CombatAction = { name: 'Fire Breath', cost: 'action', source: 'statBlock', save: fireball.save };
    expect(resolveSave({ source: mage, targets: [target('Knight', 60)], action: breath, board }, dice(1, 1, 1)).ok).toBe(true);
  });

  it('drops a target to 0', () => {
    const result = ok(resolveSave({ source: mage, targets: [target('Goblin', 4, { hp: { current: 7, max: 7, temp: 0 } })], action: fireball, board }, dice(4, 6, 1)));
    expect(result.targets[0]).toMatchObject({ dropped: true, hp: { current: 0 } });
    expect(result.summary).toContain('drops to 0');
  });
});
