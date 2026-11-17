import {
  bardicSides,
  canCutWords,
  canUsePeerlessSkill,
  charmsOrFrightens,
  countercharmIdle,
  countercharmMode,
  cutAttackOutcome,
  cutTurnsToMiss,
  hasCountercharm,
  inspirationLeft,
  withCuttingWords,
  withInspirationRegained,
  withPeerlessSkill,
  withSuperiorInspiration,
} from '../bard';
import type { CheckResult } from '../checks';
import { withDamageRollReduced, type AttackResult } from '../resolveAttack';

const bard = (level: number, used = 0, features: string[] = ['Cutting Words', 'Peerless Skill']) => ({
  class: 'Bard',
  level,
  stats: { charisma: { score: 16, modifier: 3 } },
  featureUses: used > 0 ? { 'Bardic Inspiration': used } : {},
  featuresAndTraits: features.map((name) => ({ name, description: '' })),
});
const roll = (natural: number, total: number) => ({ natural, total, dice: [natural], modifier: total - natural, mode: 'normal' as const });
const check = (total: number, success: boolean): CheckResult => ({ roll: roll(total - 2, total), total, success, reasons: [], summary: 'check' });

describe('who may use the Lore features', () => {
  it('reads Cutting Words and Peerless Skill from the features, at their levels, with a use left', () => {
    expect(canCutWords(bard(3))).toBe(true);
    expect(canCutWords(bard(2))).toBe(false);
    expect(canCutWords(bard(3, 3))).toBe(false);
    expect(canCutWords(bard(10, 0, []))).toBe(false);
    expect(canCutWords({ ...bard(10), class: 'Fighter' })).toBe(false);
    expect(canCutWords(null)).toBe(false);
    expect(canUsePeerlessSkill(bard(14))).toBe(true);
    expect(canUsePeerlessSkill(bard(13))).toBe(false);
    expect(canUsePeerlessSkill(bard(14, 3))).toBe(false);
  });

  it('gives Countercharm to a Bard of level 7', () => {
    expect(hasCountercharm(bard(7, 0, []))).toBe(true);
    expect(hasCountercharm(bard(6))).toBe(false);
    expect(hasCountercharm(null)).toBe(false);
  });

  it('knows the die and the uses left', () => {
    expect(bardicSides(bard(1))).toBe(6);
    expect(bardicSides(bard(5))).toBe(8);
    expect(bardicSides(bard(10))).toBe(10);
    expect(bardicSides(bard(15))).toBe(12);
    expect(inspirationLeft(bard(5, 1))).toBe(2);
  });
});

describe('Cutting Words', () => {
  const hit = (natural: number, total: number) => ({ roll: roll(natural, total), armorClass: 15, hit: true, critical: natural === 20 });

  it('turns a hit into a miss when the total falls below the Armor Class, never a 20 on the die', () => {
    expect(cutTurnsToMiss(hit(10, 16), 2)).toBe(true);
    expect(cutTurnsToMiss(hit(10, 16), 1)).toBe(false);
    expect(cutTurnsToMiss(hit(20, 16), 6)).toBe(false);
    expect(cutAttackOutcome(hit(10, 18), 2).roll.total).toBe(16);
  });

  it('takes the die off a successful check', () => {
    expect(withCuttingWords(check(14, true), 12, 3, 'Lyra')).toMatchObject({ total: 11, success: false, summary: "check; Lyra's Cutting Words -3: 11, failure" });
    expect(withCuttingWords(check(14, true), 12, 2, 'Lyra')).toMatchObject({ total: 12, success: true });
    expect(withCuttingWords(check(9, false), 12, 2, 'Lyra').total).toBe(9);
  });

  it('takes the die off the damage roll before Resistance, a line at a time, to no less than 0', () => {
    const result: AttackResult = {
      ok: true,
      distanceFeet: 5,
      cover: 'none',
      reasons: [],
      outcome: { roll: roll(12, 18), armorClass: 15, hit: true, critical: false },
      damage: [
        { type: 'slashing', rolled: { dice: [3], bonus: 0, total: 3 } },
        { type: 'fire', rolled: { dice: [6], bonus: 0, total: 6 } },
      ],
      bonuses: [],
      dealt: 6,
      hp: { current: 14, max: 20, temp: 0 },
      dropped: false,
      instantDeath: false,
      summary: '',
    };
    const target = { name: 'Hero', hp: { current: 20, max: 20, temp: 0 }, defences: { resistances: ['fire' as const], immunities: [], vulnerabilities: [] } };
    const cut = withDamageRollReduced(result, target, 'Flame Tongue', { label: "Lyra's Cutting Words", amount: 5 });
    // 3 slashing gone, 2 off the fire: 4 fire, halved to 2.
    expect(cut.damage.map((line) => line.rolled.total)).toEqual([0, 4]);
    expect(cut.dealt).toBe(2);
    expect(cut.hp?.current).toBe(18);
    expect(cut.bonuses).toEqual(["Lyra's Cutting Words -5 damage"]);
    expect(withDamageRollReduced(result, target, 'Flame Tongue', { label: 'x', amount: 50 }).dealt).toBe(0);
  });
});

