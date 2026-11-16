import type { CombatAction } from '../actions';
import {
  colossusSlayerApplies,
  colossusSlayerDamage,
  defensiveTactic,
  hasHunterFeature,
  hasRangerFeature,
  huntersLore,
  huntersMarkDamage,
  huntersPrey,
  isWeaponAttack,
  superiorDefenseOptions,
  superiorDefenseType,
  tirelessShortRest,
  tirelessTemporaryHitPoints,
  withResistance,
} from '../ranger';
import { resourcesOf } from '../resources';
import { withReaction, type AttackResult } from '../resolveAttack';

const named = (...names: string[]) => ({ featuresAndTraits: names.map((name) => ({ name, description: '' })) });
const longbow: CombatAction = {
  name: 'Longbow',
  cost: 'action',
  source: 'sheet',
  attack: { kind: 'ranged', bonus: 7, damage: [{ roll: { count: 1, sides: 8, bonus: 4 }, type: 'piercing' }] },
} as CombatAction;

describe('a Ranger’s features', () => {
  it('reads a class feature from the Ranger level, or from a feature of its name', () => {
    expect(hasRangerFeature({ class: 'Ranger', level: 12 }, 'Relentless Hunter')).toBe(false);
    expect(hasRangerFeature({ class: 'Ranger', level: 13 }, 'Relentless Hunter')).toBe(true);
    expect(hasRangerFeature({ class: 'Fighter', level: 20 }, 'Foe Slayer')).toBe(false);
    expect(hasRangerFeature(named('Nature’s Veil (Ranger 14)'), "Nature's Veil")).toBe(true);
    expect(hasRangerFeature(null, 'Tireless')).toBe(false);
  });

  it('reads a Hunter feature from the subclass and level, or from a feature of its name', () => {
    expect(hasHunterFeature({ class: 'Ranger', subclass: 'Hunter', level: 11 }, "Superior Hunter's Prey")).toBe(true);
    expect(hasHunterFeature({ class: 'Ranger', subclass: 'Hunter', level: 11 }, "Superior Hunter's Defense")).toBe(false);
    expect(hasHunterFeature({ class: 'Ranger', level: 20 }, "Hunter's Lore")).toBe(false);
    expect(hasHunterFeature(named('Hunter’s Lore'), "Hunter's Lore")).toBe(true);
  });

  it('reads the Hunter’s Prey and Defensive Tactics options from a feature’s name', () => {
    expect(huntersPrey(named('Hunter’s Prey'))).toBeNull();
    expect(huntersPrey(named('Hunter’s Prey: Colossus Slayer'))).toBe('colossus');
    expect(huntersPrey(named('Horde Breaker (Ranger 3)'))).toBe('horde');
    expect(defensiveTactic(named('Defensive Tactics'))).toBeNull();
    expect(defensiveTactic(named('Defensive Tactics (Escape the Horde)'))).toBe('escape');
    expect(defensiveTactic(named('Multiattack Defense'))).toBe('multiattack');
  });

  it('adds Colossus Slayer’s 1d8 of the weapon’s type to a weapon hit on a creature missing Hit Points', () => {
    expect(colossusSlayerApplies(longbow, { current: 10, max: 10 })).toBe(false);
    expect(colossusSlayerApplies(longbow, { current: 9, max: 10 })).toBe(true);
    expect(colossusSlayerApplies(longbow, null)).toBe(false);
    expect(colossusSlayerApplies({ ...longbow, source: 'spell' }, { current: 1, max: 10 })).toBe(false);
    expect(isWeaponAttack({ ...longbow, source: 'unarmed', unarmed: 'damage' })).toBe(false);
    expect(colossusSlayerDamage(longbow)).toEqual({ roll: { count: 1, sides: 8 }, type: 'piercing' });
  });

  it('rolls Hunter’s Mark with a d6, a d10 with Foe Slayer', () => {
    expect(huntersMarkDamage({ class: 'Ranger', level: 19 })).toEqual({ roll: { count: 1, sides: 6 }, type: 'force' });
    expect(huntersMarkDamage({ class: 'Ranger', level: 20 })).toEqual({ roll: { count: 1, sides: 10 }, type: 'force' });
  });

  it('gives Tireless and Nature’s Veil as many uses as the Wisdom modifier, at least one', () => {
    const uses = (sheet: Record<string, unknown>) => resourcesOf(sheet).filter((entry) => entry.name === 'Tireless' || entry.name === "Nature's Veil");
    expect(uses({ class: 'Ranger', level: 9 })).toEqual([]);
    expect(uses({ class: 'Ranger', level: 10, stats: { wisdom: { modifier: 3 } } })).toEqual([{ name: 'Tireless', max: 3, used: 0, shortRest: 'none' }]);
    expect(uses({ class: 'Ranger', level: 14, stats: { wisdom: { modifier: -1 } }, featureUses: { "Nature's Veil": 1 } })).toEqual([
      { name: 'Tireless', max: 1, used: 0, shortRest: 'none' },
      { name: "Nature's Veil", max: 1, used: 1, shortRest: 'none' },
    ]);
  });

  it('rolls Tireless’ Temporary Hit Points: 1d8 plus the Wisdom modifier, at least 1', () => {
    expect(tirelessTemporaryHitPoints({ stats: { wisdom: { modifier: 3 } } }, () => 5)).toEqual({ rolled: 5, modifier: 3, total: 8 });
    expect(tirelessTemporaryHitPoints({ stats: { wisdom: { modifier: -4 } } }, () => 2).total).toBe(1);
  });

  it('takes a level of Exhaustion off a Ranger with Tireless on a Short Rest', () => {
    expect(tirelessShortRest({ class: 'Ranger', level: 10, exhaustionLevel: 2 }).sheet.exhaustionLevel).toBe(1);
    expect(tirelessShortRest({ class: 'Ranger', level: 10, exhaustionLevel: 0 }).regained).toEqual([]);
    expect(tirelessShortRest({ class: 'Ranger', level: 9, exhaustionLevel: 2 }).sheet.exhaustionLevel).toBe(2);
  });

  it('says what the marked creature is immune, resistant and vulnerable to', () => {
    expect(huntersLore('Ogre', undefined)).toBe("Hunter's Lore: Ogre has no Immunities, Resistances or Vulnerabilities");
    expect(huntersLore('Imp', { immunities: ['fire', 'poison'], resistances: ['cold'] })).toBe(
      "Hunter's Lore: Imp has Immunities: fire, poison; Resistances: cold"
    );
  });

  it('offers Superior Hunter’s Defense for each damage type taken that is not resisted already', () => {
    expect(superiorDefenseOptions(['slashing', 'fire', 'fire', null], { resistances: ['slashing'] })).toEqual(["Superior Hunter's Defense (fire)"]);
    expect(superiorDefenseType("Superior Hunter's Defense (fire)")).toBe('fire');
    expect(superiorDefenseType('Uncanny Dodge')).toBeNull();
    expect(withResistance({ immunities: ['poison'] }, ['fire'])).toEqual({ immunities: ['poison'], resistances: ['fire'] });
    expect(withResistance(undefined, [])).toBeUndefined();
  });

  it('halves only the resisted type of a hit', () => {
    const hit = {
      ok: true,
      outcome: { hit: true, critical: false, armorClass: 15, roll: { total: 20 } },
      damage: [
        { type: 'slashing', rolled: { total: 9, dice: [6] } },
        { type: 'fire', rolled: { total: 5, dice: [5] } },
      ],
      bonuses: [],
      dealt: 14,
      hp: { current: 16, max: 30, temp: 0 },
    } as unknown as AttackResult;
    const after = withReaction(hit, { name: 'Hero', hp: { current: 30, max: 30, temp: 0 } }, 'Flame Tongue', {
      kind: 'resist',
      type: 'fire',
      label: "Superior Hunter's Defense",
    });
    expect(after.dealt).toBe(11);
    expect(after.hp?.current).toBe(19);
    expect(after.reducedBy).toEqual({ label: "Superior Hunter's Defense", amount: 3 });
    expect(after.summary).toContain("Resistance to fire damage from Superior Hunter's Defense");
  });
});
