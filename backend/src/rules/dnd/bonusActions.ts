// ============================================
// Class features taken as a Bonus Action that change the turn
//
// SRD 5.2.1:
//
//   • Cunning Action (Rogue 2): a Bonus Action to take the Dash, Disengage
//     or Hide action.
//   • Monk's Focus (Monk 2), each a Bonus Action:
//       - Flurry of Blows: 1 Focus Point, two Unarmed Strikes.
//       - Patient Defense: the Disengage action; for 1 Focus Point, the
//         Disengage and the Dodge actions.
//       - Step of the Wind: the Dash action; for 1 Focus Point, the Dash and
//         the Disengage actions (and a doubled jump, the table's).
//
// Pure: what a feature does to the turn, and whether a sheet has it.
// ============================================

import { classesOf } from './resources';

export type TurnFeature =
  | 'Cunning Action'
  | 'Flurry of Blows'
  | 'Patient Defense'
  | 'Step of the Wind';

type Sheet = Record<string, unknown>;

const hasLevel = (sheet: Sheet, name: string, level: number) => {
  const found = classesOf(sheet);
  return (
    found.classes.some((entry) => entry.toLowerCase() === name.toLowerCase()) &&
    found.level >= level
  );
};

/** Whether a sheet's classes give the feature at its level. */
export function hasTurnFeature(sheet: Sheet, feature: TurnFeature): boolean {
  return feature === 'Cunning Action' ? hasLevel(sheet, 'Rogue', 2) : hasLevel(sheet, 'Monk', 2);
}

/** What the feature does to the turn: Dash, Disengage, Dodge, Unarmed Strikes, and the Focus Points it costs. */
export function turnFeatureEffect(
  feature: TurnFeature,
  options: { as?: 'Dash' | 'Disengage'; focus?: boolean }
):
  | { dash: boolean; disengage: boolean; dodge: boolean; strikes: number; focus: number }
  | { refusal: string } {
  switch (feature) {
    case 'Cunning Action':
      if (!options.as)
        return { refusal: 'Cunning Action takes the Dash, Disengage or Hide action' };
      return {
        dash: options.as === 'Dash',
        disengage: options.as === 'Disengage',
        dodge: false,
        strikes: 0,
        focus: 0,
      };
    case 'Flurry of Blows':
      return { dash: false, disengage: false, dodge: false, strikes: 2, focus: 1 };
    case 'Patient Defense':
      return {
        dash: false,
        disengage: true,
        dodge: options.focus === true,
        strikes: 0,
        focus: options.focus ? 1 : 0,
      };
    case 'Step of the Wind':
      return {
        dash: true,
        disengage: options.focus === true,
        dodge: false,
        strikes: 0,
        focus: options.focus ? 1 : 0,
      };
  }
}
