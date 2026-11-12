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
