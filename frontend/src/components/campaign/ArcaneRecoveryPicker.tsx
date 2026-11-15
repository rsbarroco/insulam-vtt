// ============================================
// ArcaneRecoveryPicker — a Wizard chooses the slots Arcane Recovery brings back
//
// Opened from the roster as a Short Rest ends: how many slots of each level
// (1st to 5th) to recover. The server holds the rules — a combined level of no
// more than half the Wizard level, rounded up, once until a Long Rest — and
// says what came back, or why not.
// ============================================

import { useState } from 'react';
import Button from '@/components/ui/Button';

interface ArcaneRecoveryPickerProps {
  anchorX: number;
  anchorY: number;
  /** Finish the Short Rest with the slots of these levels recovered, one entry per slot. */
  onRecover: (levels: number[]) => void;
  onClose: () => void;
}

const LEVELS = [1, 2, 3, 4, 5];

export default function ArcaneRecoveryPicker({
  anchorX,
  anchorY,
  onRecover,
  onClose,
}: ArcaneRecoveryPickerProps) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const levels = LEVELS.flatMap((level) => Array.from({ length: counts[level] ?? 0 }, () => level));
  const combined = levels.reduce((sum, level) => sum + level, 0);

  return (
    <div
      role="dialog"
      aria-label="Arcane Recovery"
      className="fixed z-50 glass-panel p-3 space-y-2 w-64 bg-parchment/95 shadow-lg"
      style={{ left: anchorX, top: anchorY }}
    >
      <p className="text-sm text-ink">
        Arcane Recovery: the expended slots to recover as the Short Rest ends, of a combined level
        up to half your Wizard level (rounded up), none of level 6 or higher.
      </p>
      {LEVELS.map((level) => (
        <label key={level} className="flex items-center justify-between gap-2 text-sm text-ink">
          Level {level} slots
          <input
            type="number"
            min={0}
            max={9}
            value={counts[level] ?? 0}
            onChange={(event) =>
              setCounts((now) => ({
                ...now,
                [level]: Math.max(0, Math.min(9, Number(event.target.value) || 0)),
              }))
            }
            className="input-cozy text-sm py-1 w-16"
          />
        </label>
      ))}
      <p className="text-xs text-ink">Combined level: {combined}</p>
      <div className="flex justify-between gap-2">
        <Button
          type="button"
          size="sm"
          disabled={levels.length === 0}
          onClick={() => onRecover(levels)}
        >
          Recover and finish the rest
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
