import { useState } from 'react';
import { HeartPulse } from 'lucide-react';
import Button from '@/components/ui/Button';
import NumberField from '@/components/ui/NumberField';
import type { CombatHealAck } from '@/types';
import type { TouchTarget } from './LayOnHands';

interface PreserveLifeProps {
  /** Five times the Cleric level: the Hit Points one use restores. */
  pool: number;
  /** The Cleric first, then the others in the fight. */
  targets: TouchTarget[];
  actionSpent: boolean;
  divide: (shares: Array<{ targetId: string; amount: number }>) => Promise<CombatHealAck>;
  onResult: (message: string, ok: boolean) => void;
}

/**
 * Preserve Life, from the turn bar: divide the pool among the creatures in
 * the fight. The server checks that each is Bloodied and within 30 feet,
 * restores none to more than half its Hit Point maximum, and spends the use
 * of Channel Divinity and the Magic action.
 */
export default function PreserveLife({
  pool,
  targets,
  actionSpent,
  divide,
  onResult,
}: PreserveLifeProps) {
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const shares = targets
    .map((target) => ({ targetId: target.id, amount: amounts[target.id] ?? 0 }))
    .filter((share) => share.amount > 0);
  const given = shares.reduce((sum, share) => sum + share.amount, 0);

  const send = async () => {
    const answer = await divide(shares);
    onResult(answer.ok ? answer.summary : answer.error, answer.ok);
    if (answer.ok) {
      setAmounts({});
      setOpen(false);
    }
  };

  return (
    <span className="relative">
      <Button
        variant="secondary"
        size="sm"
        icon={HeartPulse}
        aria-expanded={open}
        disabled={actionSpent}
        title="Channel Divinity, a Magic action: restore five times your Cleric level in Hit Points, divided among Bloodied creatures within 30 feet (you among them). None is restored to more than half its Hit Point maximum."
        onClick={() => setOpen((shown) => !shown)}
      >
        Preserve Life ({pool})
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Preserve Life"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 glass-panel bg-parchment/95 backdrop-blur-xs p-3 space-y-2 text-left shadow-lg"
        >
          <p className="text-sm text-ink-muted">
            Hit Points for each Bloodied creature: {given}/{pool}
          </p>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {targets.map((target) => (
              <label key={target.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-ink">{target.name}</span>
                <NumberField
                  aria-label={`Hit Points for ${target.name}`}
                  className="input-cozy w-16 text-sm py-1"
                  value={amounts[target.id] ?? 0}
                  min={0}
                  max={pool}
                  onChange={(value) => setAmounts((held) => ({ ...held, [target.id]: value }))}
                />
              </label>
            ))}
          </div>
          <Button size="sm" disabled={given < 1 || given > pool} onClick={() => void send()}>
            Restore
          </Button>
        </div>
      )}
    </span>
  );
}
