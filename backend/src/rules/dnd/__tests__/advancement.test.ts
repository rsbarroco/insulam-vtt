/**
 * What a character gains by level: the rules as written, gestalt, and the
 * campaign's house rules.
 */

import { DEFAULT_CHARACTER_RULES, RULES_AS_WRITTEN, readCharacterRules, abilityScoreCap } from '../../../utils/characterRules';
import {
  casterLevel, fixedHitPoints, hitDie, improvements, pactMagic, proficiencyBonus, savingThrowProficiencies,
  scoreWithinCap, spellSlots, tracksRefusal,
} from '../advancement';

const house = DEFAULT_CHARACTER_RULES;
const written = RULES_AS_WRITTEN;

describe('the campaign switches', () => {
  it('are all on by default, and read what is stored over the defaults', () => {
    expect(readCharacterRules(null)).toEqual(house);
    expect(readCharacterRules({ gestalt: false, abilityScoreCap22: 'no', extra: true })).toEqual({ ...house, gestalt: false });
    expect(readCharacterRules([false])).toEqual(house);
  });

  it('cap ability scores at 22, or at 20 as written', () => {
    expect(abilityScoreCap(house)).toBe(22);
    expect(abilityScoreCap(written)).toBe(20);
    expect(scoreWithinCap(22, house)).toBe(true);
    expect(scoreWithinCap(23, house)).toBe(false);
    expect(scoreWithinCap(21, written)).toBe(false);
  });
});

describe('classes', () => {
  it('allows two classes only when the campaign builds gestalt characters', () => {
    expect(tracksRefusal(['Fighter', 'Wizard'], house)).toBeNull();
    expect(tracksRefusal(['Fighter'], house)).toBeNull();
    expect(tracksRefusal(['Fighter', 'Wizard'], written)).toBe('This campaign builds single-class characters');
    expect(tracksRefusal(['Fighter', 'Fighter'], house)).toBe('A gestalt character advances in two different classes');
    expect(tracksRefusal([], house)).not.toBeNull();
  });

  it('takes the larger Hit Die, once', () => {
    expect(hitDie(['Wizard'])).toBe(6);
    expect(hitDie(['Wizard', 'Barbarian'])).toBe(12);
    // d12 + 2 at level 1, then 7 + 2 a level.
    expect(fixedHitPoints(['Wizard', 'Barbarian'], 5, 2)).toBe(14 + 9 * 4);
    expect(fixedHitPoints(['Wizard'], 1, -5)).toBe(1);
  });

  it('gives the saving throws of both classes', () => {
    expect(savingThrowProficiencies(['Fighter'])).toEqual(['str', 'con']);
    expect(savingThrowProficiencies(['Fighter', 'Wizard'])).toEqual(['str', 'con', 'int', 'wis']);
    expect(savingThrowProficiencies(['Fighter', 'Barbarian'])).toEqual(['str', 'con']);
  });

  it('knows the Proficiency Bonus', () => {
    expect([1, 4, 5, 9, 13, 17, 20].map(proficiencyBonus)).toEqual([2, 2, 3, 4, 5, 6, 6]);
  });
});

describe('feats and ability scores', () => {
  const levels = (list: ReturnType<typeof improvements>) => list.map((gain) => `${gain.level}:${gain.kind}:${gain.abilityPoints}`);

  it('as written, gives a feat at the class levels and the Epic Boon at 19', () => {
    expect(levels(improvements(['Wizard'], 20, written))).toEqual(['4:feat:0', '8:feat:0', '12:feat:0', '16:feat:0', '19:epicBoon:0']);
    expect(levels(improvements(['Fighter'], 14, written))).toEqual(['4:feat:0', '6:feat:0', '8:feat:0', '12:feat:0', '14:feat:0']);
  });

  it('with the house rule, gives a feat and two points every fourth level', () => {
    expect(levels(improvements(['Wizard'], 20, house))).toEqual([
      '4:both:2', '8:both:2', '12:both:2', '16:both:2', '19:epicBoon:0', '20:both:2',
    ]);
  });

  it("gives the same pair at a class's extra levels", () => {
    expect(levels(improvements(['Fighter'], 8, house))).toEqual(['4:both:2', '6:both:2', '8:both:2']);
    expect(levels(improvements(['Rogue'], 10, house))).toEqual(['4:both:2', '8:both:2', '10:both:2']);
  });

  it('does not double what two classes give at the same level', () => {
    expect(levels(improvements(['Fighter', 'Rogue'], 10, house))).toEqual(['4:both:2', '6:both:2', '8:both:2', '10:both:2']);
    expect(levels(improvements(['Wizard', 'Cleric'], 8, written))).toEqual(['4:feat:0', '8:feat:0']);
  });

  it('stops at the level asked', () => {
    expect(improvements(['Wizard'], 3, house)).toEqual([]);
  });
});

describe('spell slots', () => {
  it('follow a full caster level for level', () => {
    expect(spellSlots(['Wizard'], 5)).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
    expect(spellSlots(['Wizard'], 20)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });

  it('follow a half caster at half its level, rounded up', () => {
    expect(casterLevel(['Paladin'], 5)).toBe(3);
    expect(spellSlots(['Paladin'], 1)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('add both gestalt classes, never above the character level', () => {
    expect(casterLevel(['Paladin', 'Ranger'], 6)).toBe(6);
    expect(casterLevel(['Wizard', 'Cleric'], 7)).toBe(7);
    expect(casterLevel(['Wizard', 'Paladin'], 7)).toBe(7);
    expect(casterLevel(['Fighter', 'Paladin'], 7)).toBe(4);
  });

  it('give none to a class that casts nothing, and keep Pact Magic apart', () => {
    expect(spellSlots(['Fighter'], 10)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlots(['Warlock'], 10)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(pactMagic(['Warlock'], 1)).toEqual({ slots: 1, slotLevel: 1 });
    expect(pactMagic(['Warlock', 'Fighter'], 11)).toEqual({ slots: 3, slotLevel: 5 });
    expect(pactMagic(['Wizard'], 11)).toBeNull();
  });
});
