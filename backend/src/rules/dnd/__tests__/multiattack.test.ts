import { multiattackSteps } from '../multiattack';

const names = [
  'Multiattack',
  'Claw',
  'Bite',
  'Javelin',
  'Morningstar',
  'Fire Breath (Recharge 5–6)',
];

describe('multiattackSteps', () => {
  it('reads a fixed set of attacks', () => {
    expect(
      multiattackSteps('The beast makes two Claw attacks and one Bite attack.', names)
    ).toEqual([
      { count: 2, choices: [1] },
      { count: 1, choices: [2] },
    ]);
  });

  it('reads attacks with a choice of weapons', () => {
    expect(
      multiattackSteps('The bugbear makes two Javelin or Morningstar attacks.', names)
    ).toEqual([{ count: 2, choices: [3, 4] }]);
    expect(
      multiattackSteps(
        'The captain makes three attacks, using Javelin or Morningstar in any combination.',
        names
      )
    ).toEqual([{ count: 3, choices: [3, 4] }]);
    expect(
      multiattackSteps(
        'The merrow makes two attacks, using Bite, Claw, or Javelin in any combination.',
        names
      )
    ).toEqual([{ count: 2, choices: [2, 1, 3] }]);
  });

  it('reads nearly every Multiattack of the reference document', () => {
    const monsters = (
      require('../data/srd-5.2.1-monsters.json') as {
        monsters: Array<{ statBlock: { actions?: Array<{ name: string; description: string }> } }>;
      }
    ).monsters;
    let all = 0;
    let read = 0;
    for (const monster of monsters) {
      const actions = monster.statBlock.actions ?? [];
      for (const action of actions.filter((entry) => /^multiattack/i.test(entry.name))) {
        all += 1;
        if (
          multiattackSteps(
            action.description,
            actions.map((entry) => entry.name)
          )
        )
          read += 1;
      }
    }
    expect(read / all).toBeGreaterThan(0.97);
  });

  it('reads only the first sentence, and nothing it cannot name', () => {
    expect(
      multiattackSteps(
        'The beast makes one Bite attack. It can replace one attack with a use of Fire Breath.',
        names
      )
    ).toEqual([{ count: 1, choices: [2] }]);
    expect(multiattackSteps('The beast makes two Tail attacks.', names)).toBeNull();
    expect(multiattackSteps('The beast uses Frightful Presence.', names)).toBeNull();
  });
});
