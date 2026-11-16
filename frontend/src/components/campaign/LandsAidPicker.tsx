// ============================================
// LandsAidPicker — a Land Druid chooses what Land's Aid does to each creature
//
// In the attack menu, for Land's Aid: of the creatures its Sphere catches,
// which make the Constitution save (each creature of the Druid's choice) and
// which one regains Hit Points. The server rolls the saves and the healing,
// and spends the use of Wild Shape.
// ============================================

import { useState } from 'react';
import Button from '@/components/ui/Button';

interface LandsAidPickerProps {
  name: string;
  /** What the action does, in the menu's words: its save, damage and area. */
  detail: string;
  /** The dice the creature healed regains: "2d6". */
  dice: string;
  /** The creatures in the area. */
  creatures: Array<{ id: string; name: string }>;
  /** The creature using it, which is spared the save unless chosen. */
  userId: string;
  busy: boolean;
  /** Use it: the creatures that save, and the one that regains Hit Points, if any. */
  onUse: (targetIds: string[], healId: string | undefined) => void;
}

export default function LandsAidPicker({
  name,
  detail,
  dice,
  creatures,
  userId,
  busy,
  onUse,
}: LandsAidPickerProps) {
  // Who is spared the save: the Druid itself, until it says otherwise.
  const [spared, setSpared] = useState<string[]>([userId]);
  const [healId, setHealId] = useState('');
  const saving = creatures.filter((creature) => !spared.includes(creature.id));
  const healed = creatures.some((creature) => creature.id === healId) ? healId : '';

  return (
    <div className="px-2 py-1.5 space-y-1" role="group" aria-label={name}>
      <span className="block text-sm font-medium text-ink">{name}</span>
      <span className="block text-xs text-ink-muted">{detail}</span>
      {creatures.length === 0 ? (
        <span className="block text-xs text-ink-muted">Nobody stands in the area.</span>
      ) : (
        <>
          {creatures.map((creature) => (
            <label key={creature.id} className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={!spared.includes(creature.id)}
                onChange={(event) =>
                  setSpared((now) =>
                    event.target.checked
                      ? now.filter((id) => id !== creature.id)
                      : [...now, creature.id]
                  )
                }
              />
              {creature.name} makes the save
            </label>
          ))}
          <label className="flex items-center justify-between gap-2 text-xs text-ink">
            Regains {dice} Hit Points
            <select
              aria-label={`${name}: the creature that regains Hit Points`}
              value={healed}
              onChange={(event) => setHealId(event.target.value)}
              className="input-cozy text-xs py-1"
            >
              <option value="">Nobody</option>
              {creatures.map((creature) => (
                <option key={creature.id} value={creature.id}>
                  {creature.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || saving.length === 0}
            title={
              saving.length === 0
                ? 'Choose at least one creature to make the save. To only restore Hit Points, use Land’s Aid (healing only).'
                : 'A Magic action and a use of Wild Shape.'
            }
            onClick={() =>
              onUse(
                saving.map((creature) => creature.id),
                healed || undefined
              )
            }
          >
            Use {name}
          </Button>
        </>
      )}
    </div>
  );
}