describe('Peerless Skill', () => {
  it('adds the die to a failed check', () => {
    expect(withPeerlessSkill(check(9, false), 12, 4)).toMatchObject({ total: 13, success: true });
    expect(withPeerlessSkill(check(9, false), 12, 2)).toMatchObject({ total: 11, success: false });
    expect(withPeerlessSkill(check(13, true), 12, 2).total).toBe(13);
  });
});

describe('Countercharm', () => {
  it('answers effects whose failed save applies Charmed or Frightened', () => {
    const block = (text: string) => ({ source: 'statBlock' as const, name: 'Roar', text });
    expect(charmsOrFrightens(block('Wisdom Saving Throw: DC 13. Failure: The target has the Frightened condition until the end of its next turn.'))).toBe(true);
    expect(charmsOrFrightens(block('Dexterity Saving Throw: DC 13. Failure: 9 (2d8) Thunder damage. Success: Half damage.'))).toBe(false);
    expect(charmsOrFrightens({ source: 'spell', name: 'Fear', spell: { id: 'fear', level: 3 } })).toBe(true);
    expect(charmsOrFrightens({ source: 'spell', name: 'Charm Person', spell: { id: 'charm-person', level: 1 } })).toBe(true);
    expect(charmsOrFrightens({ source: 'spell', name: 'Fireball', spell: { id: 'fireball', level: 3 } })).toBe(false);
    expect(charmsOrFrightens({ source: 'sheet', name: 'Turn Undead', channel: 'Channel Divinity', onlyCreatureType: 'undead' })).toBe(true);
  });

  it('answers Abjure Foes and Intimidating Presence, which frighten', () => {
    expect(charmsOrFrightens({ source: 'sheet', name: 'Abjure Foes', channel: 'Channel Divinity', untilDamaged: ['Frightened'] })).toBe(true);
    expect(charmsOrFrightens({ source: 'sheet', name: 'Intimidating Presence', presence: 'Intimidating Presence' })).toBe(true);
    expect(charmsOrFrightens({ source: 'sheet', name: 'Intimidating Presence (a use of Rage)', presence: 'Rage' })).toBe(true);
    expect(charmsOrFrightens({ source: 'sheet', name: 'Second Wind' })).toBe(false);
  });

  it('is idle when the creature is immune to every condition of an effect that deals it no damage', () => {
    const frightened = { frightened: 'Mindless Rage' };
    expect(countercharmIdle({ source: 'sheet', name: 'Abjure Foes', untilDamaged: ['Frightened'] }, false, frightened)).toBe(true);
    expect(countercharmIdle({ source: 'sheet', name: 'Intimidating Presence', presence: 'Intimidating Presence' }, false, frightened)).toBe(true);
    expect(countercharmIdle({ source: 'sheet', name: 'Intimidating Presence', presence: 'Intimidating Presence' }, false, {})).toBe(false);
    expect(countercharmIdle({ source: 'statBlock', name: 'Roar', text: 'Wisdom Saving Throw: DC 13. Failure: The target has the Frightened condition.' }, false, frightened)).toBe(true);
    expect(countercharmIdle({ source: 'statBlock', name: 'Roar', text: 'Wisdom Saving Throw: DC 13. Failure: The target has the Frightened condition.' }, true, frightened)).toBe(false);
    // Turn Undead also Incapacitates, and a spell's other effects are not read.
    expect(countercharmIdle({ source: 'sheet', name: 'Turn Undead', channel: 'Channel Divinity', onlyCreatureType: 'undead' }, false, frightened)).toBe(false);
    expect(countercharmIdle({ source: 'spell', name: 'Fear', spell: { id: 'fear', level: 3 } }, false, frightened)).toBe(false);
  });

  it('rolls again with Advantage, which a Disadvantage cancels', () => {
    expect(countercharmMode(undefined)).toBe('advantage');
    expect(countercharmMode('normal')).toBe('advantage');
    expect(countercharmMode('disadvantage')).toBe('normal');
  });
});

describe('Font of Inspiration and Superior Inspiration', () => {
  it('gives one expended use back from Bard 5', () => {
    expect(withInspirationRegained(bard(5, 2))).toMatchObject({ ok: true, left: 2, sheet: { featureUses: { 'Bardic Inspiration': 1 } } });
    expect(withInspirationRegained(bard(5))).toMatchObject({ ok: false, reason: 'No expended use of Bardic Inspiration to regain' });
    expect(withInspirationRegained(bard(4, 2))).toMatchObject({ ok: false });
  });

  it('brings a Bard of level 18 back to two uses when it has fewer', () => {
    expect(withSuperiorInspiration(bard(18, 3))).toMatchObject({ regained: 2, sheet: { featureUses: { 'Bardic Inspiration': 1 } } });
    expect(withSuperiorInspiration(bard(18, 2))).toMatchObject({ regained: 1 });
    expect(withSuperiorInspiration(bard(18, 1))).toBeNull();
    expect(withSuperiorInspiration(bard(17, 3))).toBeNull();
  });
});
