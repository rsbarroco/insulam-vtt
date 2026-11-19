/**
 * The spells a new character chooses: how many of each at every level, from
 * which list and of which levels, and the spells features always prepare.
 */

import {
  alwaysPreparedAt,
  classSpellcasting,
  sheetSpellsOf,
  spellAllowance,
  spellbookCeiling,
  spellPicksRefusals,
  spellTableRows,
} from '../spellChoices';
import { classSpellList } from '../spellChoices';

describe('the counts of the class tables', () => {
  it('gives each casting class its cantrips and prepared spells by level', () => {
    const at = (name: Parameters<typeof spellAllowance>[0], level: number) => {
      const allowance = spellAllowance(name, level)!;
      return [allowance.cantrips, allowance.prepared, allowance.maxSpellLevel];
    };
    expect(at('Wizard', 1)).toEqual([3, 4, 1]);
    expect(at('Wizard', 5)).toEqual([4, 9, 3]);
    expect(at('Wizard', 20)).toEqual([5, 25, 9]);
    expect(at('Cleric', 1)).toEqual([3, 4, 1]);
    expect(at('Cleric', 4)).toEqual([4, 7, 2]);
    expect(at('Bard', 10)).toEqual([4, 15, 5]);
    expect(at('Druid', 3)).toEqual([2, 6, 2]);
    expect(at('Sorcerer', 1)).toEqual([4, 2, 1]);
    expect(at('Sorcerer', 2)).toEqual([4, 4, 1]);
    expect(at('Paladin', 1)).toEqual([0, 2, 1]);
    expect(at('Paladin', 5)).toEqual([0, 6, 2]);
    expect(at('Ranger', 9)).toEqual([0, 9, 3]);
    // Pact Magic: the slot level, up to 5.
    expect(at('Warlock', 1)).toEqual([2, 2, 1]);
    expect(at('Warlock', 3)).toEqual([2, 4, 2]);
    expect(at('Warlock', 11)).toEqual([4, 11, 5]);
    expect(spellAllowance('Fighter', 20)).toBeNull();
    expect(spellAllowance('Monk', 5)).toBeNull();
  });

  it('gives a Wizard six spells in the book and two a level', () => {
    expect([1, 2, 5, 20].map((level) => spellAllowance('Wizard', level)!.spellbook)).toEqual([6, 8, 14, 44]);
    expect(classSpellcasting('Cleric')!.spellbook).toBeNull();
    // At level 3, the two spells of level 3's slots are the only ones of level 2.
    expect(spellbookCeiling(3, 2)).toBe(2);
    expect(spellbookCeiling(5, 2)).toBe(6);
    expect(spellbookCeiling(5, 3)).toBe(2);
  });
});

describe('the spells features always prepare', () => {
  it('reads a subclass’s table row by row, at the levels the rules give', () => {
    expect(spellTableRows('Life Domain Spells Cleric Level Prepared Spells Aid, Bless, Cure Wounds, Lesser Restoration Mass Healing Word, Revivify')).toEqual([
      ['Aid', 'Bless', 'Cure Wounds', 'Lesser Restoration'],
      ['Mass Healing Word', 'Revivify'],
    ]);
    expect(alwaysPreparedAt('Cleric', 2)).toEqual([]);
    expect(alwaysPreparedAt('Cleric', 5)).toEqual(['Aid', 'Bless', 'Cure Wounds', 'Lesser Restoration', 'Mass Healing Word', 'Revivify']);
    expect(alwaysPreparedAt('Paladin', 9)).toEqual([
      'Divine Smite', 'Protection from Evil and Good', 'Shield of Faith', 'Aid', 'Zone of Truth', 'Beacon of Hope', 'Dispel Magic', 'Find Steed',
    ]);
    expect(alwaysPreparedAt('Warlock', 3)).toEqual(['Burning Hands', 'Command', 'Scorching Ray', 'Suggestion']);
    expect(alwaysPreparedAt('Sorcerer', 7)).toEqual(['Alter Self', 'Chromatic Orb', 'Command', 'Dragon’s Breath', 'Fear', 'Fly', 'Arcane Eye', 'Charm Monster']);
  });

  it('reads a class feature that names the spell', () => {
    expect(alwaysPreparedAt('Ranger', 1)).toEqual(['Hunter’s Mark']);
    expect(alwaysPreparedAt('Druid', 1)).toEqual(['Speak with Animals']);
    expect(alwaysPreparedAt('Bard', 20)).toEqual(['Power Word Heal', 'Power Word Kill']);
    // A Circle of the Land Druid's spells change with the land: not read.
    expect(alwaysPreparedAt('Druid', 20)).toEqual(['Speak with Animals']);
  });
});

