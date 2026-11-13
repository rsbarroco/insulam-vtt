import { useState } from 'react';
import Button from '@/components/ui/Button';
import type { CombatConcentrateAck } from '@/types';

interface ConcentrationControlProps {
  /** The spell the acting caster concentrates on, or null. */
  concentrating: string | null;
  /** The concentration spells its sheet has ready. */
  spells: string[];
  concentrate: (change: { spell: string } | { end: true }) => Promise<CombatConcentrateAck>;
  onResult: (message: string, ok: boolean) => void;
}

/**
 * The acting caster's concentration on the turn bar: the spell it holds, with
 * a button to end it, or a choice of its concentration spells to start one
 * cast by hand. A spell the VTT casts starts its own, and damage makes the
 * caster save to keep it, on the server.
 */
export default function ConcentrationControl({
  concentrating,
  spells,
  concentrate,
  onResult,
}: ConcentrationControlProps) {
  // The list comes with the turn's actions, after the bar is drawn: the first is picked until one is chosen.
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = picked !== null && spells.includes(picked) ? picked : (spells[0] ?? '');
  const send = async (change: { spell: string } | { end: true }) => {
    const answer = await concentrate(change);
    onResult(answer.ok ? answer.summary : answer.error, answer.ok);
  };

  if (concentrating) {
    return (
      <span className="flex items-center gap-1 text-sm">
        <span>Concentrating: {concentrating}</span>
        <Button variant="ghost" size="sm" onClick={() => void send({ end: true })}>
          End concentration
        </Button>
      </span>
    );
  }
  if (spells.length === 0) return null;
  return (
    <span className="flex items-center gap-1 text-sm">
      <select
        aria-label="Concentration spell"
        className="input-cozy text-sm py-1"
        value={chosen}
        onChange={(event) => setPicked(event.target.value)}
      >
        {spells.map((spell) => (
          <option key={spell} value={spell}>
            {spell}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="sm"
        disabled={!chosen}
        title="Hold a concentration spell you cast by hand; damage will make you save to keep it"
        onClick={() => void send({ spell: chosen })}
      >
        Concentrate
      </Button>
    </span>
  );
}
