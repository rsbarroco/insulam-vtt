/**
 * Stunning Strike: the Monk's save DC and the attacks it follows.
 */

import { isMonkAttack, monkSaveDC } from '../stunningStrike';
import type { CombatAction } from '../actions';

const attack = (name: string, over: Partial<CombatAction> = {}): CombatAction =>
  ({ name, cost: 'action', source: 'sheet', attack: { kind: 'melee' }, ...over }) as CombatAction;

describe('Stunning Strike', () => {
  it('sets the DC at 8 + Wisdom modifier + Proficiency Bonus', () => {
    expect(monkSaveDC({ proficiencyBonus: 3, stats: { wisdom: { score: 16, modifier: 3 } } })).toBe(14);
  });

  it('follows a Simple Melee weapon, a Light Martial Melee one, or an Unarmed Strike', () => {
    expect(isMonkAttack(attack('Quarterstaff'))).toBe(true);
    expect(isMonkAttack(attack('Shortsword'))).toBe(true);
    expect(isMonkAttack(attack('Longsword'))).toBe(false);
    expect(isMonkAttack(attack('Shortbow'))).toBe(false);
    expect(isMonkAttack(attack('Unarmed Strike', { unarmed: 'damage' }))).toBe(true);
    expect(isMonkAttack(attack('Fire Bolt', { source: 'spell' }))).toBe(false);
  });
});
