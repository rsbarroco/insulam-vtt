// ============================================
// An ability check, rolled by the server
//
// Opens from the turn bar: pick a skill, a bare ability or the Hide action,
// give the DC if the table set one, and the server rolls it with the
// creature's bonus and conditions (`combat.check`). The result goes to the
// dice log; here it is shown as a toast.
// ============================================

import { useState } from 'react';
import { Dices } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { AttackMode, CombatCheckAck, CombatCheckEvent } from '@/types';
import { CHECK_ABILITIES, CHECK_SKILLS, checkChoice, HIDE, HIDE_DC } from '@/utils/abilityChecks';

interface CheckRollerProps {
  tokenId: string;
  name: string;
  /** 10 plus the creature's Perception bonus, when the server knows it. */
  passivePerception: number | null;
  resolve: (check: CombatCheckEvent) => Promise<CombatCheckAck>;
  onResult: (message: string, kind: 'success' | 'info' | 'error') => void;
}

export default function CheckRoller({
  tokenId,
  name,
  passivePerception,
  resolve,
  onResult,
}: CheckRollerProps) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('skill:perception');
  const [dc, setDc] = useState('');
  const [mode, setMode] = useState<AttackMode>('normal');
  const [busy, setBusy] = useState(false);

  const hiding = choice === HIDE;
  const wanted = Number(dc);
  const dcGiven = dc.trim() !== '' && Number.isInteger(wanted) && wanted >= 1 && wanted <= 40;

  const roll = async () => {
    const what = checkChoice(choice);
    if (!what) return;
    setBusy(true);
    const answer = await resolve({
      tokenId,
      ...what,
      ...(!hiding && dcGiven ? { dc: wanted } : {}),
      ...(mode !== 'normal' ? { mode } : {}),
    });
    setBusy(false);
    if (!answer.ok) return onResult(answer.error, 'error');
    onResult(answer.summary, answer.success === true ? 'success' : 'info');
  };

  return (
    <span className="relative">
      <Button
        variant="ghost"
        size="sm"
        icon={Dices}
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        Check
      </Button>
      {open && (
        <div
          role="group"
          aria-label={`Ability check for ${name}`}
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 glass-panel bg-parchment/95 backdrop-blur-xs p-3 space-y-2 text-left shadow-lg"
        >
          <label className="flex flex-col gap-1 text-xs">
            Check
            <select
              className="input-cozy text-sm py-1"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
            >
              <option value={HIDE}>Hide action: Stealth vs DC {HIDE_DC}</option>
              <optgroup label="Skills">
                {CHECK_SKILLS.map((skill) => (
                  <option key={skill.key} value={`skill:${skill.key}`}>
                    {skill.name} ({skill.ability})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Abilities">
                {CHECK_ABILITIES.map((ability) => (
                  <option key={ability.key} value={`ability:${ability.key}`}>
                    {ability.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs w-20">
              DC
              <input
                type="number"
                min={1}
                max={40}
                className="input-cozy text-sm py-1"
                value={hiding ? String(HIDE_DC) : dc}
                disabled={hiding}
                placeholder="none"
                onChange={(event) => setDc(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs flex-1">
              Roll
              <select
                className="input-cozy text-sm py-1"
                value={mode}
                onChange={(event) => setMode(event.target.value as AttackMode)}
              >
                <option value="normal">Normal</option>
                <option value="advantage">Advantage</option>
                <option value="disadvantage">Disadvantage</option>
              </select>
            </label>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void roll()}>
              Roll
            </Button>
          </div>
          {passivePerception !== null && (
            <p className="text-xs text-ink-muted">Passive Perception {passivePerception}</p>
          )}
        </div>
      )}
    </span>
  );
}
