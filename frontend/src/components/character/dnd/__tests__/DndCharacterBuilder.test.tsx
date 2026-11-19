/**
 * The guided D&D builder form: it loads the campaign's rules and offers what
 * they allow.
 */

import { it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DndRulesCatalogue } from '@/types';
import { DEFAULT_CHARACTER_RULES, RULES_AS_WRITTEN } from '@/utils/characterRules';

const api = vi.hoisted(() => ({ getDndRules: vi.fn() }));
vi.mock('@/services/api', () => ({ api, default: api }));

import DndCharacterBuilder from '../DndCharacterBuilder';
import { initialState, type BuilderState } from '../builderState';

const catalogue = (rules = DEFAULT_CHARACTER_RULES): DndRulesCatalogue => ({
  source: 'SRD',
  characterRules: rules,
  species: [{ id: 'dwarf', name: 'Dwarf', creatureType: 'Humanoid', size: 'Medium', speedFeet: 30, traits: [{ name: 'Darkvision', text: '' }] }],
  backgrounds: [{
    id: 'soldier', name: 'Soldier', abilityScores: ['Strength', 'Dexterity', 'Constitution'], feat: 'Savage Attacker',
    skillProficiencies: ['Athletics', 'Intimidation'], toolProficiency: 'Gaming Set', equipment: '',
  }],
  feats: [
    { id: 'alert', name: 'Alert', category: 'Origin', prerequisite: null, description: '', benefits: [], repeatable: null, abilityPoints: null },
    { id: 'savage-attacker', name: 'Savage Attacker', category: 'Origin', prerequisite: null, description: '', benefits: [], repeatable: null, abilityPoints: null },
    { id: 'grappler', name: 'Grappler', category: 'General', prerequisite: 'Level 4+', description: '', benefits: [], repeatable: null, abilityPoints: { total: 1, among: ['str', 'dex'], cap: 22 } },
  ],
  classes: ['Fighter', 'Wizard'].map((name) => ({
    id: name.toLowerCase(), name, coreTraits: {}, hitDie: 10, savingThrows: ['str', 'con'], caster: null,
    skillChoices: { count: 2, among: ['perception', 'history', 'insight'] }, featuresByLevel: [], subclass: '',
    improvements: [{ level: 4, kind: rules.featAndAbilityScores ? 'both' : 'feat', abilityPoints: rules.featAndAbilityScores ? 2 : 0 }],
  })),
});

let latest: BuilderState;
function Harness() {
  const [state, setState] = useState(initialState);
  latest = state;
  return <DndCharacterBuilder campaignId="campaign-1" state={state} onChange={setState} onCatalogue={() => {}} />;
}

beforeEach(() => vi.clearAllMocks());

