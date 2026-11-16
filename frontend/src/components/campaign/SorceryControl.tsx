import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { CombatFeatureAck, CombatResource } from '@/types';

interface SorceryControlProps {
  /** The Sorcery Points pool, from Sorcerer level 2. */
  points: CombatResource | null;
  /** The uses of Innate Sorcery. */
  innate: CombatResource | null;
  /** Whether Innate Sorcery is active on the acting creature. */
  innateActive: boolean;
  /** Font of Magic: the slots it can create with what each costs, and the slot levels it can convert. */
  font: { create: Array<{ level: number; cost: number }>; convert: number[] } | null;
  bonusActionSpent: boolean;
  use: (
    feature: 'Font of Magic' | 'Innate Sorcery',
    options?: { create?: number; convert?: number }
  ) => Promise<CombatFeatureAck>;
  onResult: (message: string, ok: boolean) => void;
}

/**
 * A Sorcerer's Innate Sorcery and Font of Magic, from the turn bar. Innate
 * Sorcery is a Bonus Action the server keeps for a minute of the fight. Font
 * of Magic turns Sorcery Points into a spell slot (a Bonus Action) or a spell
 * slot into Sorcery Points (no action); the server holds the costs.
 */
export default function SorceryControl({
  points,
  innate,
  innateActive,
  font,
  bonusActionSpent,
  use: apply,
  onResult,
}: SorceryControlProps) {
  const [open, setOpen] = useState(false);
  const pointsLeft = points ? points.max - points.used : 0;
  const innateLeft = innate ? innate.max - innate.used : 0;

  const send = async (
    feature: 'Font of Magic' | 'Innate Sorcery',
    options?: { create?: number; convert?: number }
  ) => {
    const answer = await apply(feature, options);
    onResult(answer.ok ? answer.summary : answer.error, answer.ok);
    if (answer.ok) setOpen(false);
  };

  return (
    <>
      {innate && (
        <Button
          variant="secondary"
          size="sm"
          icon={Sparkles}
          disabled={innateActive || bonusActionSpent || (innateLeft <= 0 && pointsLeft < 2)}
          title="A Bonus Action, for 1 minute: +1 to the save DC of your spells and Advantage on your spell attack rolls. With no use left, a Sorcerer of level 7 spends 2 Sorcery Points."
          onClick={() => void send('Innate Sorcery')}
        >
          {innateActive ? 'Innate Sorcery active' : `Innate Sorcery (${innateLeft}/${innate.max})`}
        </Button>
      )}
      {font && (
        <span className="relative">
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={open}
            title="Font of Magic: create a spell slot from Sorcery Points (a Bonus Action), or convert a spell slot into Sorcery Points equal to its level (no action)."
            onClick={() => setOpen((shown) => !shown)}
          >
            Font of Magic
          </Button>
          {open && (
            <div
              role="dialog"
              aria-label="Font of Magic"
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 glass-panel bg-parchment/95 backdrop-blur-xs p-3 space-y-2 text-left shadow-lg"
            >
              <p className="text-sm text-ink-muted">Create a spell slot (Bonus Action)</p>
              <div className="flex flex-wrap gap-1">
                {font.create.map((slot) => (
                  <Button
                    key={slot.level}
                    variant="secondary"
                    size="sm"
                    disabled={bonusActionSpent || pointsLeft < slot.cost}
                    title={`A level ${slot.level} spell slot for ${slot.cost} Sorcery Points. It vanishes on a Long Rest.`}
                    onClick={() => void send('Font of Magic', { create: slot.level })}
                  >
                    Level {slot.level} ({slot.cost})
                  </Button>
                ))}
              </div>
              <p className="text-sm text-ink-muted">Convert a spell slot into points</p>
              <div className="flex flex-wrap gap-1">
                {font.convert.length === 0 && (
                  <span className="text-sm text-ink-muted">No spell slot left</span>
                )}
                {font.convert.map((level) => (
                  <Button
                    key={level}
                    variant="secondary"
                    size="sm"
                    disabled={!points || points.used === 0}
                    title={`Expend a level ${level} spell slot for ${level} Sorcery Points, no more than you have spent.`}
                    onClick={() => void send('Font of Magic', { convert: level })}
                  >
                    Level {level} (+{level})
                  </Button>
                ))}
              </div>
            </div>
          )}
        </span>
      )}
    </>
  );
}