describe('the picks', () => {
  const cleric = { class: 'Cleric' as const, cantrips: ['Sacred Flame', 'Guidance', 'Thaumaturgy'], prepared: ['Bless', 'Cure Wounds', 'Guiding Bolt', 'Healing Word'] };
  const wizard = {
    class: 'Wizard' as const,
    cantrips: ['Fire Bolt', 'Mage Hand', 'Ray of Frost'],
    spellbook: ['Detect Magic', 'Feather Fall', 'Mage Armor', 'Magic Missile', 'Sleep', 'Thunderwave'],
    prepared: ['Magic Missile', 'Sleep', 'Thunderwave', 'Mage Armor'],
  };

  it('takes the counts, from the list, of levels with slots', () => {
    expect(spellPicksRefusals(['Cleric'], 1, [cleric])).toEqual([]);
    expect(spellPicksRefusals(['Wizard'], 1, [wizard])).toEqual([]);
    expect(spellPicksRefusals(['Cleric'], 1, [{ ...cleric, cantrips: ['Sacred Flame'] }])).toEqual(['Cleric chooses 3 cantrips at level 1']);
    expect(spellPicksRefusals(['Cleric'], 1, [{ ...cleric, cantrips: ['Sacred Flame', 'Fire Bolt', 'Guidance'] }])).toEqual(['Fire Bolt is not on the Cleric spell list']);
    expect(spellPicksRefusals(['Cleric'], 1, [{ ...cleric, prepared: ['Bless', 'Cure Wounds', 'Guiding Bolt', 'Spiritual Weapon'] }])).toEqual([
      'Cleric has no spell slots of level 2 for Spiritual Weapon',
    ]);
    expect(spellPicksRefusals(['Cleric'], 1, [{ ...cleric, prepared: ['Bless', 'Bless', 'Guiding Bolt', 'Healing Word'] }])).toEqual(['Cleric chooses each of its prepared spells once']);
    expect(spellPicksRefusals(['Cleric'], 1, [{ ...cleric, prepared: ['Bless', 'Cure Wounds', 'Guiding Bolt', 'Wish Upon'] }])).toEqual(['"Wish Upon" is not a spell of the reference document']);
    expect(spellPicksRefusals(['Cleric'], 1, [])).toEqual(['Choose the spells of Cleric once']);
    expect(spellPicksRefusals(['Fighter'], 1, [cleric])).toEqual(['Cleric is not one of this character\'s classes']);
  });

  it('leaves out the spells a feature always prepares', () => {
    const at3 = { ...cleric, prepared: ['Guiding Bolt', 'Healing Word', 'Shield of Faith', 'Command', 'Spiritual Weapon', 'Hold Person'] };
    expect(spellPicksRefusals(['Cleric'], 3, [at3])).toEqual([]);
    expect(spellPicksRefusals(['Cleric'], 3, [{ ...at3, prepared: [...at3.prepared.slice(1), 'Bless'] }])).toEqual(['Bless is always prepared by a feature, and is not chosen']);
  });

  it('prepares a Wizard’s spells from its book', () => {
    expect(spellPicksRefusals(['Wizard'], 1, [{ ...wizard, prepared: ['Magic Missile', 'Sleep', 'Thunderwave', 'Shield'] }])).toEqual(['Shield is not in the spellbook']);
    expect(spellPicksRefusals(['Wizard'], 1, [{ ...wizard, spellbook: wizard.spellbook.slice(1) }])).toEqual(['Wizard chooses 6 spells for the spellbook at level 1']);
    // A level 3 Wizard learned two spells with level 2 slots, no more.
    const at3 = { ...wizard, spellbook: [...wizard.spellbook, 'Shield', 'Misty Step', 'Web', 'Shatter'], prepared: ['Magic Missile', 'Sleep', 'Web', 'Shatter', 'Shield', 'Mage Armor'] };
    expect(spellPicksRefusals(['Wizard'], 3, [at3])).toEqual([
      'A level 3 Wizard\'s spellbook holds at most 2 spells of level 2 or higher: two for each level that had those slots',
    ]);
    expect(spellPicksRefusals(['Cleric'], 1, [{ ...cleric, spellbook: ['Bless'] }])).toEqual(['Cleric keeps no spellbook']);
  });

  it('lets each class of a gestalt character choose its own', () => {
    expect(spellPicksRefusals(['Cleric', 'Wizard'], 1, [cleric, wizard])).toEqual([]);
    expect(spellPicksRefusals(['Cleric', 'Wizard'], 1, [cleric])).toEqual(['Choose the spells of Wizard once']);
    expect(spellPicksRefusals(['Fighter', 'Wizard'], 1, [wizard])).toEqual([]);
  });

  it('writes the book with what is not prepared, and the always-prepared spells', () => {
    const { cantrips, spells } = sheetSpellsOf(['Wizard'], 1, [wizard]);
    expect(cantrips).toEqual(['Fire Bolt', 'Mage Hand', 'Ray of Frost']);
    expect(spells.filter((spell) => !spell.prepared).map((spell) => spell.name)).toEqual(['Detect Magic', 'Feather Fall']);
    expect(spells.find((spell) => spell.name === 'Detect Magic')).toEqual({ name: 'Detect Magic', level: 1, prepared: false, ritual: true, concentration: true });
    const ranger = sheetSpellsOf(['Ranger'], 1, [{ class: 'Ranger', prepared: ['Cure Wounds', 'Ensnaring Strike'] }]);
    expect(ranger.spells.map((spell) => [spell.name, spell.prepared])).toEqual([['Cure Wounds', true], ['Ensnaring Strike', true], ['Hunter’s Mark', true]]);
  });

  it('can always fill the counts from the class lists', () => {
    for (const name of ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Warlock', 'Wizard'] as const) {
      for (let level = 1; level <= 20; level++) {
        const allowance = spellAllowance(name, level)!;
        expect(classSpellList(name, 'cantrip').length).toBeGreaterThanOrEqual(allowance.cantrips);
        expect(allowance.prepared).toBe(classSpellcasting(name)!.prepared[level - 1]);
      }
    }
  });
});
