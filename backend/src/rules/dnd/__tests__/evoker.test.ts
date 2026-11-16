/**
 * The Evoker's features and Magic Missile: Potent Cantrip, Sculpt Spells,
 * Empowered Evocation, Overchannel and darts that strike with no roll.
 */

import {
  canOverchannel,
  canSculpt,
  empoweredEvocationBonus,
  evokerCasting,
  overchannelBacklash,
  overchannelRefusal,
  potentMiss,
  resolveDarts,
  sculptCount,
  sculptSpells,
} from '../evoker';
import type { AttackResult, Combatant } from '../resolveAttack';
import { resolveAttack } from '../resolveAttack';
import { resolveSave } from '../resolveSave';
import { resourcesOf, restoreResources, spendResource } from '../resources';
import { actionFromSpell, findSpell } from '../spells';

const caster = { spellAttackBonus: 7, spellSaveDC: 15, level: 14, abilityModifier: 4 };
const spell = (name: string, slot?: number) => actionFromSpell(findSpell(name)!, caster, slot)!;
const evoker = (features: string[], extra: Record<string, unknown> = {}) => ({
  class: 'Wizard',
  level: 14,
  stats: { intelligence: { score: 18, modifier: 4 } },
  featuresAndTraits: features.map((name) => ({ name })),
  ...extra,
});
const all = evoker(['Potent Cantrip', 'Sculpt Spells', 'Empowered Evocation', 'Overchannel']);
const mage = { id: 'mage', name: 'Mage' };

const at = (x: number) => ({ cell: { x, y: 0 }, size: { width: 1, height: 1 } });
const board = { heights: null, feetPerSquare: 5, diagonalRule: 'flat' as const, others: [] };
const body = (name: string, x: number, extra: Partial<Combatant> = {}): Combatant => ({
  name,
  standing: at(x),
  armorClass: 12,
  hp: { current: 30, max: 30, temp: 0 },
  conditions: [],
  ...extra,
});
const dice = (...values: number[]) => {
  const left = [...values];
  return () => left.shift() ?? 1;
};

describe('Potent Cantrip', () => {
  it('deals half the cantrip’s damage on a missed attack roll', () => {
    const cast = evokerCasting(evoker(['Potent Cantrip']), mage, spell('Fire Bolt'), null, { targetIds: ['ogre'] });
    if ('error' in cast) throw new Error(cast.error);
    expect(cast.potent).toBe(true);
    const ogre = body('Ogre', 2, { armorClass: 30 });
    // The d20 comes up 5: a miss. The level 14 cantrip's 3d10 then come up 7, 4 and 4.
    const miss = resolveAttack({ attacker: body('Mage', 0), target: ogre, action: cast.action, board }, dice(5)) as AttackResult;
    expect(miss.outcome.hit).toBe(false);
    const result = potentMiss(miss, ogre, cast.action, dice(7, 4, 4));
    expect(result.dealt).toBe(7);
    expect(result.hp?.current).toBe(23);
    expect(result.outcome.hit).toBe(false);
    expect(result.summary).toContain('miss, half damage: 7 fire damage');
    expect(result.bonuses).toContain('Potent Cantrip');
  });

  it('leaves a hit alone, and halves through the target’s Resistance', () => {
    const bolt = spell('Fire Bolt');
    const ogre = body('Ogre', 2, { defences: { resistances: ['fire'] } });
    const hit = resolveAttack({ attacker: body('Mage', 0), target: ogre, action: bolt, board }, dice(15, 5, 5, 5)) as AttackResult;
    expect(potentMiss(hit, ogre, bolt)).toBe(hit);
    const miss = resolveAttack({ attacker: body('Mage', 0), target: { ...ogre, armorClass: 30 }, action: bolt, board }, dice(5)) as AttackResult;
    // 3d10 of 6s: 18, halved to 9, and Resistance leaves 4.
    expect(potentMiss(miss, ogre, bolt, dice(6, 6, 6)).dealt).toBe(4);
  });

  it('makes a successful save against a cantrip take half', () => {
    const cast = evokerCasting(evoker(['Potent Cantrip']), mage, spell('Sacred Flame'), null, { targetIds: ['ogre'] });
    if ('error' in cast) throw new Error(cast.error);
    expect(cast.action.save?.halfOnSuccess).toBe(true);
    // A levelled spell is not a cantrip.
    const burning = evokerCasting(evoker(['Potent Cantrip']), mage, spell('Burning Hands'), 1, { targetIds: ['ogre'] });
    expect('error' in burning ? null : burning.potent).toBe(false);
    // Another class's sheet that lists the name is not an Evoker's.
    const cleric = evokerCasting({ ...evoker(['Potent Cantrip']), class: 'Cleric' }, mage, spell('Sacred Flame'), null, { targetIds: ['ogre'] });
    expect('error' in cleric ? null : cleric.potent).toBe(false);
  });
});

