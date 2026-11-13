import {
  actionFromSheetAttack,
  actionFromStatBlockEntry,
  actionsFromSheet,
  actionsFromStatBlock,
  defencesFromStatBlock,
  parseDamageRoll,
  parseDamageType,
  parseDamageTypeList,
} from '../actions';

describe('parseDamageRoll', () => {
  it.each<[string, object]>([
    ['1d8', { count: 1, sides: 8 }],
    ['2d6 + 3', { count: 2, sides: 6, bonus: 3 }],
    ['2d6+3', { count: 2, sides: 6, bonus: 3 }],
    ['1d4 - 1', { count: 1, sides: 4, bonus: -1 }],
    ['1D10', { count: 1, sides: 10 }],
    ['5', { count: 0, sides: 0, bonus: 5 }],
  ])('reads %s', (text, expected) => {
    expect(parseDamageRoll(text)).toEqual(expected);
  });

  it('is null with no number in it', () => {
    expect(parseDamageRoll('')).toBeNull();
    expect(parseDamageRoll(undefined)).toBeNull();
    expect(parseDamageRoll('special')).toBeNull();
  });
});

describe('parseDamageType', () => {
  it('reads a type whatever its case, and nothing else', () => {
    expect(parseDamageType('Slashing')).toBe('slashing');
    expect(parseDamageType(' fire ')).toBe('fire');
    expect(parseDamageType('magical')).toBeNull();
    expect(parseDamageType(undefined)).toBeNull();
  });
});

describe('parseDamageTypeList', () => {
  it('reads a plain list', () => {
    expect(parseDamageTypeList('cold, fire, lightning')).toEqual({ types: ['cold', 'fire', 'lightning'], conditional: [] });
    expect(parseDamageTypeList('Poison and Psychic')).toEqual({ types: ['poison', 'psychic'], conditional: [] });
  });

  it('sets a part with a condition on it aside', () => {
    const line = 'fire; bludgeoning, piercing, and slashing from nonmagical attacks';
    expect(parseDamageTypeList(line)).toEqual({
      types: ['fire'],
      conditional: ['bludgeoning, piercing, and slashing from nonmagical attacks'],
    });
  });

  it('is empty for no line', () => {
    expect(parseDamageTypeList(undefined)).toEqual({ types: [], conditional: [] });
  });
});

describe('defencesFromStatBlock', () => {
  it('gathers the three lines', () => {
    const defences = defencesFromStatBlock({
      damageResistances: 'cold; slashing from nonmagical attacks',
      damageVulnerabilities: 'fire',
      damageImmunities: 'poison, necrotic',
    });
    expect(defences.resistances).toEqual(['cold']);
    expect(defences.vulnerabilities).toEqual(['fire']);
    expect(defences.immunities).toEqual(['poison', 'necrotic']);
    expect(defences.conditional).toEqual(['slashing from nonmagical attacks']);
  });
});

