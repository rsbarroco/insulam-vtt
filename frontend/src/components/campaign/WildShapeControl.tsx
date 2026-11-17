// ============================================
// WildShapeControl — a Druid takes a Beast's form, or leaves it
//
// On the turn bar for a Druid whose sheet offers Wild Shape forms: a choice
// of the Beasts its level allows and a button to take one (a Bonus Action and
// a use of Wild Shape), or, in a form, a button to leave it. The server checks
// the form, spends the use and gives the Temporary Hit Points.
// ============================================

import { useState } from 'react';
import Button from '@/components/ui/Button';
import type { CombatFeatureAck, CombatResource } from '@/types';

interface WildShapeControlProps {
  forms: string[];
  current: string | null;
  uses: CombatResource | null;
  bonusActionSpent: boolean;
  /** Take the form named, or leave the form with null. */
  change: (form: string | null) => Promise<CombatFeatureAck>;
  onResult: (message: string, ok: boolean) => void;
}

export default function WildShapeControl({
  forms,
  current,
  uses,
  bonusActionSpent,
  change,
  onResult,
}: WildShapeControlProps) {
  const [form, setForm] = useState(forms[0] ?? '');
  const send = async (next: string | null) => {
    const answer = await change(next);
    onResult(answer.ok ? answer.summary : answer.error, answer.ok);
  };
  const left = uses ? uses.max - uses.used : 0;

  if (current) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={bonusActionSpent}
        title="Leave the Wild Shape form, as a Bonus Action"
        onClick={() => void send(null)}
      >
        Leave {current} form
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center justify-center gap-1" role="group" aria-label="Wild Shape">
      <select
        aria-label="Wild Shape form"
        value={form}
        onChange={(event) => setForm(event.target.value)}
        className="input-cozy text-sm py-1 w-auto max-w-full"
      >
        {forms.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={bonusActionSpent || left <= 0 || !form}
        title="Wild Shape: a Bonus Action and a use; you take the Beast's form, with Temporary Hit Points equal to your Druid level"
        onClick={() => void send(form)}
      >
        Wild Shape ({left}/{uses?.max ?? 0})
      </Button>
    </span>
  );
}