describe('Sculpt Spells', () => {
  const fireball = spell('Fireball');

  it('protects 1 + the level of the slot of the other creatures', () => {
    expect(sculptCount(fireball, 3)).toBe(4);
    expect(sculptCount(fireball, 5)).toBe(6);
    expect(canSculpt(all, fireball)).toBe(true);
    expect(sculptSpells(all, mage, fireball, 3, ['a', 'b'], ['a', 'b', 'c'])).toEqual({ protectedIds: new Set(['a', 'b']) });
  });

  it('refuses what the rules do not allow', () => {
    const five = ['a', 'b', 'c', 'd', 'e'];
    expect(sculptSpells(all, mage, fireball, 3, five, five)).toEqual({ error: 'Sculpt Spells protects 4 creatures at most with this spell' });
    expect(sculptSpells(all, mage, fireball, 3, ['mage'], ['mage', 'a'])).toEqual({ error: 'Sculpt Spells protects other creatures' });
    expect(sculptSpells(all, mage, fireball, 3, ['z'], ['a'])).toEqual({ error: "Sculpt Spells picks creatures among the spell's targets" });
    expect(sculptSpells(evoker([]), mage, fireball, 3, ['a'], ['a'])).toEqual({ error: 'Mage has no Sculpt Spells' });
    // Hold Person is an Enchantment.
    expect(sculptSpells(all, mage, spell('Hold Person'), 2, ['a'], ['a'])).toEqual({ error: 'Sculpt Spells changes a spell of the Evocation school' });
    expect(canSculpt(all, spell('Hold Person'))).toBe(false);
  });

  it('makes a protected creature succeed and take no damage', () => {
    const result = resolveSave(
      {
        source: body('Mage', 0),
        targets: [
          { ...body('Ogre', 4), saveBonus: 0 },
          { ...body('Friend', 5), saveBonus: 0, protected: true },
        ],
        action: fireball,
        board,
        protectedBy: 'Sculpt Spells',
      },
      dice(6, 6, 6, 6, 6, 6, 6, 6, 2)
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.targets.map((target) => target.dealt)).toEqual([48, 0]);
    expect(result.summary).toContain('Friend saves (no roll), 0 damage (Sculpt Spells)');
  });
});

describe('Empowered Evocation', () => {
  it('adds the Intelligence modifier to one damage roll of a Wizard Evocation spell', () => {
    expect(empoweredEvocationBonus(all, spell('Fireball'))).toBe(4);
    const cast = evokerCasting(all, mage, spell('Fireball'), 3, { targetIds: ['a'] });
    expect('error' in cast ? null : cast.action.save?.damage[0].roll).toEqual({ count: 8, sides: 6, bonus: 4 });
    const bolt = evokerCasting(all, mage, spell('Fire Bolt'), null, { targetIds: ['a'] });
    expect('error' in bolt ? null : bolt.action.attack?.damage[0].roll.bonus).toBe(4);
  });

  it('adds nothing to another school, another list, or with a modifier below 1', () => {
    // Hold Person deals no damage; Blight is Necromancy; Sacred Flame is not on the Wizard list.
    expect(empoweredEvocationBonus(all, spell('Blight'))).toBe(0);
    expect(empoweredEvocationBonus(all, spell('Sacred Flame'))).toBe(0);
    expect(empoweredEvocationBonus(evoker(['Empowered Evocation'], { stats: { intelligence: { score: 8, modifier: -1 } } }), spell('Fireball'))).toBe(0);
    expect(empoweredEvocationBonus(evoker([]), spell('Fireball'))).toBe(0);
  });
});

