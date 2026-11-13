// ============================================
// Rests, by the D&D rules
//
// A Short Rest is when a creature spends Hit Point Dice: for each one it
// rolls the die, adds its Constitution modifier, and regains that many Hit
// Points (minimum 1). A Long Rest gives back all lost Hit Points and all
// spent Hit Point Dice and spell slots, ends Temporary Hit Points, and takes
// off one level of Exhaustion (SRD 5.2.1, Rules Glossary;
// `rules-glossary-short-rest`, `rules-glossary-long-rest`).
//
// Pure: a D&D 5e sheet in, the sheet as the rest leaves it out.
// ============================================

import { rollDie, type RollDie } from './d20';

type Sheet = Record<string, unknown>;

interface Pool {
  class?: unknown;
  total?: unknown;
  die?: unknown;
  maximum?: unknown;
  remaining?: unknown;
}

const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

/** A pool's die and how many it holds at full: "d10" with a maximum, or the older "5d10". */
export function readPool(pool: Pool): { sides: number; maximum: number; remaining: number } | null {
  const packed =
    typeof pool.total === 'string' ? /^\s*(\d{1,2})\s*d\s*(\d{1,3})\s*$/i.exec(pool.total) : null;
  const single = typeof pool.die === 'string' ? /^\s*1?\s*d\s*(\d{1,3})\s*$/i.exec(pool.die) : null;
  const sides = single ? Number(single[1]) : packed ? Number(packed[2]) : null;
  const maximum = whole(pool.maximum) ?? (packed ? Number(packed[1]) : null);
  const remaining = whole(pool.remaining);
  if (sides === null || sides < 1 || maximum === null || remaining === null) return null;
  return { sides, maximum, remaining: Math.max(0, Math.min(maximum, remaining)) };
}

function hitPoints(sheet: Sheet): { current: number; maximum: number; temporary: number } | null {
  const hp = sheet.hp as { current?: unknown; maximum?: unknown; temporary?: unknown } | undefined;
  const current = whole(hp?.current);
  const maximum = whole(hp?.maximum);
  if (current === null || maximum === null) return null;
  return { current, maximum, temporary: whole(hp?.temporary) ?? 0 };
}

function constitutionModifier(sheet: Sheet): number {
  const con = (
    sheet.stats as Record<string, { score?: unknown; modifier?: unknown } | undefined> | undefined
  )?.constitution;
  return (
    whole(con?.modifier) ??
    (whole(con?.score) !== null ? Math.floor((whole(con?.score)! - 10) / 2) : 0)
  );
}

export interface HitDieSpent {
  ok: true;
  sheet: Sheet;
  /** The die as rolled. */
  rolled: number;
  sides: number;
  modifier: number;
  /** Hit Points regained: the roll plus the Constitution modifier, at least 1, up to the maximum. */
  regained: number;
  hp: { current: number; maximum: number; temporary: number };
  /** Dice left across the character's pools afterwards. */
  left: number;
}

export type RestRefusal = { ok: false; reason: string };

/** Spend one Hit Point Die, from the first pool that has one left, and regain the Hit Points. */
export function spendHitDie(sheet: Sheet, roll: RollDie = rollDie): HitDieSpent | RestRefusal {
  const hp = hitPoints(sheet);
  if (!hp) return { ok: false, reason: 'The sheet tracks no Hit Points' };
  const pools = Array.isArray(sheet.hitDice) ? (sheet.hitDice as Pool[]) : [];
  const read = pools.map(readPool);
  const index = read.findIndex((pool) => pool !== null && pool.remaining > 0);
  if (index === -1) return { ok: false, reason: 'No Hit Point Dice left to spend' };
  if (hp.current >= hp.maximum) return { ok: false, reason: 'Already at full Hit Points' };
  const pool = read[index]!;
  const rolled = roll(pool.sides);
  const modifier = constitutionModifier(sheet);
  const current = Math.min(hp.maximum, hp.current + Math.max(1, rolled + modifier));
  const after = { ...hp, current };
  return {
    ok: true,
    sheet: {
      ...sheet,
      hp: { ...(sheet.hp as object), current },
      hitDice: pools.map((entry, at) =>
        at === index ? { ...entry, remaining: pool.remaining - 1 } : entry
      ),
    },
    rolled,
    sides: pool.sides,
    modifier,
    regained: current - hp.current,
    hp: after,
    left: read.reduce((sum, entry) => sum + (entry?.remaining ?? 0), 0) - 1,
  };
}

export interface LongRested {
  sheet: Sheet;
  hp: { current: number; maximum: number; temporary: number } | null;
  /** What the rest gave back, for the log. */
  regained: string[];
}

/** A sheet after a Long Rest. */
export function longRest(sheet: Sheet): LongRested {
  const next: Sheet = { ...sheet };
  const regained: string[] = [];
  const hp = hitPoints(sheet);
  if (hp) {
    if (hp.current < hp.maximum) regained.push(`${hp.maximum - hp.current} Hit Points`);
    next.hp = { ...(sheet.hp as object), current: hp.maximum, temporary: 0 };
  }

  if (Array.isArray(sheet.hitDice)) {
    let dice = 0;
    next.hitDice = (sheet.hitDice as Pool[]).map((pool) => {
      const read = readPool(pool);
      if (!read) return pool;
      dice += read.maximum - read.remaining;
      return { ...pool, remaining: read.maximum };
    });
    if (dice > 0) regained.push(`${dice} Hit Point ${dice === 1 ? 'Die' : 'Dice'}`);
  }

  const casting = sheet.spellcasting as
    | { slots?: Record<string, { total?: unknown; expended?: unknown }> }
    | undefined;
  if (casting?.slots && typeof casting.slots === 'object') {
    let slots = 0;
    const restored: Record<string, unknown> = {};
    for (const [level, slot] of Object.entries(casting.slots)) {
      slots += Math.max(0, whole(slot?.expended) ?? 0);
      restored[level] = slot && typeof slot === 'object' ? { ...slot, expended: 0 } : slot;
    }
    next.spellcasting = { ...casting, slots: restored };
    if (slots > 0) regained.push(`${slots} spell ${slots === 1 ? 'slot' : 'slots'}`);
  }

  const exhaustion = whole(sheet.exhaustionLevel) ?? 0;
  if (exhaustion > 0) {
    next.exhaustionLevel = exhaustion - 1;
    regained.push(`Exhaustion ${exhaustion} to ${exhaustion - 1}`);
  }
  if (sheet.deathSaves !== undefined) next.deathSaves = { successes: 0, failures: 0 };

  return {
    sheet: next,
    hp: hp ? { current: hp.maximum, maximum: hp.maximum, temporary: 0 } : null,
    regained,
  };
}
