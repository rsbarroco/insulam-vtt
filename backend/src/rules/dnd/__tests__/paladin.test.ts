/**
 * A Paladin's features: Abjure Foes, Sacred Weapon, Radiant Strikes and the
 * conditions Lay on Hands ends.
 */

import type { CombatAction } from '../actions';
import { abjureFoesTargets, canBeSacred, layOnHandsCures, paladinChannelActions, radiantStrikes, sacredWeaponBonus, withSacredWeapon } from '../paladin';

const paladin = (level: number, features: string[], charisma = 3, extra: Record<string, unknown> = {}) => ({
  class: 'Paladin',
  level,
  proficiencyBonus: 4,
  featuresAndTraits: features.map((name) => ({ name })),
  stats: { charisma: { score: 10 + 2 * charisma, modifier: charisma } },
  ...extra,
});
const sword: CombatAction = {
  name: 'Longsword',
  cost: 'action',
  source: 'sheet',
  attack: { kind: 'melee', bonus: 5, damage: [{ roll: { count: 1, sides: 8, bonus: 3 }, type: 'slashing' }] },
};
const bow: CombatAction = { ...sword, name: 'Longbow', attack: { ...sword.attack!, kind: 'ranged' } };
const fist: CombatAction = { name: 'Unarmed Strike', cost: 'action', source: 'unarmed', unarmed: 'damage', attack: { kind: 'melee', bonus: 5, damage: [] } };

describe('Abjure Foes', () => {
  it('is an action of a Paladin 9 with the feature and a use of Channel Divinity left', () => {
    const [action] = paladinChannelActions(paladin(9, ['Abjure Foes (Paladin 9)']));
    expect(action).toMatchObject({
      name: 'Abjure Foes',
      rangeFeet: 60,
      channel: 'Channel Divinity',
      maxTargets: 3,
      untilDamaged: ['Frightened'],
      // 8 + Charisma modifier + Proficiency Bonus.
      save: { ability: 'wis', dc: 15, halfOnSuccess: false },
    });
    expect(paladinChannelActions(paladin(8, ['Abjure Foes']))).toEqual([]);
    expect(paladinChannelActions(paladin(9, []))).toEqual([]);
    const uses = paladin(9, ['Abjure Foes'], 3, { featureUses: { 'Channel Divinity': 2 } });
    expect(paladinChannelActions(uses)).toEqual([]);
  });

  it('chooses as many creatures as the Charisma modifier, at least one', () => {
    expect(abjureFoesTargets(paladin(9, [], 4))).toBe(4);
    expect(abjureFoesTargets(paladin(9, [], -1))).toBe(1);
  });
});

describe('Sacred Weapon', () => {
  it('imbues a Melee weapon, not a Ranged one or an Unarmed Strike', () => {
    expect(canBeSacred(sword)).toBe(true);
    expect(canBeSacred(bow)).toBe(false);
    expect(canBeSacred(fist)).toBe(false);
  });

  it('adds the Charisma modifier, at least 1, and deals Radiant when asked', () => {
    expect(sacredWeaponBonus(paladin(3, [], 3))).toBe(3);
    expect(sacredWeaponBonus(paladin(3, [], 0))).toBe(1);
    expect(withSacredWeapon(sword, 3, false).attack).toMatchObject({ bonus: 8, damage: [{ type: 'slashing' }] });
    expect(withSacredWeapon(sword, 3, true).attack).toMatchObject({ bonus: 8, damage: [{ roll: { count: 1, sides: 8, bonus: 3 }, type: 'radiant' }] });
  });
});

describe('Radiant Strikes', () => {
  it('adds 1d8 Radiant to a Melee weapon or Unarmed Strike hit', () => {
    const sheet = paladin(11, ['Radiant Strikes (Paladin 11)']);
    expect(radiantStrikes(sheet, sword)).toEqual({ roll: { count: 1, sides: 8 }, type: 'radiant' });
    expect(radiantStrikes(sheet, fist)).toEqual({ roll: { count: 1, sides: 8 }, type: 'radiant' });
    expect(radiantStrikes(sheet, bow)).toBeNull();
    expect(radiantStrikes(sheet, { ...sword, source: 'spell' })).toBeNull();
    expect(radiantStrikes(paladin(11, []), sword)).toBeNull();
    expect(radiantStrikes(null, sword)).toBeNull();
  });
});

describe('Lay on Hands', () => {
  it('ends Poisoned, and the conditions of Restoring Touch with the feature', () => {
    expect(layOnHandsCures(paladin(5, []))).toEqual(['Poisoned']);
    expect(layOnHandsCures(paladin(14, ['Restoring Touch']))).toEqual(['Poisoned', 'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Paralyzed', 'Stunned']);
  });
});
