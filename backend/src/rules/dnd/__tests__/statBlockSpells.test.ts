import { actionFromStatBlockEntry } from '../actions';
import { findMonster } from '../monsters';
import { counterable } from '../reactionSpells';
import {
  dailyUsesLeft,
  DAILY_USES,
  statBlockCastOption,
  statBlockReactionCast,
  statBlockSpellActions,
  statBlockSpellcasting,
  withDailyUseSpent,
} from '../statBlockSpells';

const mage = findMonster('Mage')!.statBlock;
const lich = findMonster('Lich')!.statBlock;

describe('a stat block’s Spellcasting', () => {
  it('reads the Mage’s DC, its lists and the version of each spell', () => {
    const casting = statBlockSpellcasting(mage)!;
    expect(casting.spellSaveDC).toBe(14);
    expect(casting.spellAttackBonus).toBe(6);
    expect(casting.components).toEqual(['V', 'S', 'M']);
    const fireball = casting.spells.find((entry) => entry.spell.id === 'fireball')!;
    expect(fireball).toMatchObject({ level: 4, perDay: 2 });
    expect(casting.spells.find((entry) => entry.spell.id === 'detect-magic')!.perDay).toBeNull();
    expect(casting.spells.find((entry) => entry.spell.id === 'cone-of-cold')!.perDay).toBe(1);
  });

  it('reads the components a stat block drops, and lists with a comma inside parentheses', () => {
    expect(statBlockSpellcasting(findMonster('Adult Red Dragon')!.statBlock)!.components).toEqual(['V', 'S']);
    expect(statBlockSpellcasting(findMonster('Unicorn')!.statBlock)!.components).toEqual([]);
    expect(statBlockSpellcasting(findMonster('Spirit Naga')!.statBlock)!.components).toEqual(['V']);
    const couatl = statBlockSpellcasting(findMonster('Couatl')!.statBlock)!;
    expect(couatl.spells.map((entry) => entry.spell.name)).toEqual(expect.arrayContaining(['Shapechange', 'Sleep', 'Dream']));
    expect(couatl.spells.find((entry) => entry.spell.name === 'Sleep')!.perDay).toBe(1);
    expect(statBlockSpellcasting(findMonster('Goblin Warrior')!.statBlock)).toBeNull();
  });

  it('turns the list into spell actions at their version, with the DC and the uses a day', () => {
    const fireball = statBlockSpellActions(mage).find((action) => action.name === 'Fireball')!;
    expect(fireball.save).toMatchObject({ ability: 'dex', dc: 14, halfOnSuccess: true });
    expect(fireball.save!.damage[0].roll.count).toBe(9);
    expect(fireball.perDay).toBe(2);
    expect(counterable(fireball)).toBe(true);
    const lichFireball = statBlockSpellActions(lich).find((action) => action.name === 'Fireball')!;
    expect(lichFireball.save!.damage[0].roll.count).toBe(10);
    expect(lichFireball.perDay).toBeUndefined();
    // The Unicorn's spells need no components: Counterspell cannot answer them.
    const entangle = statBlockSpellActions(findMonster('Unicorn')!.statBlock).find((action) => action.name === 'Entangle')!;
    expect(counterable(entangle)).toBe(false);
  });

  it('reads the uses a day an entry’s name writes', () => {
    expect(actionFromStatBlockEntry({ name: 'Misty Step (3/Day)', description: 'The mage casts Misty Step.' }, 'bonusAction').perDay).toBe(3);
    expect(actionFromStatBlockEntry({ name: 'Bite', description: 'Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6 + 2) Piercing damage.' }, 'action').perDay).toBeUndefined();
  });
});

describe('a stat block’s Reaction spells', () => {
  it('casts Shield and Counterspell with Protective Magic, three times a day', () => {
    const shield = statBlockReactionCast(mage, 'Shield', {})!;
    expect(shield).toMatchObject({ spell: 'Shield', level: 1, spellSaveDC: 14, via: 'Protective Magic (3/Day)', perDay: 3, left: 3 });
    expect(statBlockCastOption(shield)).toBe('Shield (Protective Magic, 3 of 3/Day left)');
    const counter = statBlockReactionCast(mage, 'Counterspell', {})!;
    expect(counter.via).toBe('Protective Magic (3/Day)');
    expect(statBlockReactionCast(mage, 'Hellish Rebuke', {})).toBeNull();
    expect(statBlockReactionCast(findMonster('Gladiator')!.statBlock, 'Shield', {})).toBeNull();
  });

  it('shares the uses between the spells, and offers none once they are gone', () => {
    let metadata: Record<string, unknown> = {};
    for (let i = 0; i < 2; i++) metadata = { [DAILY_USES]: withDailyUseSpent(metadata, 'Protective Magic (3/Day)') };
    expect(statBlockReactionCast(mage, 'Counterspell', metadata)!.left).toBe(1);
    metadata = { [DAILY_USES]: withDailyUseSpent(metadata, 'Protective Magic (3/Day)') };
    expect(dailyUsesLeft(metadata, 'Protective Magic (3/Day)', 3)).toBe(0);
    expect(statBlockReactionCast(mage, 'Shield', metadata)).toBeNull();
  });

  it('casts at will with a reaction that writes no uses: the Lich', () => {
    const shield = statBlockReactionCast(lich, 'Shield', {})!;
    expect(shield).toMatchObject({ perDay: null, left: null, spellSaveDC: 20 });
    expect(statBlockCastOption(shield)).toBe('Shield (Protective Magic, at will)');
  });

  it('casts a Reaction spell its Spellcasting lists, with that list’s uses', () => {
    const block = {
      actions: [{ name: 'Spellcasting', description: 'The cultist casts one of the following spells, using Charisma as the spellcasting ability (spell save DC 13): At Will: Light 1/Day Each: Hellish Rebuke (level 2 version), Feather Fall' }],
    };
    const rebuke = statBlockReactionCast(block, 'Hellish Rebuke', {})!;
    expect(rebuke).toMatchObject({ level: 2, perDay: 1, via: 'Hellish Rebuke', spellSaveDC: 13 });
    expect(statBlockCastOption(rebuke)).toBe('Hellish Rebuke (1 of 1/Day left)');
    expect(statBlockReactionCast(block, 'Feather Fall', { [DAILY_USES]: { 'Feather Fall': 1 } })).toBeNull();
  });
});
