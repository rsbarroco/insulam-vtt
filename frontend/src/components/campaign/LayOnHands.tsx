import { useState } from 'react';
import { HandHeart } from 'lucide-react';
import Button from '@/components/ui/Button';
import NumberField from '@/components/ui/NumberField';
import type { CombatFeatureAck, CombatResource } from '@/types';

/** A creature the paladin could touch: the server checks that it is within 5 feet. */
export interface TouchTarget {
  id: string;
  name: string;
}

interface LayOnHandsProps {
  pool: CombatResource;
  /** The paladin first, then the others in the fight. */
  targets: TouchTarget[];
  bonusActionSpent: boolean;
  touch: (targetId: string, amount: number, cure: boolean) => Promise<CombatFeatureAck>;
  onResult: (message: string, ok: boolean) => void;
}

/**
 * Lay on Hands, from the turn bar: pick the creature touched and how many Hit
 * Points to restore from the pool, or spend 5 to end its Poisoned condition.
 * The server keeps the pool, checks the touch and heals no more than is missing.
 */
export default function LayOnHands({
  pool,
  targets,
  bonusActionSpent,
  touch,
  onResult,
}: LayOnHandsProps) {
  const left = pool.max - pool.used;
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [amount, setAmount] = useState(Math.min(5, left));

  const send = async (cure: boolean) => {
    const answer = await touch(targetId, amount, cure);
    onResult(answer.ok ? answer.summary : answer.error, answer.ok);
    if (answer.ok) setOpen(false);
  };

  return (
    <span className="relative">
      <Button
        variant="secondary"
        size="sm"
        icon={HandHeart}
        aria-expanded={open}
        disabled={left <= 0 || bonusActionSpent}
        title="A Bonus Action: restore Hit Points from your pool to a creature you touch, or spend 5 to end its Poisoned condition. All back on a Long Rest."
        onClick={() => setOpen((shown) => !shown)}
      >
        Lay on Hands ({left}/{pool.max})
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Lay on Hands"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 glass-panel bg-parchment/95 backdrop-blur-xs p-3 space-y-2 text-left shadow-lg"
        >
          <label className="block text-sm">
            <span className="text-ink-muted">Creature touched</span>
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
          <label className="block text-sm">
            <span className="text-ink-muted">Hit Points</span>
            <NumberField
              aria-label="Hit Points to restore"
              className="input-cozy mt-1 w-full text-sm py-1"
              value={amount}
              min={1}
              max={left}
              onChange={setAmount}
            />
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={!targetId || amount < 1} onClick={() => void send(false)}>
              Heal
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!targetId || left < 5}
              onClick={() => void send(true)}
            >
              Cure Poisoned
            </Button>
          </div>
        </div>
      )}
    </span>
  );
}
