import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandsAidPicker from '../LandsAidPicker';

const creatures = [
  { id: 'druid', name: 'Druid' },
  { id: 'ogre', name: 'Ogre' },
  { id: 'ally', name: 'Ally' },
];
const show = (onUse = vi.fn(), listed = creatures) => {
  render(
    <LandsAidPicker
      name="Land's Aid"
      detail="CON save DC 14"
      dice="2d6"
      creatures={listed}
      userId="druid"
      busy={false}
      onUse={onUse}
    />
  );
  return onUse;
};

describe('LandsAidPicker', () => {
  it('spares the Druid by default, and sends the creatures that save with the one healed', () => {
    const onUse = show();
    expect(screen.getByLabelText('Druid makes the save')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('Ally makes the save'));
    fireEvent.change(screen.getByLabelText("Land's Aid: the creature that regains Hit Points"), {
      target: { value: 'ally' },
    });
    fireEvent.click(screen.getByRole('button', { name: "Use Land's Aid" }));
    expect(onUse).toHaveBeenCalledWith(['ogre'], 'ally');
  });

  it('heals nobody unless one is chosen, and needs a creature to save', () => {
    const onUse = show();
    fireEvent.click(screen.getByRole('button', { name: "Use Land's Aid" }));
    expect(onUse).toHaveBeenCalledWith(['ogre', 'ally'], undefined);
    fireEvent.click(screen.getByLabelText('Ogre makes the save'));
    fireEvent.click(screen.getByLabelText('Ally makes the save'));
    expect(screen.getByRole('button', { name: "Use Land's Aid" })).toBeDisabled();
  });

  it('says when nobody stands in the area', () => {
    show(vi.fn(), []);
    expect(screen.getByText('Nobody stands in the area.')).toBeInTheDocument();
  });
});
