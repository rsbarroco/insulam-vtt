import { useState } from 'react';
import { Music } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { CombatFeatureAck, CombatResource } from '@/types';
import type { TouchTarget } from './LayOnHands';

interface BardicInspirationProps {
  uses: CombatResource;
  /** The other creatures in the fight: the server checks that one is within 60 feet. */
  targets: TouchTarget[];
  bonusActionSpent: boolean;
  inspire: (targetId: string) => Promise<CombatFeatureAck>;
  onResult: (message: string, ok: boolean) => void;
  /** Font of Inspiration: the spell slot levels that could be expended now to regain a use; empty when it cannot be used. */
  fontSlots?: number[];
  regain?: (slotLevel: number) => Promise<CombatFeatureAck>;
}

/**
 * Bardic Inspiration, from the turn bar: pick the creature inspired. The
 * server keeps the die on its token for an hour, and asks its player whether
 * to roll it when it fails an attack roll, a save or a check.
 */
export default function BardicInspiration({
  uses,
  targets,
  bonusActionSpent,
  inspire,
  onResult,
  fontSlots = [],
  regain,
}: BardicInspirationProps) {
  const left = uses.max - uses.used;
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');

  const send = async () => {
    const answer = await inspire(targetId);
    onResult(answer.ok ? answer.summary : answer.error, answer.ok);
    if (answer.ok) setOpen(false);
  };

  const [slotLevel, setSlotLevel] = useState(0);
  const expended = fontSlots.includes(slotLevel) ? slotLevel : (fontSlots[0] ?? 0);
  const fill = async () => {
    if (!regain || !expended) return;
    const answer = await regain(expended);
    onResult(answer.ok ? answer.summary : answer.error, answer.ok);
  };

  return (
    <span className="relative">
      <Button
        variant="secondary"
        size="sm"
        icon={Music}
        aria-expanded={open}
        disabled={left <= 0 || bonusActionSpent || targets.length === 0}
        title="A Bonus Action: a creature within 60 feet gains your Bardic Inspiration die, to add to a D20 Test it fails within the hour."
        onClick={() => setOpen((shown) => !shown)}
      >
        Bardic Inspiration ({left}/{uses.max})
      </Button>
      {regain && fontSlots.length > 0 && (
        <span className="ml-2 inline-flex items-center gap-1">
          <select
            aria-label="Spell slot for Font of Inspiration"
            className="input-cozy text-sm py-1"
            value={expended}
            onChange={(event) => setSlotLevel(Number(event.target.value))}
          >
            {fontSlots.map((level) => (
              <option key={level} value={level}>
                Level {level} slot
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            title="Font of Inspiration: expend a spell slot (no action) to regain one expended use of Bardic Inspiration."
            onClick={() => void fill()}
          >
            Font of Inspiration
          </Button>
        </span>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Bardic Inspiration"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 glass-panel bg-parchment/95 backdrop-blur-xs p-3 space-y-2 text-left shadow-lg"
        >
          <label className="block text-sm">
            <span className="text-ink-muted">Creature inspired</span>
            <select
              className="input-cozy mt-1 w-full text-sm py-1"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" disabled={!targetId} onClick={() => void send()}>
            Inspire
          </Button>
        </div>
      )}
    </span>
  );
}
