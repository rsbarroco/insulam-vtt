import {
  frenzyDamage,
  indomitableMight,
  intimidatingPresenceActions,
  intimidatingPresenceDC,
  mindlessRageBlocks,
  primalKnowledgeApplies,
  relentlessRageApplies,
  relentlessRageDC,
  relentlessRageHitPoints,
  withRagesRegained,
  withRelentlessRageUsed,
} from '../barbarian';
import { resourcesOf, restoreResources } from '../resources';

const barbarian = (level: number, features: string[], extra: Record<string, unknown> = {}) => ({
  class: 'Barbarian',
  level,
  featuresAndTraits: features.map((name) => ({ name, description: '' })),
  stats: { strength: { score: 20, modifier: 5 } },
  proficiencyBonus: 5,
  ...extra,
});

describe('Relentless Rage', () => {
  const sheet = barbarian(11, ['Relentless Rage (Barbarian 11)']);
  const hp = { current: 8, max: 100, temp: 0 };

  it('answers damage that drops a raging Barbarian to 0 without killing it outright', () => {
    expect(relentlessRageApplies(sheet, true, hp, 8)).toBe(true);
    expect(relentlessRageApplies(sheet, true, hp, 107)).toBe(true);
    expect(relentlessRageApplies(sheet, true, hp, 108)).toBe(false);
    expect(relentlessRageApplies(sheet, true, hp, 7)).toBe(false);
    expect(relentlessRageApplies(sheet, true, { ...hp, temp: 5 }, 12)).toBe(false);
    expect(relentlessRageApplies(sheet, false, hp, 8)).toBe(false);
    expect(relentlessRageApplies(sheet, true, { ...hp, current: 0 }, 8)).toBe(false);
    expect(relentlessRageApplies(barbarian(11, []), true, hp, 8)).toBe(false);
  });

  it('has a DC of 10 that rises by 5 with each use, until a rest', () => {
    expect(relentlessRageDC(sheet)).toBe(10);
    const twice = withRelentlessRageUsed(withRelentlessRageUsed(sheet));
    expect(relentlessRageDC(twice)).toBe(20);
    expect(relentlessRageDC(restoreResources(twice, 'short').sheet)).toBe(10);
    expect(relentlessRageDC(restoreResources(twice, 'long').sheet)).toBe(10);
  });

  it('leaves twice the Barbarian level in Hit Points, no more than the maximum', () => {
    expect(relentlessRageHitPoints(sheet, 100)).toBe(22);
    expect(relentlessRageHitPoints(sheet, 15)).toBe(15);
  });
});

describe('Frenzy', () => {
  it('rolls as many d6s as the Rage Damage bonus, of the weapon’s type', () => {
    expect(frenzyDamage(barbarian(3, ['Frenzy']), 'slashing')).toEqual({ roll: { count: 2, sides: 6 }, type: 'slashing' });
    expect(frenzyDamage(barbarian(9, ['Frenzy']), null)).toEqual({ roll: { count: 3, sides: 6 }, type: 'bludgeoning' });
    expect(frenzyDamage(barbarian(16, ['Frenzy']), 'piercing')?.roll.count).toBe(4);
    expect(frenzyDamage(barbarian(9, []), 'slashing')).toBeNull();
  });
});

describe('Mindless Rage', () => {
  it('keeps Charmed and Frightened off a raging Berserker', () => {
    const sheet = barbarian(6, ['Mindless Rage']);
    expect(mindlessRageBlocks(sheet, true, 'Frightened')).toBe(true);
    expect(mindlessRageBlocks(sheet, true, 'charmed')).toBe(true);
    expect(mindlessRageBlocks(sheet, true, 'Poisoned')).toBe(false);
    expect(mindlessRageBlocks(sheet, false, 'Frightened')).toBe(false);
    expect(mindlessRageBlocks(barbarian(6, []), true, 'Frightened')).toBe(false);
  });
});

describe('Intimidating Presence', () => {
  it('is a Bonus Action with a Wisdom save of DC 8 + Strength modifier + Proficiency Bonus in a 30-foot Emanation', () => {
    const sheet = barbarian(14, ['Intimidating Presence']);
    expect(intimidatingPresenceDC(sheet)).toBe(18);
    expect(intimidatingPresenceActions(sheet)).toEqual([
      expect.objectContaining({
        name: 'Intimidating Presence',
        cost: 'bonusAction',
        presence: 'Intimidating Presence',
        rangeFeet: 30,
        save: { ability: 'wis', dc: 18, halfOnSuccess: false, damage: [] },
      }),
    ]);
  });

  it('costs a use of Rage once used, and is gone with no Rage left', () => {
    const used = barbarian(14, ['Intimidating Presence'], { featureUses: { 'Intimidating Presence': 1 } });
    expect(intimidatingPresenceActions(used)).toEqual([expect.objectContaining({ name: 'Intimidating Presence (a use of Rage)', presence: 'Rage' })]);
    expect(intimidatingPresenceActions({ ...used, featureUses: { 'Intimidating Presence': 1, Rage: 5 } })).toEqual([]);
    expect(intimidatingPresenceActions(barbarian(14, []))).toEqual([]);
    expect(resourcesOf(restoreResources(used, 'short').sheet).find((entry) => entry.name === 'Intimidating Presence')?.used).toBe(1);
    expect(resourcesOf(restoreResources(used, 'long').sheet).find((entry) => entry.name === 'Intimidating Presence')?.used).toBe(0);
  });
});

describe('Persistent Rage, Indomitable Might, Primal Knowledge', () => {
  it('gives every use of Rage back', () => {
    const sheet = barbarian(15, ['Persistent Rage'], { featureUses: { Rage: 4, 'Persistent Rage': 1 } });
    expect(withRagesRegained(sheet).featureUses).toEqual({ 'Persistent Rage': 1 });
    expect(resourcesOf(sheet).find((entry) => entry.name === 'Persistent Rage')).toMatchObject({ max: 1, used: 1, shortRest: 'none' });
  });

  it('raises a Strength total to the Strength score', () => {
    const sheet = barbarian(18, ['Indomitable Might']);
    expect(indomitableMight(sheet, 12)).toBe(20);
    expect(indomitableMight(sheet, 20)).toBeNull();
    expect(indomitableMight(barbarian(18, []), 12)).toBeNull();
    expect(indomitableMight(null, 12)).toBeNull();
  });

  it('lets a raging Barbarian use Strength for five skills', () => {
    const sheet = barbarian(3, ['Primal Knowledge']);
    for (const skill of ['acrobatics', 'intimidation', 'perception', 'stealth', 'survival']) expect(primalKnowledgeApplies(sheet, true, skill)).toBe(true);
    expect(primalKnowledgeApplies(sheet, true, 'arcana')).toBe(false);
    expect(primalKnowledgeApplies(sheet, false, 'stealth')).toBe(false);
    expect(primalKnowledgeApplies(barbarian(3, []), true, 'stealth')).toBe(false);
  });
});
