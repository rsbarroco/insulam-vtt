// ============================================
// A Cleric's Channel Divinity: Divine Spark and Turn Undead, by the D&D rules
// (SRD 5.2.1)
//
// As a Magic action, a use of Channel Divinity aims divine energy at another
// creature within 30 feet: 1d8 + the Cleric's Wisdom modifier (2d8 from Cleric
// 7, 3d8 from 13, 4d8 from 18), either restored as Hit Points or as Radiant or
// Necrotic damage, halved on a successful Constitution save against the
// Cleric's spell save DC.
//
// Turn Undead, also a Magic action: each Undead of the Cleric's choice within
// 30 feet makes a Wisdom save against the spell save DC, or is Frightened and
// Incapacitated for 1 minute, or until it takes damage. From Cleric 5 (Sear
// Undead) each Undead that fails also takes Wisdom-modifier d8s of Radiant
// damage, rolled once, which does not end the effect.
//
// Preserve Life (Life Domain) is listed too when the sheet has the feature:
// Hit Points divided among Bloodied creatures (see cleric.ts).
//
// The sheet's actions offer Divine Spark three ways (healing, Radiant,
// Necrotic) and Turn Undead while a use is left; the server spends the use
// when it resolves one.
// ============================================

import type { CombatAction } from './actions';
import { preserveLifePool, PRESERVE_LIFE_FEET, searUndeadDice } from './cleric';
import { abilityModifier, classLevel, resourcesOf } from './resources';

type Sheet = Record<string, unknown>;

/** The d8s Divine Spark rolls at a Cleric level. */
export function divineSparkDice(level: number): number {
  return level >= 18 ? 4 : level >= 13 ? 3 : level >= 7 ? 2 : 1;
}

/** The Cleric's spell save DC: the sheet's, or 8 + Wisdom modifier + Proficiency Bonus. */
function spellSaveDC(sheet: Sheet): number {
  const written = (sheet.spellcasting as { spellSaveDC?: unknown } | null | undefined)?.spellSaveDC;
  if (typeof written === 'number') return written;
  const proficiency = typeof sheet.proficiencyBonus === 'number' ? sheet.proficiencyBonus : 2;
  return 8 + abilityModifier(sheet, 'wisdom') + proficiency;
}

/** How long Turn Undead lasts, in the Cleric's turns: 1 minute. */
export const TURN_UNDEAD_TURNS = 10;

/** The ways a Cleric's sheet can use Channel Divinity now: none without a use left. */
export function channelDivinityActions(sheet: Sheet): CombatAction[] {
  const level = classLevel(sheet, 'Cleric');
  if (level < 2) return [];
  const uses = resourcesOf(sheet).find((entry) => entry.name === 'Channel Divinity');
  if (!uses || uses.used >= uses.max) return [];
  const count = divineSparkDice(level);
  const wisdom = abilityModifier(sheet, 'wisdom');
  const text = 'Channel Divinity: 1d8 + Wisdom modifier (more dice at Cleric 7, 13 and 18), restored as Hit Points or dealt as Radiant or Necrotic damage, half on a successful Constitution save.';
  const base = { cost: 'action' as const, source: 'sheet' as const, rangeFeet: 30, channel: 'Channel Divinity' as const, text };
  const harm = (type: 'radiant' | 'necrotic', label: string): CombatAction => ({
    ...base,
    name: `Divine Spark (${label})`,
    save: { ability: 'con', dc: spellSaveDC(sheet), halfOnSuccess: true, damage: [{ roll: { count, sides: 8, bonus: wisdom }, type }] },
  });
  const sear = searUndeadDice(sheet);
  const pool = preserveLifePool(sheet);
  return [
    { ...base, name: 'Divine Spark (healing)', heal: { roll: { count, sides: 8 }, bonus: wisdom } },
    harm('radiant', 'Radiant'),
    harm('necrotic', 'Necrotic'),
    {
      ...base,
      name: 'Turn Undead',
      text: `Channel Divinity: each Undead of your choice within 30 feet makes a Wisdom save or is Frightened and Incapacitated for 1 minute, or until it takes damage.${sear > 0 ? ` Sear Undead: each that fails takes ${sear}d8 Radiant damage, which does not end the effect.` : ''}`,
      onlyCreatureType: 'undead',
      save: { ability: 'wis', dc: spellSaveDC(sheet), halfOnSuccess: false, damage: sear > 0 ? [{ roll: { count: sear, sides: 8 }, type: 'radiant' }] : [] },
    },
    // Last, so the actions before it keep their places on a sheet without the feature.
    ...(pool > 0
      ? [
          {
            ...base,
            name: 'Preserve Life',
            rangeFeet: PRESERVE_LIFE_FEET,
            divide: { pool },
            text: `Channel Divinity: restore ${pool} Hit Points (five times your Cleric level), divided among Bloodied creatures within 30 feet, yourself among them. None is restored to more than half its Hit Point maximum.`,
          },
        ]
      : []),
  ];
}