describe('actionFromSheetAttack', () => {
  it('gives an SRD weapon named with no properties its own', () => {
    expect(actionFromSheetAttack({ name: 'Glaive', attackBonus: 5, damageRoll: '1d10+3', damageType: 'slashing' }).attack).toMatchObject({
      kind: 'melee',
      reachFeet: 10,
      heavy: true,
    });
    expect(actionFromSheetAttack({ name: 'Longbow', attackBonus: 5, damageRoll: '1d8+3', damageType: 'piercing' }).attack).toMatchObject({
      kind: 'ranged',
      rangeFeet: { normal: 150, long: 600 },
    });
  });

  it('keeps the properties a sheet wrote, even for an SRD weapon', () => {
    expect(
      actionFromSheetAttack({ name: 'Longbow', attackBonus: 5, damageRoll: '1d8', range: 30, properties: ['Thrown'] }).attack?.kind
    ).toBe('melee');
  });

  it('reads a melee weapon', () => {
    const action = actionFromSheetAttack({ name: 'Longsword', attackBonus: 5, damageRoll: '1d8+3', damageType: 'Slashing', range: 5 });
    expect(action).toEqual({
      name: 'Longsword',
      cost: 'action',
      source: 'sheet',
      attack: { kind: 'melee', bonus: 5, reachFeet: 5, damage: [{ roll: { count: 1, sides: 8, bonus: 3 }, type: 'slashing' }] },
      weapon: 'Longsword',
    });
  });

  it('carries the weapon’s mastery when the sheet marks it as used', () => {
    expect(actionFromSheetAttack({ name: 'Maul', attackBonus: 5, damageRoll: '2d6+3', useMastery: true }).mastery).toBe('Topple');
    expect(actionFromSheetAttack({ name: 'Maul', attackBonus: 5, damageRoll: '2d6+3' }).mastery).toBeUndefined();
    expect(actionFromSheetAttack({ name: 'Claw', attackBonus: 5, damageRoll: '1d6', useMastery: true }).mastery).toBeUndefined();
  });

  it('gives a Reach weapon 10 feet', () => {
    const action = actionFromSheetAttack({ name: 'Glaive', attackBonus: 5, damageRoll: '1d10+3', properties: ['Heavy', 'Reach', 'Two-Handed'] });
    expect(action.attack?.reachFeet).toBe(10);
  });

  it('reads a weapon that uses ammunition as ranged, with the range in its property', () => {
    const action = actionFromSheetAttack({
      name: 'Longbow', attackBonus: 6, damageRoll: '1d8+4', damageType: 'piercing', range: 150,
      properties: ['Ammunition (Range 150/600)', 'Heavy', 'Two-Handed'],
    });
    expect(action.attack).toMatchObject({ kind: 'ranged', rangeFeet: { normal: 150, long: 600 } });
  });

  it('reads a long range with no property as ranged with no long range', () => {
    const action = actionFromSheetAttack({ name: 'Fire Bolt', attackBonus: 5, damageRoll: '1d10', damageType: 'fire', range: 120 });
    expect(action.attack).toMatchObject({ kind: 'ranged', rangeFeet: { normal: 120, long: null } });
  });

  it('keeps a thrown weapon melee', () => {
    const action = actionFromSheetAttack({ name: 'Handaxe', attackBonus: 4, damageRoll: '1d6+2', range: 20, properties: ['Light', 'Thrown (Range 20/60)'] });
    expect(action.attack?.kind).toBe('melee');
    expect(action.attack?.reachFeet).toBe(5);
  });

  it('adds the extra damage lines', () => {
    const action = actionFromSheetAttack({
      name: 'Flame Tongue', attackBonus: 7, damageRoll: '1d8+4', damageType: 'slashing',
      additionalDamage: [{ label: 'Fire', damageRoll: '2d6', damageType: 'fire' }, { label: 'empty' }],
    });
    expect(action.attack?.damage).toEqual([
      { roll: { count: 1, sides: 8, bonus: 4 }, type: 'slashing' },
      { roll: { count: 2, sides: 6 }, type: 'fire' },
    ]);
  });

  it('has no damage for a row not filled in yet', () => {
    expect(actionFromSheetAttack({ name: 'New attack', attackBonus: 0 }).attack?.damage).toEqual([]);
  });
});

