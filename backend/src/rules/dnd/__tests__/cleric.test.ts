/**
 * A Cleric's features and the Life Domain: what each adds, read off the sheet.
 */

import type { CombatAction } from '../actions';
import { channelDivinityActions } from '../channelDivinity';
import {
  blessedHealerHealing,
  blessedStrikesOf,
  discipleOfLifeBonus,
  divineStrikeDice,
  hasSupremeHealing,
  preserveLife,
  preserveLifePool,
  rollHealing,
  searUndeadDice,
  withPotentSpellcasting,
} from '../cleric';

const cleric = (level: number, features: string[] = [], wisdom = 3) => ({
  class: 'Cleric',
  level,
  stats: { wisdom: { score: 10 + 2 * wisdom, modifier: wisdom } },
  spellcasting: { spellSaveDC: 13 },
  featuresAndTraits: features.map((name) => ({ name, description: '' })),
});
const sword: CombatAction = { name: 'Mace', cost: 'action', source: 'sheet', attack: { kind: 'melee', bonus: 5, reachFeet: 5, damage: [{ roll: { count: 1, sides: 6 }, type: 'bludgeoning' }] } };

describe('the Life Domain', () => {
  it('adds 2 + the slot level to a spell cast with a slot (Disciple of Life)', () => {
    const life = cleric(3, ['Disciple of Life (Cleric 3)']);
    expect([1, 3, 9].map((slot) => discipleOfLifeBonus(life, slot))).toEqual([3, 5, 11]);
    expect(discipleOfLifeBonus(life, null)).toBe(0);
    expect(discipleOfLifeBonus(cleric(3), 1)).toBe(0);
    expect(discipleOfLifeBonus({ ...life, class: 'Bard' }, 1)).toBe(0);
  });

  it('heals the Cleric when the spell heals another (Blessed Healer)', () => {
    const life = cleric(6, ['Blessed Healer']);
    expect(blessedHealerHealing(life, 2, true)).toBe(4);
    expect(blessedHealerHealing(life, 2, false)).toBe(0);
    expect(blessedHealerHealing(life, null, true)).toBe(0);
    expect(blessedHealerHealing(cleric(6), 2, true)).toBe(0);
  });

  it('takes healing dice at their highest (Supreme Healing)', () => {
    expect(hasSupremeHealing(cleric(17, ['Supreme Healing (Cleric 17)']))).toBe(true);
    expect(hasSupremeHealing(cleric(17))).toBe(false);
    const heal = { roll: { count: 2, sides: 8 }, bonus: 3 };
    expect(rollHealing(heal, true, () => 1)).toEqual({ dice: [8, 8], bonus: 3, total: 19 });
    expect(rollHealing(heal, false, () => 1).total).toBe(5);
  });

  it('lists Preserve Life last, with five times the Cleric level', () => {
    expect(preserveLifePool(cleric(4, ['Preserve Life']))).toBe(20);
    expect(preserveLifePool(cleric(4))).toBe(0);
    const actions = channelDivinityActions(cleric(4, ['Preserve Life (Cleric 3)']));
    expect(actions.map((action) => action.name)).toEqual(['Divine Spark (healing)', 'Divine Spark (Radiant)', 'Divine Spark (Necrotic)', 'Turn Undead', 'Preserve Life']);
    expect(actions[4]).toMatchObject({ divide: { pool: 20 }, rangeFeet: 30, channel: 'Channel Divinity', cost: 'action' });
  });

  it('divides Preserve Life among Bloodied creatures, each to half its maximum at most', () => {
    const at = (current: number, max: number, amount: number, name = 'Ally') => ({ name, hp: { current, max }, amount });
    expect(preserveLife(20, [at(2, 20, 5), at(8, 21, 10), at(0, 9, 4)])).toEqual({ restored: [5, 2, 4] });
    expect(preserveLife(15, [at(2, 20, 10), at(8, 21, 6)])).toEqual({ error: 'Preserve Life restores 15 Hit Points at most, and 16 were asked for' });
    expect(preserveLife(15, [at(11, 20, 5)])).toEqual({ error: 'Ally is not Bloodied' });
    expect(preserveLife(15, [at(10, 20, 5)])).toEqual({ error: 'Preserve Life restores a creature to no more than half its Hit Point maximum' });
    expect(preserveLife(15, [{ name: 'Statue', hp: null, amount: 5 }])).toEqual({ error: 'Statue tracks no Hit Points' });
  });
});

describe('Sear Undead', () => {
  it('rolls the Wisdom modifier in d8s from Cleric 5, at least one', () => {
    expect(searUndeadDice(cleric(4))).toBe(0);
    expect(searUndeadDice(cleric(5))).toBe(3);
    expect(searUndeadDice(cleric(5, [], -1))).toBe(1);
  });

  it('is Turn Undead’s damage on a failed save', () => {
    const turn = channelDivinityActions(cleric(5)).find((action) => action.name === 'Turn Undead')!;
    expect(turn.save).toMatchObject({ halfOnSuccess: false, damage: [{ roll: { count: 3, sides: 8 }, type: 'radiant' }] });
  });
});

describe('Blessed Strikes', () => {
  it('reads the option a feature names, from Cleric 7', () => {
    expect(blessedStrikesOf(cleric(7, ['Divine Strike']))).toBe('divineStrike');
    expect(blessedStrikesOf(cleric(7, ['Blessed Strikes (Divine Strike)']))).toBe('divineStrike');
    expect(blessedStrikesOf(cleric(7, ['Blessed Strikes: Potent Spellcasting']))).toBe('potentSpellcasting');
    expect(blessedStrikesOf(cleric(7, ['Blessed Strikes (Cleric 7)']))).toBeNull();
    expect(blessedStrikesOf(cleric(7, ['Divine Strike', 'Potent Spellcasting']))).toBeNull();
    expect(blessedStrikesOf(cleric(6, ['Divine Strike']))).toBeNull();
  });

  it('gives Divine Strike 1d8 on a weapon hit, 2d8 from Cleric 14', () => {
    expect(divineStrikeDice(cleric(7, ['Divine Strike']), sword)).toBe(1);
    expect(divineStrikeDice(cleric(14, ['Divine Strike']), sword)).toBe(2);
    expect(divineStrikeDice(cleric(7, ['Divine Strike']), { ...sword, source: 'spell' })).toBe(0);
    expect(divineStrikeDice(cleric(7, ['Divine Strike']), { ...sword, source: 'unarmed', unarmed: 'damage' })).toBe(0);
    expect(divineStrikeDice(cleric(7, ['Potent Spellcasting']), sword)).toBe(0);
  });

  it('adds the Wisdom modifier to a Cleric cantrip’s damage with Potent Spellcasting', () => {
    const cantrip = (id: string, name: string): CombatAction => ({
      name,
      cost: 'action',
      source: 'spell',
      spell: { id, level: 0 },
      save: { ability: 'dex', dc: 13, halfOnSuccess: false, damage: [{ roll: { count: 1, sides: 8 }, type: 'radiant' }] },
    });
    const actions = [cantrip('sacred-flame', 'Sacred Flame'), cantrip('acid-splash', 'Acid Splash'), { ...cantrip('guiding-bolt', 'Guiding Bolt'), spell: { id: 'guiding-bolt', level: 1 } }];
    const potent = withPotentSpellcasting(cleric(7, ['Potent Spellcasting']), actions);
    expect(potent.map((action) => action.save!.damage[0].roll.bonus ?? 0)).toEqual([3, 0, 0]);
    expect(withPotentSpellcasting(cleric(7, ['Divine Strike']), actions)).toEqual(actions);
  });
});
