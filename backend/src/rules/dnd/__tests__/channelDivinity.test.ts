/**
 * Channel Divinity: Divine Spark's dice by Cleric level, and the ways a sheet offers it and Turn Undead.
 */

import { channelDivinityActions, divineSparkDice } from '../channelDivinity';

const cleric = (level: number, featureUses: Record<string, number> = {}) => ({
  class: 'Cleric',
  level,
  stats: { wisdom: { score: 16, modifier: 3 } },
  spellcasting: { spellSaveDC: 13 },
  featureUses,
});

describe('Divine Spark', () => {
  it('rolls another d8 at Cleric 7, 13 and 18', () => {
    expect([2, 7, 13, 18].map(divineSparkDice)).toEqual([1, 2, 3, 4]);
  });

  it('is offered as healing, Radiant and Necrotic while Channel Divinity has a use left', () => {
    const actions = channelDivinityActions(cleric(7));
    expect(actions.map((action) => action.name)).toEqual(['Divine Spark (healing)', 'Divine Spark (Radiant)', 'Divine Spark (Necrotic)', 'Turn Undead']);
    expect(actions[0].heal).toEqual({ roll: { count: 2, sides: 8 }, bonus: 3 });
    expect(actions[1].save).toEqual({ ability: 'con', dc: 13, halfOnSuccess: true, damage: [{ roll: { count: 2, sides: 8, bonus: 3 }, type: 'radiant' }] });
    expect(actions.every((action) => action.rangeFeet === 30 && action.channel === 'Channel Divinity')).toBe(true);
  });

  it('offers Turn Undead, a Wisdom save for Undead only', () => {
    const turn = channelDivinityActions(cleric(2)).find((action) => action.name === 'Turn Undead')!;
    expect(turn).toMatchObject({ onlyCreatureType: 'undead', rangeFeet: 30, save: { ability: 'wis', dc: 13, halfOnSuccess: false, damage: [] } });
  });

  it('is not offered to a Cleric below level 2, another class, or with no use left', () => {
    expect(channelDivinityActions(cleric(1))).toEqual([]);
    expect(channelDivinityActions({ ...cleric(5), class: 'Wizard' })).toEqual([]);
    expect(channelDivinityActions(cleric(2, { 'Channel Divinity': 2 }))).toEqual([]);
  });
});