describe('actionFromStatBlockEntry', () => {
  it('reads a melee attack in the 2014 wording', () => {
    const action = actionFromStatBlockEntry(
      { name: 'Scimitar', description: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.' },
      'action'
    );
    expect(action.attack).toEqual({ kind: 'melee', bonus: 4, reachFeet: 5, damage: [{ roll: { count: 1, sides: 6, bonus: 2 }, type: 'slashing' }] });
    expect(action.text).toContain('Melee Weapon Attack');
  });

  it('reads a ranged attack with its two ranges', () => {
    const action = actionFromStatBlockEntry(
      { name: 'Shortbow', description: 'Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.' },
      'action'
    );
    expect(action.attack).toMatchObject({ kind: 'ranged', bonus: 4, rangeFeet: { normal: 80, long: 320 } });
  });

  it('reads an attack in the 2024 wording', () => {
    const action = actionFromStatBlockEntry(
      { name: 'Bite', description: 'Melee Attack Roll: +7, reach 10 ft. Hit: 12 (2d6 + 5) Piercing damage plus 3 (1d6) Fire damage.' },
      'action'
    );
    expect(action.attack).toEqual({
      kind: 'melee',
      bonus: 7,
      reachFeet: 10,
      damage: [
        { roll: { count: 2, sides: 6, bonus: 5 }, type: 'piercing' },
        { roll: { count: 1, sides: 6 }, type: 'fire' },
      ],
    });
  });

  it('reads flat damage with no dice', () => {
    const action = actionFromStatBlockEntry({ name: 'Bite', description: 'Melee Weapon Attack: +0 to hit, reach 5 ft., one target. Hit: 1 piercing damage.' }, 'action');
    expect(action.attack?.damage).toEqual([{ roll: { count: 0, sides: 0, bonus: 1 }, type: 'piercing' }]);
  });

  it('reads a saving throw for half in the 2014 wording', () => {
    const action = actionFromStatBlockEntry(
      {
        name: 'Fire Breath (Recharge 5-6)',
        description:
          'The dragon exhales fire in a 15-foot cone. Each creature in that area must make a DC 13 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save, or half as much damage on a successful one.',
      },
      'action'
    );
    expect(action.save).toEqual({ ability: 'dex', dc: 13, damage: [{ roll: { count: 7, sides: 6 }, type: 'fire' }], halfOnSuccess: true });
    expect(action.attack).toBeUndefined();
  });

  it('reads a saving throw in the 2024 wording', () => {
    const action = actionFromStatBlockEntry(
      { name: 'Poison Spray', description: 'Constitution Saving Throw: DC 12, one creature within 30 feet. Failure: 10 (3d6) Poison damage. Success: Half damage.' },
      'bonusAction'
    );
    expect(action.cost).toBe('bonusAction');
    expect(action.save).toMatchObject({ ability: 'con', dc: 12, halfOnSuccess: true });
  });

  it('reads a saving throw with no damage for half', () => {
    const action = actionFromStatBlockEntry(
      { name: 'Frightful Presence', description: 'Each creature within 120 feet must succeed on a DC 16 Wisdom saving throw or become frightened for 1 minute.' },
      'action'
    );
    expect(action.save).toEqual({ ability: 'wis', dc: 16, damage: [], halfOnSuccess: false });
  });

  it('leaves the rider of an attack in the text', () => {
    const action = actionFromStatBlockEntry(
      {
        name: 'Bite',
        description:
          'Melee Weapon Attack: +4 to hit, reach 5 ft., one creature. Hit: 7 (2d4 + 2) piercing damage, and the target must succeed on a DC 11 Constitution saving throw or be poisoned.',
      },
      'action'
    );
    expect(action.attack?.damage).toHaveLength(1);
    expect(action.save).toBeUndefined();
  });

  it('keeps only the text of an action it cannot read', () => {
    const action = actionFromStatBlockEntry({ name: 'Multiattack', description: 'The knight makes two melee attacks.' }, 'action');
    expect(action).toEqual({ name: 'Multiattack', cost: 'action', source: 'statBlock', text: 'The knight makes two melee attacks.' });
  });

  it('copes with an entry that has no description', () => {
    expect(actionFromStatBlockEntry({ name: 'Parry' }, 'reaction')).toEqual({ name: 'Parry', cost: 'reaction', source: 'statBlock', text: '' });
  });
});

describe('gathering actions', () => {
  it('lists a stat block by what each costs', () => {
    const actions = actionsFromStatBlock({
      actions: [{ name: 'Claw', description: 'Melee Weapon Attack: +3 to hit, reach 5 ft., one target. Hit: 4 (1d4 + 2) slashing damage.' }],
      bonusActions: [{ name: 'Nimble Escape', description: 'The goblin takes the Disengage or Hide action.' }],
      reactions: [{ name: 'Parry', description: 'The creature adds 2 to its AC against one melee attack.' }],
      legendaryActions: [{ name: 'Tail Attack', description: 'The dragon makes a tail attack.' }],
    });
    expect(actions.map((action) => [action.name, action.cost])).toEqual([
      ['Claw', 'action'],
      ['Nimble Escape', 'bonusAction'],
      ['Parry', 'reaction'],
      ['Tail Attack', 'legendary'],
    ]);
  });

  it('is empty for a stat block with none', () => {
    expect(actionsFromStatBlock({})).toEqual([]);
  });

  it('lists a sheet, skipping rows with no name', () => {
    const actions = actionsFromSheet({ attacks: [{ name: 'Dagger', attackBonus: 4, damageRoll: '1d4+2' }, { name: '  ', attackBonus: 0 }] });
    expect(actions.map((action) => action.name)).toEqual(['Dagger']);
    expect(actionsFromSheet(null)).toEqual([]);
  });
});
