// ============================================
// The conditions an action gives its target, read from its text
//
// A stat block of the reference document (SRD 5.2.1) writes what a hit or a
// failed save does besides damage in plain sentences: "If the target is a
// Large or smaller creature, it has the Grappled condition (escape DC 14)",
// "Failure: … and the target has the Prone condition", "the target has the
// Poisoned condition until the start of the assassin's next turn".
//
// This finds those conditions, with the largest size a creature may be for
// one to take hold and how long it lasts as written. A sentence that hangs
// its condition on anything else ("If the target fails by 5 or more", "while
// it is underwater") is left for the table.
//
// Pure: text in, conditions out.
// ============================================

export const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'] as const;
export type Size = (typeof SIZES)[number];

const CONDITIONS = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
];

export interface ConditionRider {
  condition: string;
  /** The largest size a creature can be for the condition to take hold. */
  largest?: Size;
  /** How long it lasts, as the text says: "the start of the assassin's next turn". */
  until?: string;
  /** The target repeats the save at the end of each of its turns, ending the condition on a success. */
  repeats?: boolean;
}

const SIZE_GATE = new RegExp(
  `^if the target is an? (${SIZES.join('|')}) or smaller creature,`,
  'i'
);

/** The conditions a clause of an action's text gives its target. */
export function conditionsIn(clause: string): ConditionRider[] {
  const out: ConditionRider[] = [];
  for (const sentence of clause.split(/(?<=[.!])\s+/)) {
    const trimmed = sentence.trim();
    let largest: Size | undefined;
    const gate = SIZE_GATE.exec(trimmed);
    if (gate) largest = SIZES.find((size) => size.toLowerCase() === gate[1].toLowerCase());
    else if (/^(if|while|when|unless)\b/i.test(trimmed)) continue;
    for (const match of trimmed.matchAll(
      /\b(?:has|have) the (\w+) condition\b(?:\s*\([^)]*\))?([^,.;]*)/gi
    )) {
      const condition = CONDITIONS.find((name) => name.toLowerCase() === match[1].toLowerCase());
      if (!condition) continue;
      const until = /\buntil (?:the )?(.+)$/i.exec(match[2].trim());
      out.push({
        condition,
        ...(largest ? { largest } : {}),
        ...(until ? { until: until[1].trim() } : {}),
      });
    }
  }
  return out;
}

/** What a hit gives the target: the conditions written after "Hit:". */
export function conditionsOnHit(text: string): ConditionRider[] {
  const hit = /\bhit:\s*(.*)$/is.exec(text);
  return hit ? conditionsIn(hit[1]) : [];
}

/**
 * What a failed save gives the target: the conditions written after
 * "Failure:", before "Success:" or a "Second Failure:". When the failure says
 * the target "repeats the save at the end of each of its turns", each one
 * not tied to a turn is marked to be saved against again.
 */
export function conditionsOnFailure(text: string): ConditionRider[] {
  const failure = /\bfailure:\s*(.*?)(?:\bsecond failure:|\bsuccess:|$)/is.exec(text);
  if (!failure) return [];
  const repeats = /repeats the save at the end of each of its turns/i.test(failure[1]);
  return conditionsIn(failure[1]).map((rider) =>
    repeats && !turnLimit(rider) ? { ...rider, repeats: true } : rider
  );
}

/**
 * When a rider's condition ends, if the text ties it to a turn: as the start
 * or the end of the next turn of the source ("the assassin's next turn") or
 * of the target itself ("its next turn"). Null for any other duration.
 */
export function turnLimit(
  rider: ConditionRider
): { ends: 'start' | 'end'; whose: 'source' | 'target' } | null {
  const found = /^(start|end) of (?:the )?(.+?)(?:['’]s)? next turn$/i.exec(rider.until ?? '');
  if (!found) return null;
  const whose = /^(its|their)$/i.test(found[2].trim()) ? 'target' : 'source';
  return { ends: found[1].toLowerCase() as 'start' | 'end', whose };
}

/** The size a token of so many squares across is taken to be: one square is Medium. */
export function sizeOfSquares(squares: number): Size {
  if (squares >= 4) return 'Gargantuan';
  if (squares === 3) return 'Huge';
  if (squares === 2) return 'Large';
  return 'Medium';
}

/** Whether a creature of a size is small enough for the rider. */
export function fits(rider: ConditionRider, size: Size): boolean {
  return !rider.largest || SIZES.indexOf(size) <= SIZES.indexOf(rider.largest);
}
