/**
 * The spell catalogue and what the engine reads from it.
 *
 * The catalogue is the SRD 5.2.1's own text, so these check that the build
 * kept every spell whole and that the reading of attacks, saves, damage and
 * areas holds on spells whose rules are well known.
 */

import { spellActionsFromSheet, actionFromSpell, allSpells, filterSpells, findSpell, spellDamage, spellMechanics, SRD_ATTRIBUTION } from '../spells';

const spell = (name: string) => {
  const found = findSpell(name);
  if (!found) throw new Error(`no spell ${name}`);
  return found;
};
const caster = { spellAttackBonus: 7, spellSaveDC: 15, level: 5 };

describe('the catalogue', () => {
  it('holds every spell of the document, each one whole', () => {
    const spells = allSpells();
    expect(spells).toHaveLength(339);
    expect(new Set(spells.map((s) => s.id)).size).toBe(339);
    for (const s of spells) {
      expect(s.name).toMatch(/^[A-Z][A-Za-z’/ -]+$/);
      expect(s.level).toBeGreaterThanOrEqual(0);
      expect(s.level).toBeLessThanOrEqual(9);
      expect(s.classes.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.castingTime && s.range && s.duration).toBeTruthy();
      expect(s.components.length).toBeGreaterThan(0);
      expect(s.components.includes('M')).toBe(s.material !== null);
    }
  });

  it('carries the attribution the licence asks for', () => {
    expect(SRD_ATTRIBUTION).toContain('System Reference Document 5.2.1');
    expect(SRD_ATTRIBUTION).toContain('https://creativecommons.org/licenses/by/4.0/legalcode');
  });

  it('finds a spell by name, whatever the case and apostrophes', () => {
    expect(spell('fire bolt').id).toBe('fire-bolt');
    expect(spell("Hunter's Mark").name).toBe('Hunter’s Mark');
    expect(findSpell('Silvery Barbs')).toBeNull();
    expect(findSpell('')).toBeNull();
  });

  it('filters by level, class, school and name', () => {
    expect(filterSpells({ level: 0, class: 'wizard' }).map((s) => s.name)).toContain('Fire Bolt');
    expect(filterSpells({ class: 'Paladin' }).every((s) => s.classes.includes('Paladin'))).toBe(true);
    expect(filterSpells({ search: 'cure' }).map((s) => s.name)).toEqual(['Cure Wounds', 'Mass Cure Wounds']);
    expect(filterSpells({ school: 'evocation', level: 3 }).map((s) => s.name)).toContain('Fireball');
  });

  it('knows rituals, concentration and materials', () => {
    expect(spell('Detect Magic')).toMatchObject({ ritual: true, concentration: true });
    expect(spell('Fireball')).toMatchObject({ ritual: false, concentration: false, material: 'a ball of bat guano and sulfur' });
  });
});

describe('reading a spell', () => {
  it('reads a save for half in an area', () => {
    expect(spellMechanics(spell('Fireball'))).toMatchObject({
      cost: 'action',
      rangeFeet: 150,
      attack: null,
      save: 'dex',
      halfOnSuccess: true,
      area: { shape: 'sphere', sizeFeet: 20 },
      damage: [{ roll: { count: 8, sides: 6 }, type: 'fire' }],
      perSlotLevel: { count: 1, sides: 6 },
    });
  });

  it('reads a ranged spell attack and a cantrip that grows', () => {
    const mechanics = spellMechanics(spell('Fire Bolt'));
    expect(mechanics).toMatchObject({ attack: 'ranged', rangeFeet: 120, save: null, damage: [{ roll: { count: 1, sides: 10 }, type: 'fire' }] });
    expect(mechanics.cantripUpgrade?.map((roll) => roll.count)).toEqual([2, 3, 4]);
  });

  it('reads a melee spell attack at touch', () => {
    expect(spellMechanics(spell('Shocking Grasp'))).toMatchObject({ attack: 'melee', rangeFeet: 5 });
  });

  it('reads cones, lines and the cost of a casting time', () => {
    expect(spellMechanics(spell('Burning Hands')).area).toEqual({ shape: 'cone', sizeFeet: 15 });
    expect(spellMechanics(spell('Lightning Bolt')).area).toEqual({ shape: 'line', sizeFeet: 100 });
    expect(spellMechanics(spell('Healing Word')).cost).toBe('bonusAction');
    expect(spellMechanics(spell('Shield')).cost).toBe('reaction');
    expect(spellMechanics(spell('Identify')).cost).toBeNull();
  });

  it('reads a save with no damage', () => {
    expect(spellMechanics(spell('Hold Person'))).toMatchObject({ save: 'wis', damage: [], halfOnSuccess: false });
  });
});

