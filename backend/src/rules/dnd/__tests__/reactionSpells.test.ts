import {
  counterable,
  hasPrepared,
  hellishRebukeDamage,
  lowestReactionSlot,
  reactionSlots,
  shieldTurnsHit,
  slotOfOption,
  slotOption,
} from '../reactionSpells';
import { actionFromSpell, findSpell } from '../spells';
import { resolveAttack, type AttackRequest } from '../resolveAttack';
import { withFeatherFall, resolveFall } from '../falling';

const sheet = (slots: Record<string, { total: number; expended: number }>, prepared = true) => ({
  spellcasting: {
    spellAttackBonus: 5,
    spellSaveDC: 13,
    spells: [
      { name: 'Shield', level: 1, prepared },
      { name: 'counterspell', level: 3 },
    ],
    slots,
  },
});

describe('reaction spells on a sheet', () => {
  it('reads a prepared spell whatever its case, and not one marked unprepared', () => {
    expect(hasPrepared(sheet({}), 'Shield')).toBe(true);
    expect(hasPrepared(sheet({}), 'Counterspell')).toBe(true);
    expect(hasPrepared(sheet({}, false), 'Shield')).toBe(false);
    expect(hasPrepared(sheet({}), 'Hellish Rebuke')).toBe(false);
    expect(hasPrepared(null, 'Shield')).toBe(false);
  });

  it('lists the slots of the spell’s level or higher that are left, lowest first', () => {
    const slots = { '1': { total: 2, expended: 2 }, '2': { total: 1, expended: 0 }, '4': { total: 1, expended: 0 } };
    expect(reactionSlots(sheet(slots), 'Shield')).toEqual([2, 4]);
    expect(lowestReactionSlot(sheet(slots), 'Shield')).toBe(2);
    expect(reactionSlots(sheet(slots), 'Counterspell')).toEqual([4]);
    expect(lowestReactionSlot(sheet({ '2': { total: 1, expended: 0 } }), 'Counterspell')).toBeNull();
    expect(reactionSlots(sheet(slots, false), 'Shield')).toEqual([]);
  });

  it('names the slot in a prompt option and reads it back', () => {
    expect(slotOption('Shield', 1)).toBe('Shield (level 1 slot)');
    expect(slotOfOption('Hellish Rebuke', 'Hellish Rebuke (level 3 slot)')).toBe(3);
    expect(slotOfOption('Hellish Rebuke', 'Shield (level 3 slot)')).toBeNull();
    expect(slotOfOption('Hellish Rebuke', null)).toBeNull();
  });
});

describe('Shield', () => {
  const outcome = (natural: number, total: number, hit = true) => ({ hit, armorClass: 15, roll: { natural, total } });

  it('turns a hit whose total falls short of the Armor Class plus 5', () => {
    expect(shieldTurnsHit(outcome(10, 15))).toBe(true);
    expect(shieldTurnsHit(outcome(14, 19))).toBe(true);
    expect(shieldTurnsHit(outcome(15, 20))).toBe(false);
  });

  it('turns neither a natural 20 nor a miss', () => {
    expect(shieldTurnsHit(outcome(20, 19))).toBe(false);
    expect(shieldTurnsHit(outcome(5, 10, false))).toBe(false);
  });

  it('decides the kept roll again against the raised Armor Class, without rolling', () => {
    const request: AttackRequest = {
      attacker: { name: 'Ogre', standing: { cell: { x: 0, y: 0 }, size: { width: 1, height: 1 } }, armorClass: 11, hp: null, conditions: [] },
      target: { name: 'Mage', standing: { cell: { x: 1, y: 0 }, size: { width: 1, height: 1 } }, armorClass: 12, hp: { current: 20, max: 20, temp: 0 }, conditions: [] },
      action: {
        name: 'Greatclub',
        cost: 'action',
        source: 'statBlock',
        attack: { kind: 'melee', bonus: 6, reachFeet: 5, damage: [{ roll: { count: 2, sides: 8, bonus: 4 }, type: 'bludgeoning' }] },
      },
      board: { heights: null, feetPerSquare: 5, diagonalRule: 'flat', others: [] },
    };
    const dice = [8, 3, 3];
    const hit = resolveAttack(request, () => dice.shift() ?? 1);
    if (!hit.ok) throw new Error(hit.reason);
    expect(hit.outcome.hit).toBe(true);
    expect(hit.dealt).toBe(10);
    const again = resolveAttack({ ...request, target: { ...request.target, armorClass: 17 }, kept: { roll: hit.outcome.roll } }, () => {
      throw new Error('no die is rolled');
    });
    if (!again.ok) throw new Error(again.reason);
    expect(again.outcome.hit).toBe(false);
    expect(again.outcome.roll).toEqual(hit.outcome.roll);
    expect(again.outcome.armorClass).toBe(17);
    expect(again.dealt).toBe(0);
    expect(again.hp).toEqual({ current: 20, max: 20, temp: 0 });
    expect(again.summary).toBe('Greatclub vs Mage (AC 17): miss');
  });
});

describe('Hellish Rebuke', () => {
  it('deals 2d10 Fire, and 1d10 more for each slot level above 1', () => {
    expect(hellishRebukeDamage(1)).toEqual({ roll: { count: 2, sides: 10, bonus: 0 }, type: 'fire' });
    expect(hellishRebukeDamage(3).roll.count).toBe(4);
  });
});

describe('Counterspell', () => {
  const caster = { spellAttackBonus: 5, spellSaveDC: 13 };

  it('answers a spell with a Verbal, Somatic or Material component', () => {
    expect(counterable(actionFromSpell(findSpell('Fire Bolt')!, caster)!)).toBe(true);
    expect(counterable({ name: 'Greatclub', cost: 'action', source: 'statBlock' })).toBe(false);
  });

  it('does not answer a cast without its Verbal and Somatic components, unless it has a Material one', () => {
    expect(counterable(actionFromSpell(findSpell('Fire Bolt')!, caster)!, true)).toBe(false);
    expect(findSpell('Fireball')!.components).toContain('M');
    expect(counterable(actionFromSpell(findSpell('Fireball')!, caster)!, true)).toBe(true);
  });
});

describe('Feather Fall', () => {
  it('leaves a fall with no damage and the creature on its feet', () => {
    const faller = { name: 'Hero', hp: { current: 20, max: 20, temp: 0 } };
    const fall = resolveFall(faller, 30, () => 4);
    expect(fall.dealt).toBe(12);
    const soft = withFeatherFall(fall, faller, 'Hero');
    expect(soft).toMatchObject({ dealt: 0, prone: false, dropped: false, hp: faller.hp });
    expect(soft.summary).toBe('Hero falls 30 ft: no damage (Feather Fall)');
    expect(withFeatherFall(fall, faller, 'Mage').summary).toBe('Hero falls 30 ft: no damage (Feather Fall, cast by Mage)');
  });
});
