// ============================================
// The Unarmed Strike, by the D&D rules
//
// "Instead of using a weapon to make a melee attack, you can use a punch,
// kick, headbutt, or similar forceful blow." Each use is one of three (SRD
// 5.2.1, Rules Glossary; `rules-glossary-unarmed-strike`):
//
//   • Damage: an attack roll of Strength modifier plus Proficiency Bonus; a
//     hit deals Bludgeoning damage equal to 1 plus the Strength modifier.
//   • Grapple: the target makes a Strength or Dexterity saving throw (it
//     chooses) against DC 8 + Strength modifier + Proficiency Bonus, or it
//     has the Grappled condition.
//   • Shove: the same saving throw, or the target is pushed 5 feet away or
//     has the Prone condition.
//
// Grapple and Shove work only on a target no more than one size larger.
// Every creature has these, so they are listed after its own actions.
//
// Pure: the caller reads the two numbers from the sheet or the stat block.
// ============================================

import type { CombatAction } from './actions';

export type UnarmedOption = 'damage' | 'grapple' | 'prone' | 'push';

export const UNARMED_REACH_FEET = 5;

/** Proficiency Bonus by Challenge Rating: +2 up to CR 4, one more for every four above. */
export function proficiencyBonusForChallenge(rating: number): number {
  return 2 + Math.floor((Math.max(1, Math.min(30, Math.ceil(rating))) - 1) / 4);
}

/** The four uses of a creature's Unarmed Strike, as actions the engine can run. */
export function unarmedActions(strengthModifier: number, proficiencyBonus: number): CombatAction[] {
  const dc = 8 + strengthModifier + proficiencyBonus;
  const contest = (name: string, unarmed: UnarmedOption, text: string): CombatAction => ({
    name,
    cost: 'action',
    source: 'unarmed',
    unarmed,
    rangeFeet: UNARMED_REACH_FEET,
    // The target chooses Strength or Dexterity; the caller puts in the one it is better at.
    save: { ability: 'str', dc, damage: [], halfOnSuccess: false },
    text,
  });
  return [
    {
      name: 'Unarmed Strike',
      cost: 'action',
      source: 'unarmed',
      unarmed: 'damage',
      attack: {
        kind: 'melee',
        bonus: strengthModifier + proficiencyBonus,
        reachFeet: UNARMED_REACH_FEET,
        // 1 plus the Strength modifier, with no die to roll; a blow never heals.
        damage: [
          {
            type: 'bludgeoning',
            roll: { count: 0, sides: 1, bonus: Math.max(0, 1 + strengthModifier) },
          },
        ],
      },
    },
    contest(
      'Grapple',
      'grapple',
      'Unarmed Strike: Strength or Dexterity saving throw, or the target has the Grappled condition.'
    ),
    contest(
      'Shove: knock Prone',
      'prone',
      'Unarmed Strike: Strength or Dexterity saving throw, or the target has the Prone condition.'
    ),
    contest(
      'Shove: push 5 ft',
      'push',
      'Unarmed Strike: Strength or Dexterity saving throw, or the target is pushed 5 feet away.'
    ),
  ];
}

/** Whether a creature can grapple or shove another: the target is no more than one size larger. Sizes are squares across. */
export function canWrestle(attackerSquares: number, targetSquares: number): boolean {
  return targetSquares <= attackerSquares + 1;
}

/** The square a creature is pushed to: one step straight away from the one that shoved it, kept on the board. */
export function pushedTo(
  pusher: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number; width: number; height: number },
  board: { cols: number; rows: number }
): { x: number; y: number } {
  const dx = Math.sign(target.x + target.width / 2 - (pusher.x + pusher.width / 2));
  const dy = Math.sign(target.y + target.height / 2 - (pusher.y + pusher.height / 2));
  return {
    x: Math.max(0, Math.min(board.cols - target.width, target.x + dx)),
    y: Math.max(0, Math.min(board.rows - target.height, target.y + dy)),
  };
}