describe('casting', () => {
  it('adds dice for a higher slot', () => {
    const fireball = spell('Fireball');
    const mechanics = spellMechanics(fireball);
    expect(spellDamage(fireball, mechanics, 3)[0].roll.count).toBe(8);
    expect(spellDamage(fireball, mechanics, 5)[0].roll.count).toBe(10);
  });

  it("grows a cantrip with the caster's level", () => {
    const bolt = spell('Fire Bolt');
    const mechanics = spellMechanics(bolt);
    expect(spellDamage(bolt, mechanics, 0, 4)[0].roll.count).toBe(1);
    expect(spellDamage(bolt, mechanics, 0, 5)[0].roll.count).toBe(2);
    expect(spellDamage(bolt, mechanics, 0, 17)[0].roll.count).toBe(4);
  });

  it('makes an attack action with the caster’s bonus', () => {
    expect(actionFromSpell(spell('Fire Bolt'), caster)).toMatchObject({
      name: 'Fire Bolt',
      cost: 'action',
      source: 'spell',
      attack: { kind: 'ranged', bonus: 7, rangeFeet: { normal: 120, long: null }, damage: [{ roll: { count: 2, sides: 10 }, type: 'fire' }] },
    });
  });

  it('makes a save action with the caster’s DC', () => {
    expect(actionFromSpell(spell('Fireball'), caster, 4)).toMatchObject({
      save: { ability: 'dex', dc: 15, halfOnSuccess: true, damage: [{ roll: { count: 9, sides: 6 }, type: 'fire' }] },
      area: { shape: 'sphere', sizeFeet: 20 },
      rangeFeet: 150,
    });
  });

  it('keeps only the text of a spell it cannot run, and refuses one too slow for a turn', () => {
    const light = actionFromSpell(spell('Light'), caster);
    expect(light?.attack).toBeUndefined();
    expect(light?.save).toBeUndefined();
    expect(light?.text).toContain('sheds Bright Light');
    expect(actionFromSpell(spell('Identify'), caster)).toBeNull();
  });
});

describe('the spells on a sheet', () => {
  const sheet = {
    level: 5,
    spellcasting: {
      spellAttackBonus: 7,
      spellSaveDC: 15,
      cantrips: ['Fire Bolt', 'A Cantrip Of My Own'],
      spells: [
        { name: 'fireball', level: 3, prepared: true },
        { name: 'Lightning Bolt', level: 3, prepared: false },
        { name: 'Identify', level: 1, prepared: true },
        { name: 'Fireball', level: 3, prepared: true },
      ],
    },
  };

  it('lists the cantrips and prepared spells the catalogue knows and a turn can hold', () => {
    expect(spellActionsFromSheet(sheet).map((action) => action.name)).toEqual(['Fire Bolt', 'Fireball']);
  });

  it('casts them with the sheet’s numbers and level', () => {
    const [bolt] = spellActionsFromSheet(sheet);
    expect(bolt.attack).toMatchObject({ bonus: 7, damage: [{ roll: { count: 2, sides: 10 } }] });
  });

  it('lists nothing for a sheet that does not cast', () => {
    expect(spellActionsFromSheet({ spellcasting: { cantrips: ['Fire Bolt'] } })).toEqual([]);
    expect(spellActionsFromSheet(null)).toEqual([]);
  });
});
