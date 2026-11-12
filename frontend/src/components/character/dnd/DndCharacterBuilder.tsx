// ============================================
// The guided D&D character builder
//
// One form for the choices a character is built from: species, background,
// one class or two, level, ability scores, skills, and a feat for each level
// that gives one. It offers what the campaign's rules allow, as the server
// lists them, and the server builds the sheet and has the last word.
// ============================================

import { useEffect, useState } from 'react';
import type { DndAbility, DndFeat, DndImprovement, DndRulesCatalogue } from '@/types';
import api from '@/services/api';
import { apiErrorMessage } from '@/utils/errors';
import Button from '@/components/ui/Button';
import {
  ABILITIES,
  ABILITY_LABELS,
  SKILL_LABELS,
  STANDARD_ARRAY,
  backgroundAbilities,
  dueImprovements,
  featsFor,
  improvementKey,
  originFeats,
  skillChoices,
  totalScores,
  type BuilderState,
  type ImprovementState,
  type Pick,
} from './builderState';

interface DndCharacterBuilderProps {
  campaignId: string;
  state: BuilderState;
  onChange: (state: BuilderState) => void;
  /** The catalogue once loaded, so the modal can turn the form into choices. */
  onCatalogue: (catalogue: DndRulesCatalogue | null) => void;
  disabled?: boolean;
}

const FIELD = 'input-cozy w-full disabled:opacity-50';
const LABEL = 'block text-sm font-semibold text-ink mb-1';
const HINT = 'text-xs text-ink-muted mt-1';

function AbilitySelect({
  id,
  label,
  value,
  among,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: Pick;
  among: readonly DndAbility[];
  disabled?: boolean;
  onChange: (value: Pick) => void;
}) {
  return (
    <span className="flex items-center gap-2 text-sm text-ink">
      <span className="shrink-0" aria-hidden="true">
        {label}
      </span>
      {/* Named by the label alone: wrapped in a <label>, its name would also read out the option shown. */}
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as Pick)}
        className="input-cozy text-sm py-1 disabled:opacity-50"
      >
        <option value="">Choose…</option>
        {among.map((ability) => (
          <option key={ability} value={ability}>
            {ABILITY_LABELS[ability]}
          </option>
        ))}
      </select>
    </span>
  );
}

const blankImprovement = (feat: DndFeat | undefined, gain: DndImprovement): ImprovementState => ({
  feat: feat?.name ?? '',
  featPicks: Array.from({ length: feat?.abilityPoints?.total ?? 0 }, () => '' as Pick),
  extraPicks: Array.from({ length: gain.abilityPoints }, () => '' as Pick),
});

