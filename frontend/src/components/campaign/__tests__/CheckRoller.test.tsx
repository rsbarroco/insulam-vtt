/**
 * The check roller: what it sends for a skill, an ability and the Hide
 * action, and what it says of the answer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CheckRoller from '../CheckRoller';
import { checkChoice } from '@/utils/abilityChecks';

const resolve = vi.fn();
const onResult = vi.fn();
const open = (passivePerception: number | null = 13) => {
  render(
    <CheckRoller tokenId="hero" name="Hero" passivePerception={passivePerception} resolve={resolve} onResult={onResult} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
};
const pick = (value: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Check' }), { target: { value } });

beforeEach(() => {
  resolve.mockReset().mockResolvedValue({ ok: true, summary: 'Hero check: 17', total: 17, success: null, reasons: [], hidden: false });
  onResult.mockReset();
});

describe('CheckRoller', () => {
  it('rolls a skill with no DC as the table reads it', async () => {
    open();
    pick('skill:athletics');
    fireEvent.click(screen.getByRole('button', { name: 'Roll' }));

    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ tokenId: 'hero', skill: 'athletics' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('Hero check: 17', 'info'));
  });

  it('sends the DC and the roll the table chose, and marks a success', async () => {
    resolve.mockResolvedValue({ ok: true, summary: 'made it', total: 18, success: true, reasons: [], hidden: false });
    open();
    pick('ability:str');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'DC' }), { target: { value: '15' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Roll' }), { target: { value: 'advantage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Roll' }));

    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ tokenId: 'hero', ability: 'str', dc: 15, mode: 'advantage' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('made it', 'success'));
  });

  it('takes the Hide action at its own DC', async () => {
    open();
    pick('hide');
    expect(screen.getByRole('spinbutton', { name: 'DC' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'DC' })).toHaveValue(15);
    fireEvent.click(screen.getByRole('button', { name: 'Roll' }));

    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ tokenId: 'hero', hide: true }));
  });

  it('leaves out a DC that is not one', async () => {
    open();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'DC' }), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Roll' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ tokenId: 'hero', skill: 'perception' }));
  });

  it('says why when the server refuses', async () => {
    resolve.mockResolvedValue({ ok: false, error: 'You can only act for your own token' });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Roll' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('You can only act for your own token', 'error'));
  });

  it('shows the passive Perception the server gave, and nothing without one', () => {
    open(13);
    expect(screen.getByText('Passive Perception 13')).toBeInTheDocument();
  });

  it('shows no passive Perception when there is none', () => {
    open(null);
    expect(screen.queryByText(/Passive Perception/)).not.toBeInTheDocument();
  });
});

describe('checkChoice', () => {
  it('reads the three kinds of choice and nothing else', () => {
    expect(checkChoice('hide')).toEqual({ hide: true });
    expect(checkChoice('skill:sleightOfHand')).toEqual({ skill: 'sleightOfHand' });
    expect(checkChoice('ability:wis')).toEqual({ ability: 'wis' });
    expect(checkChoice('skill:juggling')).toBeNull();
    expect(checkChoice('ability:luck')).toBeNull();
  });
});
