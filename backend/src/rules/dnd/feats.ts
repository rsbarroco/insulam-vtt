// ============================================
// What a character's feats do in play, by the D&D rules
//
// SRD 5.2.1, Feats, the ones the VTT applies:
//
//   • Alert (Origin): Proficiency Bonus added to Initiative, written onto the
//     sheet when the character is built.
//   • Savage Attacker (Origin): once per turn, on a hit with a weapon, its
//     damage dice are rolled twice and the better roll is used.
//   • Archery (Fighting Style): +2 to attack rolls with Ranged weapons.
//   • Great Weapon Fighting (Fighting Style): a 1 or 2 on a damage die of a
//     Melee weapon attack with a Two-Handed weapon counts as a 3.
//   • Two-Weapon Fighting is applied with the Light weapon's extra attack.
//   • Grappler (General): Punch and Grab, once per turn, lets a hit with an
//     Unarmed Strike of the Attack action also Grapple; Attack Advantage
//     gives Advantage on attack rolls against a creature it has Grappled.
//   • Boon of Combat Prowess (Epic Boon): Peerless Aim turns a miss into a
//     hit, once until the start of its next turn.
//   • Boon of Irresistible Offense (Epic Boon): its Bludgeoning, Piercing and
//     Slashing damage ignores Resistance; a 20 on the d20 of an attack roll
//     deals extra damage equal to the ability score the boon increased.
//
// A sheet lists feats among its features, however it writes them:
// "Savage Attacker (Origin feat)", "Fighting Style: Archery".
//
// Pure.
// ============================================

import type { CombatAction, DamageComponent } from './actions';
import type { RollDie } from './d20';
import type { Defences } from './damage';

/** Whether a sheet's features name a feat. */
export function hasFeat(features: ReadonlyArray<{ name: string }>, feat: string): boolean {
  const wanted = feat.toLowerCase().replace(/[-\s]+/g, ' ');
  return features.some((feature) => {
    const name = feature.name.toLowerCase().replace(/[-\s]+/g, ' ');
    return (
      name === wanted ||
      name.startsWith(`${wanted} (`) ||
      name.endsWith(`: ${wanted}`) ||
      name.includes(`style: ${wanted}`)
    );
  });
}

const weaponAttack = (action: CombatAction) =>
  action.attack !== undefined &&
  action.source !== 'spell' &&
  action.source !== 'unarmed' &&
  !action.unarmed;

/** The bonus Archery adds to an attack: +2 with a Ranged weapon. */
export function archeryBonus(
  features: ReadonlyArray<{ name: string }>,
  action: CombatAction
): number {
  return weaponAttack(action) && action.attack!.kind === 'ranged' && hasFeat(features, 'Archery')
    ? 2
    : 0;
}

/** Whether Great Weapon Fighting counts a 1 or 2 as a 3 on this attack's damage. */
export function greatWeaponFighting(
  features: ReadonlyArray<{ name: string }>,
  action: CombatAction
): boolean {
  return (
    weaponAttack(action) &&
    action.attack!.kind === 'melee' &&
    action.attack!.twoHanded === true &&
    hasFeat(features, 'Great Weapon Fighting')
  );
}

/** Whether an attack is one Savage Attacker can reroll the damage of: a weapon's. */
export function savageAttackerApplies(
  features: ReadonlyArray<{ name: string }>,
  action: CombatAction
): boolean {
  return weaponAttack(action) && hasFeat(features, 'Savage Attacker');
}

/** A damage roller that counts a 1 or 2 as a 3. */
export function atLeastThree(roll: RollDie): RollDie {
  return (sides) => Math.max(3, roll(sides));
}

export const GRAPPLER = 'Grappler';
export const COMBAT_PROWESS = 'Boon of Combat Prowess';
export const IRRESISTIBLE_OFFENSE = 'Boon of Irresistible Offense';

/** Whether a hit with this action is one Punch and Grab can add a Grapple to: an Unarmed Strike's Damage option, with the Grappler feat. */
export function punchAndGrabApplies(features: ReadonlyArray<{ name: string }>, action: CombatAction): boolean {
  return action.unarmed === 'damage' && hasFeat(features, GRAPPLER);
}

const OVERCOME = ['bludgeoning', 'piercing', 'slashing'] as const;

/** Overcome Defenses: a target's defences as Bludgeoning, Piercing and Slashing damage from the boon's holder meets them, without Resistance to the three. */
export function overcomeDefences<T extends Defences | undefined>(features: ReadonlyArray<{ name: string }>, defences: T): T {
  if (!defences?.resistances || !hasFeat(features, IRRESISTIBLE_OFFENSE)) return defences;
  return { ...defences, resistances: defences.resistances.filter((type) => !(OVERCOME as readonly string[]).includes(type)) };
}

/**
 * Overwhelming Strike: the extra damage of a 20 on the d20 of an attack roll,
 * equal to the ability score the boon increased and of the attack's type. A
 * sheet that names the score ("Boon of Irresistible Offense (Dexterity)")
 * uses it; otherwise the higher of Strength and Dexterity. Null when the
 * feat, the 20 or the scores are missing.
 */
export function overwhelmingStrike(
  features: ReadonlyArray<{ name: string }>,
  scores: { str: number | null; dex: number | null } | undefined,
  action: CombatAction,
  natural: number
): { label: string; damage: DamageComponent } | null {
  if (natural !== 20 || !action.attack || !scores || !hasFeat(features, IRRESISTIBLE_OFFENSE)) return null;
  const listed = features.find((feature) => feature.name.toLowerCase().startsWith(IRRESISTIBLE_OFFENSE.toLowerCase()))?.name ?? '';
  const named = /\(\s*(strength|dexterity)\b/i.exec(listed)?.[1].toLowerCase();
  const score = named === 'strength' ? scores.str : named === 'dexterity' ? scores.dex : Math.max(scores.str ?? 0, scores.dex ?? 0);
  if (!score || score <= 0) return null;
  return {
    label: `Overwhelming Strike (+${score})`,
    damage: { type: action.attack.damage[0]?.type ?? null, roll: { count: 0, sides: 1, bonus: score } },
  };
}
