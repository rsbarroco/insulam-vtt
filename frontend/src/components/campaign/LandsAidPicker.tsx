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
  busy: boolean;
  /** Use it: the creatures that save, and the one that regains Hit Points, if any. */
  onUse: (targetIds: string[], healId: string | undefined) => void;
}

export default function LandsAidPicker({
  name,
  detail,
  dice,
  creatures,
  busy,
  onUse,
}: LandsAidPickerProps) {
  // Who makes the save: nobody until the Druid ticks them, since the area catches allies too.
  const [chosen, setChosen] = useState<string[]>([]);
  const [healId, setHealId] = useState('');
  const saving = creatures.filter((creature) => chosen.includes(creature.id));
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
                checked={chosen.includes(creature.id)}
                onChange={(event) =>
                  setChosen((now) =>
                    event.target.checked
                      ? [...now, creature.id]
                      : now.filter((id) => id !== creature.id)
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