describe('Overchannel', () => {
  it('changes a damaging Wizard spell cast with a slot of level 1 to 5', () => {
    expect(overchannelRefusal(all, 'Mage', spell('Fireball'), 3)).toBeNull();
    expect(overchannelRefusal(all, 'Mage', spell('Fireball', 6), 6)).toBe('Overchannel changes a spell cast with a spell slot of level 1 to 5');
    expect(overchannelRefusal(all, 'Mage', spell('Fire Bolt'), null)).toBe('Overchannel changes a spell cast with a spell slot of level 1 to 5');
    expect(overchannelRefusal(all, 'Mage', spell('Hold Person'), 2)).toBe('Overchannel changes a spell that deals damage');
    expect(overchannelRefusal(all, 'Mage', spell('Guiding Bolt'), 1)).toBe('Overchannel changes a Wizard spell');
    expect(overchannelRefusal(evoker([]), 'Mage', spell('Fireball'), 3)).toBe('Mage has no Overchannel');
    expect(canOverchannel(all, spell('Fireball'))).toBe(true);
    expect(canOverchannel(all, spell('Fire Bolt'))).toBe(false);
  });

  it('costs nothing the first time, then 2d12 a slot level, 1d12 more each time', () => {
    expect(overchannelBacklash(0, 5)).toBeNull();
    expect(overchannelBacklash(1, 3)).toEqual({ count: 6, sides: 12 });
    expect(overchannelBacklash(2, 3)).toEqual({ count: 9, sides: 12 });
    expect(overchannelBacklash(3, 1)).toEqual({ count: 4, sides: 12 });
  });

  it('counts its uses on the sheet until a Long Rest', () => {
    expect(resourcesOf(all).find((entry) => entry.name === 'Overchannel')).toMatchObject({ used: 0, shortRest: 'none' });
    expect(resourcesOf(evoker([])).some((entry) => entry.name === 'Overchannel')).toBe(false);
    const spent = spendResource(all, 'Overchannel');
    if (!spent.ok) throw new Error(spent.reason);
    const again = evokerCasting(spent.sheet, mage, spell('Fireball'), 3, { overchannel: true, targetIds: ['a'] });
    expect('error' in again ? null : again.backlash).toEqual({ count: 6, sides: 12 });
    expect(resourcesOf(restoreResources(spent.sheet, 'short').sheet).find((entry) => entry.name === 'Overchannel')?.used).toBe(1);
    expect(resourcesOf(restoreResources(spent.sheet, 'long').sheet).find((entry) => entry.name === 'Overchannel')?.used).toBe(0);
  });

  it('deals each die at its highest number, on a save and on a hit', () => {
    const saved = resolveSave({ source: body('Mage', 0), targets: [{ ...body('Ogre', 4), saveBonus: 0 }], action: spell('Fireball'), board, maximum: true }, dice(2));
    expect(saved.ok && saved.targets[0].dealt).toBe(48);
    // Chromatic Orb, 3d8: a Critical Hit's six dice are all 8s.
    const orb = spell('Chromatic Orb');
    const hit = resolveAttack({ attacker: body('Mage', 0), target: body('Ogre', 4, { hp: { current: 90, max: 90, temp: 0 } }), action: orb, board, maximum: true }, dice(20));
    expect(hit.ok && hit.dealt).toBe(48);
  });
});

describe('Magic Missile', () => {
  it('makes three darts, one more for each slot level above 1', () => {
    expect(spell('Magic Missile').darts).toEqual({ count: 3, damage: { roll: { count: 1, sides: 4, bonus: 1 }, type: 'force' } });
    expect(spell('Magic Missile', 3).darts?.count).toBe(5);
    expect(spell('Magic Missile').rangeFeet).toBe(120);
    expect(spell('Magic Missile').save).toBeUndefined();
  });

  it('divides the darts among the targets, each rolling its own damage', () => {
    const result = resolveDarts(
      { source: body('Mage', 0), targets: [{ ...body('Ogre', 4), darts: 2 }, { ...body('Imp', 5, { defences: { resistances: ['force'] } }), darts: 1 }], action: spell('Magic Missile'), board },
      dice(4, 2, 3)
    );
    if (!result.ok) throw new Error(result.reason);
    // 5 + 3 on the Ogre; 4 on the Imp, halved by its Resistance.
    expect(result.targets.map((target) => target.dealt)).toEqual([8, 2]);
    expect(result.targets[0].hp?.current).toBe(22);
    expect(result.summary).toBe('Magic Missile (3 darts): Ogre is struck by 2 darts (5 + 3): 8 force damage; Imp is struck by 1 dart (4): 2 force damage');
  });

  it('adds Empowered Evocation to one dart, and deals the most with Overchannel', () => {
    const one = resolveDarts({ source: body('Mage', 0), targets: [{ ...body('Ogre', 4), darts: 3 }], action: spell('Magic Missile'), board, bonus: 4 }, dice(1, 1, 1));
    expect(one.ok && one.targets[0].dealt).toBe(10);
    const most = resolveDarts({ source: body('Mage', 0), targets: [{ ...body('Ogre', 4), darts: 3 }], action: spell('Magic Missile'), board, maximum: true }, dice(1, 1, 1));
    expect(most.ok && most.targets[0].dealt).toBe(15);
  });

  it('refuses darts that do not add up, a target out of range, and a caster that cannot act', () => {
    const missile = spell('Magic Missile');
    const ogre = { ...body('Ogre', 4), darts: 2 };
    expect(resolveDarts({ source: body('Mage', 0), targets: [ogre], action: missile, board })).toEqual({ ok: false, reason: 'Magic Missile makes 3 darts; 2 were divided' });
    expect(resolveDarts({ source: body('Mage', 0), targets: [{ ...body('Far', 30), darts: 3 }], action: missile, board })).toMatchObject({ ok: false });
    expect(resolveDarts({ source: body('Mage', 0, { conditions: ['stunned'] }), targets: [{ ...ogre, darts: 3 }], action: missile, board })).toMatchObject({ ok: false });
  });
});
