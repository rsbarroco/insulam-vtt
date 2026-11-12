// ============================================
// The Characters tab of Campaign Settings
//
// How the campaign's characters are built: gestalt and the house rules, each
// a switch. They are on by default; turning all of them off gives the fifth
// edition's rules as written. What each means is in utils/characterRules.ts.
// ============================================

import { useEffect, useState } from 'react';
import { Loader2, Save, Swords } from 'lucide-react';
import Button from '@/components/ui/Button';
import {
  CHARACTER_RULE_KEYS,
  readCharacterRules,
  type CharacterRules,
} from '@/utils/characterRules';

const SWITCHES: Record<keyof CharacterRules, { label: string; detail: string }> = {
  gestalt: {
    label: 'Gestalt characters',
    detail:
      'A character advances in two classes at once and has the features of both: the larger Hit Die, the saving throws of both, and spell slots for both. Off: one class, as written.',
  },
  abilityScoreCap22: {
    label: 'Ability scores up to 22',
    detail: 'Improvements can raise an ability score to 22. Off: 20, as written.',
  },
  featAndAbilityScores: {
    label: 'A feat and +2 every fourth level',
    detail:
      'Levels 4, 8, 12, 16 and 20 give a feat and +2 to ability scores (or +1 to two), and the feat still gives its own +1. Off: the Ability Score Improvement feat at the levels the class gives it.',
  },
  freeBackgroundAbilityScores: {
    label: 'Background ability scores go anywhere',
    detail:
      'The increases a background gives go to any scores the player chooses. Off: only the three scores the background names.',
  },
  freeOriginFeat: {
    label: 'Any origin feat',
    detail:
      'A character takes any origin feat, whatever the background. Off: the feat the background gives.',
  },
};

interface CharacterRulesSettingsProps {
  /** The rules as the campaign stores them; missing switches take their default. */
  stored: unknown;
  onSave: (rules: CharacterRules) => Promise<void>;
}

export default function CharacterRulesSettings({ stored, onSave }: CharacterRulesSettingsProps) {
  const [rules, setRules] = useState<CharacterRules>(() => readCharacterRules(stored));
  const [saving, setSaving] = useState(false);

  // Follow the campaign when another DM, or this one elsewhere, saves.
  const storedKey = JSON.stringify(readCharacterRules(stored));
  useEffect(() => {
    setRules(JSON.parse(storedKey) as CharacterRules);
  }, [storedKey]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(rules);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 p-4 rounded-lg bg-moss-green/5 border border-moss-green/15">
        <Swords className="w-5 h-5 text-brand-ink shrink-0 mt-0.5" />
        <p className="text-sm text-stone-gray">
          How this campaign&apos;s D&amp;D characters are built. Every switch is on by default; turn
          them all off for the rules as written. Characters already made are not changed.
        </p>
      </div>

      {CHARACTER_RULE_KEYS.map((key) => (
        <div key={key} className="flex items-start justify-between gap-4">
          <div>
            <p id={`cs-rule-${key}`} className="text-sm font-semibold text-stone-gray">
              {SWITCHES[key].label}
            </p>
            <p className="text-xs text-warm-gray mt-0.5">{SWITCHES[key].detail}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={rules[key]}
            aria-labelledby={`cs-rule-${key}`}
            onClick={() => setRules((current) => ({ ...current, [key]: !current[key] }))}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-moss-green/50 ${
              rules[key] ? 'bg-moss-green' : 'bg-warm-gray/30'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                rules[key] ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      ))}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
