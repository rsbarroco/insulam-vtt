// ============================================
// WildShapeExtras — what else a Druid does with its uses of Wild Shape
//
// On the turn bar beside Wild Shape: Wild Companion (Find Familiar as a Magic
// action, for a use of Wild Shape or a spell slot) and, from Druid 5, Wild
// Resurgence (a spell slot for a use when none is left, once a turn; or a use
// for a level 1 slot, once until a Long Rest). The server holds the rules and
// says what was spent, or why not.
// ============================================

import { useState } from 'react';
import Button from '@/components/ui/Button';
import type { CombatFeatureAck, CombatResource } from '@/types';

type Choice = 'slotForUse' | 'useForSlot' | 'companionUse' | 'companionSlot';

const CHOICES: Record<
  Choice,
  { label: string; feature: 'Wild Resurgence' | 'Wild Companion'; slot: boolean }
> = {
  slotForUse: {
    label: 'Wild Resurgence: a spell slot for a use',
    feature: 'Wild Resurgence',
    slot: true,
  },
  useForSlot: {
    label: 'Wild Resurgence: a use for a level 1 slot',
    feature: 'Wild Resurgence',
    slot: false,
  },
  companionUse: { label: 'Wild Companion, with a use', feature: 'Wild Companion', slot: false },
  companionSlot: {
    label: 'Wild Companion, with a spell slot',
    feature: 'Wild Companion',
    slot: true,
  },
};

const SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

interface WildShapeExtrasProps {
  /** The Druid's Wild Resurgence, from Druid 5; null below it. */
  resurgence: CombatResource | null;
  spend: (
    feature: 'Wild Resurgence' | 'Wild Companion',
    slotLevel?: number
  ) => Promise<CombatFeatureAck>;
  onResult: (message: string, ok: boolean) => void;
}

export default function WildShapeExtras({ resurgence, spend, onResult }: WildShapeExtrasProps) {
  const offered = (Object.keys(CHOICES) as Choice[]).filter(
    (choice) => CHOICES[choice].feature !== 'Wild Resurgence' || resurgence !== null
  );
  const [picked, setPicked] = useState<Choice>(offered[0]);
  const [slotLevel, setSlotLevel] = useState(1);
  const choice = CHOICES[offered.includes(picked) ? picked : offered[0]];
  const send = async () => {
    const answer = await spend(choice.feature, choice.slot ? slotLevel : undefined);
    onResult(answer.ok ? answer.summary : answer.error, answer.ok);
  };

  return (
    <span className="flex flex-wrap items-center justify-center gap-1" role="group" aria-label="Wild Shape uses">
      <select
        aria-label="Wild Resurgence or Wild Companion"
        value={offered.includes(picked) ? picked : offered[0]}
        onChange={(event) => setPicked(event.target.value as Choice)}
        className="input-cozy text-sm py-1 w-auto max-w-full"
      >
        {offered.map((key) => (
          <option key={key} value={key}>
            {CHOICES[key].label}
          </option>
        ))}
      </select>
      {choice.slot && (
        <select
          aria-label="Spell slot level"
          value={slotLevel}
          onChange={(event) => setSlotLevel(Number(event.target.value))}
          className="input-cozy text-sm py-1 w-auto max-w-full"
        >
          {SLOT_LEVELS.map((level) => (
            <option key={level} value={level}>
              Level {level}
            </option>
          ))}
        </select>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        title="Wild Companion casts Find Familiar as a Magic action. Wild Resurgence takes no action: a spell slot gives a use of Wild Shape when none is left (once a turn), or a use gives a level 1 slot (once until a Long Rest)."
        onClick={() => void send()}
      >
        Use
      </Button>
    </span>
  );
}