it('offers a second class, any score and any origin feat under the house rules', async () => {
  api.getDndRules.mockResolvedValue(catalogue());
  render(<Harness />);
  await userEvent.selectOptions(await screen.findByLabelText('Species'), 'Dwarf');
  expect(screen.getByText(/Speed 30 ft · Darkvision/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Background'), 'Soldier');
  expect(within(screen.getByLabelText('+2 to')).getAllByRole('option')).toHaveLength(7);
  expect(within(screen.getByLabelText('Origin feat')).getByRole('option', { name: 'Alert' })).toBeInTheDocument();
  expect(screen.getByLabelText('Second class')).toBeInTheDocument();
});

it('keeps to the background and one class as written', async () => {
  api.getDndRules.mockResolvedValue(catalogue(RULES_AS_WRITTEN));
  render(<Harness />);
  await userEvent.selectOptions(await screen.findByLabelText('Background'), 'Soldier');
  expect(within(screen.getByLabelText('+2 to')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'Strength', 'Dexterity', 'Constitution']);
  // The one feat the background gives is chosen for the player.
  expect(latest.originFeat).toBe('Savage Attacker');
  expect(screen.getByLabelText('Origin feat')).toBeDisabled();
  expect(screen.queryByLabelText('Second class')).not.toBeInTheDocument();
});

it('asks for a feat and the level’s points when the level gives them, and stops at the skills allowed', async () => {
  api.getDndRules.mockResolvedValue(catalogue());
  render(<Harness />);
  await userEvent.selectOptions(await screen.findByLabelText('Class'), 'Fighter');
  await userEvent.click(screen.getByLabelText('Perception'));
  await userEvent.click(screen.getByLabelText('History'));
  expect(screen.getByLabelText('Insight')).toBeDisabled();
  expect(screen.queryByText('Feats by level')).not.toBeInTheDocument();

  await userEvent.clear(screen.getByLabelText('Level'));
  await userEvent.type(screen.getByLabelText('Level'), '4');
  await userEvent.selectOptions(screen.getByLabelText(/Level 4: a feat and \+2/), 'Grappler');
  await userEvent.selectOptions(screen.getByLabelText('Grappler: +1 to'), 'str');
  for (const select of screen.getAllByLabelText('Level: +1 to')) await userEvent.selectOptions(select, 'con');
  expect(latest.improvements['4:both']).toEqual({ feat: 'Grappler', featPicks: ['str'], extraPicks: ['con', 'con'] });
  expect(screen.getByLabelText('Strength with everything added')).toHaveTextContent('= 16');
  expect(screen.getByLabelText('Constitution with everything added')).toHaveTextContent('= 15');
});

it('says so when the rules cannot be loaded', async () => {
  api.getDndRules.mockRejectedValue(Object.assign(new Error('nope'), { response: { status: 404, data: { message: 'This campaign is not set to D&D 5e' } } }));
  render(<Harness />);
  expect(await screen.findByText('This campaign is not set to D&D 5e')).toBeInTheDocument();
});

it('asks for the option of a feature the class gives at the level, as a step of its own', async () => {
  api.getDndRules.mockResolvedValue({
    ...catalogue(),
    featureChoices: [{
      id: 'fightingStyleFighter', title: 'Fighting Style', class: 'Fighter', level: 1, counts: Array(20).fill(1), writes: 'adds', asked: true,
      options: [{ label: 'Archery', name: 'Archery (Fighting Style feat)' }, { label: 'Defense', name: 'Defense (Fighting Style feat)' }],
    }],
  });
  render(<Harness />);
  await userEvent.selectOptions(await screen.findByLabelText('Class'), 'Wizard');
  expect(screen.queryByText('Feature options')).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Class'), 'Fighter');
  expect(screen.getByText('Feature options')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Fighting Style'), 'Defense');
  expect(latest.featureChoices).toEqual({ fightingStyleFighter: ['Defense'] });
});

it('asks for the starting equipment and the spells, as steps of their own', async () => {
  const base = catalogue();
  api.getDndRules.mockResolvedValue({
    ...base,
    classes: base.classes.map((entry) =>
      entry.name === 'Fighter'
        ? {
            ...entry,
            coreTraits: { 'Weapon Proficiencies': 'Simple and Martial weapons' },
            weaponMastery: Array(20).fill(1),
            startingEquipment: [
              { option: 'A', gold: 4, text: 'Greatsword, 8 Javelins, and 4 GP', items: [{ name: 'Greatsword', quantity: 1, weapon: 'Greatsword' }, { name: 'Javelin', quantity: 8, weapon: 'Javelin' }] },
              { option: 'B', gold: 155, text: '155 GP', items: [] },
            ],
          }
        : {
            ...entry,
            spellcasting: { cantrips: Array(20).fill(1), prepared: Array(20).fill(1), maxSpellLevel: Array(20).fill(1), spellbook: Array(20).fill(2), alwaysPrepared: [] },
          }
    ),
    spells: [
      { name: 'Fire Bolt', level: 0, classes: ['Wizard'], school: 'Evocation', ritual: false, concentration: false },
      { name: 'Light', level: 0, classes: ['Wizard'], school: 'Evocation', ritual: false, concentration: false },
      { name: 'Magic Missile', level: 1, classes: ['Wizard'], school: 'Evocation', ritual: false, concentration: false },
      { name: 'Sleep', level: 1, classes: ['Wizard'], school: 'Enchantment', ritual: false, concentration: true },
    ],
  } satisfies DndRulesCatalogue);
  render(<Harness />);
  await userEvent.selectOptions(await screen.findByLabelText('Class'), 'Fighter');
  expect(screen.getByText('Equipment')).toBeInTheDocument();
  expect(screen.queryByText('Spells')).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('(A) Greatsword, 8 Javelins, and 4 GP'));
  expect(latest.classEquipment).toBe('A');
  await userEvent.click(screen.getByLabelText('Greatsword'));
  expect(screen.getByLabelText('Javelin')).toBeDisabled();
  expect(latest.masteries).toEqual(['Greatsword']);

  await userEvent.selectOptions(screen.getByLabelText('Class'), 'Wizard');
  expect(latest.classEquipment).toBe('');
  const cantrips = screen.getByRole('group', { name: 'Cantrips (0 of 1)' });
  await userEvent.click(within(cantrips).getByLabelText('Fire Bolt'));
  expect(within(screen.getByRole('group', { name: 'Cantrips (1 of 1)' })).getByLabelText('Light')).toBeDisabled();
  await userEvent.click(within(screen.getByRole('group', { name: 'Spellbook (0 of 2)' })).getByLabelText('Magic Missile'));
  // Prepared from the book: only what it holds.
  const prepared = screen.getByRole('group', { name: 'Prepared, from the spellbook (0 of 1)' });
  expect(within(prepared).queryByLabelText('Sleep')).not.toBeInTheDocument();
  await userEvent.click(within(prepared).getByLabelText('Magic Missile'));
  expect(latest.spells.Wizard).toEqual({ cantrips: ['Fire Bolt'], spellbook: ['Magic Missile'], prepared: ['Magic Missile'] });
});