export default function DndCharacterBuilder({
  campaignId,
  state,
  onChange,
  onCatalogue,
  disabled,
}: DndCharacterBuilderProps) {
  const [catalogue, setCatalogue] = useState<DndRulesCatalogue | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setCatalogue(null);
    setProblem(null);
    onCatalogue(null);
    api
      .getDndRules(campaignId)
      .then((loaded) => {
        if (!current) return;
        setCatalogue(loaded);
        onCatalogue(loaded);
      })
      .catch((error) => {
        if (current) setProblem(apiErrorMessage(error) ?? 'The rules could not be loaded');
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loads once for a campaign; onCatalogue is the modal's setter
  }, [campaignId]);

  if (problem) return <p className="text-sm text-danger-ink">{problem}</p>;
  if (!catalogue)
    return <p className="text-sm text-ink-muted">Loading the campaign&apos;s rules…</p>;

  const rules = catalogue.characterRules;
  const set = (patch: Partial<BuilderState>) => onChange({ ...state, ...patch });
  const species = catalogue.species.find((entry) => entry.name === state.species);
  const background = catalogue.backgrounds.find((entry) => entry.name === state.background);
  const feats = originFeats(state, catalogue);
  const spreadCount = state.backgroundSpread === '2+1' ? 2 : 3;
  const allowed = backgroundAbilities(state, catalogue);
  const skills = skillChoices(state, catalogue);
  const due = dueImprovements(state, catalogue);
  const totals = totalScores(state, catalogue);
  const cap = rules.abilityScoreCap22 ? 22 : 20;

  /** A new background can change which scores and which feat are allowed; a new class, which skills. */
  const chooseBackground = (name: string) => {
    const next = { ...state, background: name, backgroundPicks: ['', '', ''] as Pick[] };
    const offered = originFeats(next, catalogue);
    onChange({ ...next, originFeat: offered.length === 1 ? offered[0].name : '', skills: [] });
  };
  const chooseClass = (patch: Partial<BuilderState>) =>
    set({ ...patch, skills: [], improvements: {} });

  const setImprovement = (gain: DndImprovement, value: ImprovementState) =>
    set({ improvements: { ...state.improvements, [improvementKey(gain)]: value } });

  return (
    <div className="space-y-5">
      <p className="text-xs text-ink-muted">
        Built by this campaign&apos;s rules, from the System Reference Document 5.2.1:{' '}
        {rules.gestalt ? 'gestalt (two classes)' : 'one class'}, ability scores up to {cap},{' '}
        {rules.featAndAbilityScores
          ? 'a feat and +2 at every fourth level'
          : 'a feat at the levels the class gives one'}
        .
      </p>

      {/* ── Species ── */}
      <div>
        <label htmlFor="dnd-species" className={LABEL}>
          Species
        </label>
        <select
          id="dnd-species"
          value={state.species}
          disabled={disabled}
          onChange={(event) => set({ species: event.target.value })}
          className={FIELD}
        >
          <option value="">Choose a species…</option>
          {catalogue.species.map((entry) => (
            <option key={entry.id} value={entry.name}>
              {entry.name}
            </option>
          ))}
        </select>
        {species && (
          <p className={HINT}>
            {species.size} · Speed {species.speedFeet} ft ·{' '}
            {species.traits.map((trait) => trait.name).join(', ')}
          </p>
        )}
      </div>

      {/* ── Background ── */}
      <div className="space-y-2">
        <div>
          <label htmlFor="dnd-background" className={LABEL}>
            Background
          </label>
          <select
            id="dnd-background"
            value={state.background}
            disabled={disabled}
            onChange={(event) => chooseBackground(event.target.value)}
            className={FIELD}
          >
            <option value="">Choose a background…</option>
            {catalogue.backgrounds.map((entry) => (
              <option key={entry.id} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
          {background && (
            <p className={HINT}>
              Skills: {background.skillProficiencies.join(' and ')} · Tool:{' '}
              {background.toolProficiency}
            </p>
          )}
        </div>

        {background && (
          <>
            <fieldset className="space-y-2" disabled={disabled}>
              <legend className={LABEL}>Ability scores from the background</legend>
              <div className="flex flex-wrap gap-4 text-sm text-ink">
                {(['2+1', '1+1+1'] as const).map((spread) => (
                  <label key={spread} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="dnd-background-spread"
                      checked={state.backgroundSpread === spread}
                      onChange={() =>
                        set({ backgroundSpread: spread, backgroundPicks: ['', '', ''] })
                      }
                    />
                    {spread === '2+1' ? '+2 to one, +1 to another' : '+1 to three'}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                {Array.from({ length: spreadCount }, (_, index) => (
                  <AbilitySelect
                    key={index}
                    id={`dnd-background-pick-${index}`}
                    label={state.backgroundSpread === '2+1' && index === 0 ? '+2 to' : '+1 to'}
                    value={state.backgroundPicks[index] ?? ''}
                    among={allowed.filter(
                      (ability) =>
                        !state.backgroundPicks.some(
                          (pick, other) => other !== index && pick === ability
                        )
                    )}
                    onChange={(value) =>
                      set({
                        backgroundPicks: state.backgroundPicks.map((pick, other) =>
                          other === index ? value : pick
                        ),
                      })
                    }
                  />
                ))}
              </div>
              <p className={HINT}>
                {rules.freeBackgroundAbilityScores
                  ? 'This campaign lets a background raise any ability scores.'
                  : `${background.name} raises ${background.abilityScores.join(', ')}.`}
              </p>
            </fieldset>

            <div>
              <label htmlFor="dnd-origin-feat" className={LABEL}>
                Origin feat
              </label>
              <select
                id="dnd-origin-feat"
                value={state.originFeat}
                disabled={disabled || feats.length === 1}
                onChange={(event) => set({ originFeat: event.target.value })}
                className={FIELD}
              >
                <option value="">Choose a feat…</option>
                {feats.map((feat) => (
                  <option key={feat.id} value={feat.name}>
                    {feat.name}
                  </option>
                ))}
              </select>
              <p className={HINT}>
                {rules.freeOriginFeat
                  ? `This campaign lets a character take any origin feat. ${background.name} would give ${background.feat}.`
                  : `${background.name} gives ${background.feat}.`}
              </p>
            </div>
          </>
        )}
      </div>

      {/* ── Classes and level ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="dnd-class-a" className={LABEL}>
            Class
          </label>
          <select
            id="dnd-class-a"
            value={state.classA}
            disabled={disabled}
            onChange={(event) =>
              chooseClass({
                classA: event.target.value,
                classB: state.classB === event.target.value ? '' : state.classB,
              })
            }
            className={FIELD}
          >
            <option value="">Choose a class…</option>
            {catalogue.classes.map((entry) => (
              <option key={entry.id} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
        {rules.gestalt && (
          <div>
            <label htmlFor="dnd-class-b" className={LABEL}>
              Second class
            </label>
            <select
              id="dnd-class-b"
              value={state.classB}
              disabled={disabled || !state.classA}
              onChange={(event) => chooseClass({ classB: event.target.value })}
              className={FIELD}
            >
              <option value="">None</option>
              {catalogue.classes
                .filter((entry) => entry.name !== state.classA)
                .map((entry) => (
                  <option key={entry.id} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="dnd-level" className={LABEL}>
            Level
          </label>
          <input
            id="dnd-level"
            type="number"
            min={1}
            max={20}
            value={state.level}
            disabled={disabled}
            onChange={(event) =>
              set({ level: Math.max(1, Math.min(20, Math.floor(Number(event.target.value)) || 1)) })
            }
            className={FIELD}
          />
        </div>
      </div>

      {/* ── Ability scores ── */}
      <fieldset disabled={disabled}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <legend className="text-sm font-semibold text-ink">Ability scores</legend>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => set({ scores: { ...STANDARD_ARRAY } })}
          >
            Standard array
          </Button>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {ABILITIES.map((ability) => (
            <label
              key={ability}
              htmlFor={`dnd-score-${ability}`}
              className="text-xs text-ink-muted"
            >
              {ABILITY_LABELS[ability]}
              <input
                id={`dnd-score-${ability}`}
                type="number"
                min={3}
                max={18}
                value={state.scores[ability]}
                onChange={(event) =>
                  set({
                    scores: {
                      ...state.scores,
                      [ability]: Math.max(
                        3,
                        Math.min(18, Math.floor(Number(event.target.value)) || 3)
                      ),
                    },
                  })
                }
                className="input-cozy w-full text-sm py-1 text-ink"
              />
              <span
                className="block text-ink"
                aria-label={`${ABILITY_LABELS[ability]} with everything added`}
              >
                = {totals[ability]}
              </span>
            </label>
          ))}
        </div>
        <p className={HINT}>
          The scores before anything is added, 3 to 18: roll them, buy them or use the standard
          array, as your table does. Below each is the score with the background and the feats
          added.
        </p>
      </fieldset>

      {/* ── Skills ── */}
      {state.classA && (
        <fieldset disabled={disabled}>
          <legend className={LABEL}>
            Skills ({state.skills.length} of {skills.count})
          </legend>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
            {skills.among.map((skill) => {
              const checked = state.skills.includes(skill);
              return (
                <label key={skill} className="flex items-center gap-1.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && state.skills.length >= skills.count}
                    onChange={() =>
                      set({
                        skills: checked
                          ? state.skills.filter((other) => other !== skill)
                          : [...state.skills, skill],
                      })
                    }
                  />
                  {SKILL_LABELS[skill]}
                </label>
              );
            })}
          </div>
          {background && (
            <p className={HINT}>
              {background.name} already gives {background.skillProficiencies.join(' and ')}.
            </p>
          )}
        </fieldset>
      )}

      {/* ── Feats and ability scores by level ── */}
      {due.length > 0 && (
        <fieldset className="space-y-3" disabled={disabled}>
          <legend className={LABEL}>Feats by level</legend>
          {due.map((gain) => {
            const key = improvementKey(gain);
            const offered = featsFor(gain, catalogue);
            const chosen = state.improvements[key] ?? blankImprovement(undefined, gain);
            const feat = offered.find((entry) => entry.name === chosen.feat);
            return (
              <div key={key} className="rounded-lg border border-ink/10 p-3 space-y-2">
                <label htmlFor={`dnd-feat-${key}`} className="block text-sm font-medium text-ink">
                  Level {gain.level}
                  {gain.kind === 'epicBoon'
                    ? ': Epic Boon'
                    : gain.kind === 'both'
                      ? ': a feat and +2 to ability scores'
                      : ': a feat'}
                </label>
                <select
                  id={`dnd-feat-${key}`}
                  value={chosen.feat}
                  onChange={(event) =>
                    setImprovement(
                      gain,
                      blankImprovement(
                        offered.find((entry) => entry.name === event.target.value),
                        gain
                      )
                    )
                  }
                  className={FIELD}
                >
                  <option value="">Choose a feat…</option>
                  {offered.map((entry) => (
                    <option key={entry.id} value={entry.name}>
                      {entry.name} ({entry.category}
                      {entry.prerequisite ? `; needs ${entry.prerequisite}` : ''})
                    </option>
                  ))}
                </select>
                {feat && (feat.description || feat.benefits.length > 0) && (
                  <p className="text-xs text-ink-muted">
                    {feat.description || feat.benefits.map((benefit) => benefit.name).join(', ')}
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  {chosen.featPicks.map((pick, index) => (
                    <AbilitySelect
                      key={`feat-${index}`}
                      id={`dnd-feat-${key}-point-${index}`}
                      label={`${feat?.name ?? 'Feat'}: +1 to`}
                      value={pick}
                      among={feat?.abilityPoints?.among ?? ABILITIES}
                      onChange={(value) =>
                        setImprovement(gain, {
                          ...chosen,
                          featPicks: chosen.featPicks.map((other, at) =>
                            at === index ? value : other
                          ),
                        })
                      }
                    />
                  ))}
                  {chosen.extraPicks.map((pick, index) => (
                    <AbilitySelect
                      key={`extra-${index}`}
                      id={`dnd-feat-${key}-extra-${index}`}
                      label="Level: +1 to"
                      value={pick}
                      among={ABILITIES}
                      onChange={(value) =>
                        setImprovement(gain, {
                          ...chosen,
                          extraPicks: chosen.extraPicks.map((other, at) =>
                            at === index ? value : other
                          ),
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}
          <p className={HINT}>Pick the same ability twice to add 2 to it.</p>
        </fieldset>
      )}
    </div>
  );
}
