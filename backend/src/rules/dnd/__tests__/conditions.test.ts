import {
  attackModifiers,
  canAct,
  d20Penalty,
  effectiveSpeed,
  readConditions,
  saveModifiers,
  unexpired,
  type ConditionInstance,
} from '../conditions';

const none = readConditions([]);
const having = (...names: string[]) => readConditions(names);
const attack = (over: Partial<Parameters<typeof attackModifiers>[0]> = {}) =>
  attackModifiers({ attacker: none, target: none, distanceFeet: 5, ...over });

describe('readConditions', () => {
  it('reads names whatever their case and ignores ones the rules do not have', () => {
    const state = readConditions(['Prone', 'POISONED', 'On Fire']);
    expect([...state.has].sort()).toEqual(['poisoned', 'prone']);
  });

  it('counts the conditions that include being Incapacitated', () => {
    for (const name of ['Paralyzed', 'Petrified', 'Stunned', 'Unconscious']) {
      expect(having(name).has.has('incapacitated')).toBe(true);
    }
    expect(having('Restrained').has.has('incapacitated')).toBe(false);
  });

  it('makes an Unconscious creature Prone', () => {
    expect(having('Unconscious').has.has('prone')).toBe(true);
  });

  it('reads Exhausted as one level of Exhaustion, or the level it is told', () => {
    expect(having('Exhausted').exhaustion).toBe(1);
    expect(readConditions([], 3).exhaustion).toBe(3);
    expect(readConditions(['Exhausted'], 0).has.has('exhaustion')).toBe(false);
    expect(readConditions([], 9).exhaustion).toBe(6);
  });
});

describe('acting, speed and Exhaustion', () => {
  it('stops an Incapacitated creature acting', () => {
    expect(canAct(none)).toBe(true);
    expect(canAct(having('Stunned'))).toBe(false);
  });

  it('takes 2 from every D20 Test for each level of Exhaustion', () => {
    expect(d20Penalty(none)).toBe(0);
    expect(d20Penalty(readConditions([], 3))).toBe(-6);
  });

  it('stops a held creature and slows an exhausted one', () => {
    expect(effectiveSpeed(30, none)).toBe(30);
    for (const name of ['Grappled', 'Paralyzed', 'Petrified', 'Restrained', 'Unconscious']) {
      expect(effectiveSpeed(30, having(name))).toBe(0);
    }
    expect(effectiveSpeed(30, readConditions([], 2))).toBe(20);
    expect(effectiveSpeed(10, readConditions([], 4))).toBe(0);
  });
});

describe('attackModifiers', () => {
  it('is a normal roll with nothing going on', () => {
    expect(attack()).toEqual({ mode: 'normal', penalty: 0, criticalOnHit: false, reasons: [] });
  });

  it.each(['Blinded', 'Poisoned', 'Prone', 'Restrained', 'Frightened'])('gives Disadvantage to a %s attacker', (name) => {
    expect(attack({ attacker: having(name) }).mode).toBe('disadvantage');
  });

  it('spares a Frightened attacker who cannot see what it fears', () => {
    expect(attack({ attacker: having('Frightened'), fearInSight: false }).mode).toBe('normal');
  });

  it('gives a Grappled attacker Disadvantage only against someone other than its grappler', () => {
    expect(attack({ attacker: having('Grappled') }).mode).toBe('normal');
    expect(attack({ attacker: having('Grappled'), grappledByAnother: true }).mode).toBe('disadvantage');
  });

  it.each(['Blinded', 'Paralyzed', 'Petrified', 'Restrained', 'Stunned', 'Unconscious'])(
    'gives Advantage against a %s target',
    (name) => {
      expect(attack({ target: having(name) }).mode).toBe('advantage');
    }
  );

  it('gives Advantage to an attacker the target cannot see, and Disadvantage against an Invisible target', () => {
    expect(attack({ attacker: having('Invisible') }).mode).toBe('advantage');
    expect(attack({ unseenAttacker: true }).mode).toBe('advantage');
    expect(attack({ target: having('Invisible') }).mode).toBe('disadvantage');
  });

  it('gives Advantage against a Prone target up close and Disadvantage from afar', () => {
    expect(attack({ target: having('Prone'), distanceFeet: 5 }).mode).toBe('advantage');
    expect(attack({ target: having('Prone'), distanceFeet: 30, ranged: true }).mode).toBe('disadvantage');
  });

  it('cancels any Advantage against any Disadvantage', () => {
    const outcome = attack({ attacker: having('Poisoned', 'Prone'), target: having('Stunned') });
    expect(outcome.mode).toBe('normal');
    expect(outcome.reasons).toHaveLength(3);
  });

  it('makes a hit a Critical Hit against a Paralyzed or Unconscious target within 5 feet', () => {
    expect(attack({ target: having('Paralyzed'), distanceFeet: 5 }).criticalOnHit).toBe(true);
    expect(attack({ target: having('Unconscious'), distanceFeet: 5 }).criticalOnHit).toBe(true);
    expect(attack({ target: having('Paralyzed'), distanceFeet: 10 }).criticalOnHit).toBe(false);
    expect(attack({ target: having('Stunned'), distanceFeet: 5 }).criticalOnHit).toBe(false);
  });

  it('carries the attacker Exhaustion as a penalty', () => {
    expect(attack({ attacker: readConditions([], 2) }).penalty).toBe(-4);
  });
});

describe('saveModifiers', () => {
  it.each(['Paralyzed', 'Petrified', 'Stunned', 'Unconscious'])('fails Strength and Dexterity saves for a %s creature', (name) => {
    expect(saveModifiers(having(name), 'str').autoFail).toBe(true);
    expect(saveModifiers(having(name), 'dex').autoFail).toBe(true);
    expect(saveModifiers(having(name), 'wis').autoFail).toBe(false);
  });

  it('gives a Restrained creature Disadvantage on Dexterity saves only', () => {
    expect(saveModifiers(having('Restrained'), 'dex').mode).toBe('disadvantage');
    expect(saveModifiers(having('Restrained'), 'con').mode).toBe('normal');
  });

  it('carries Exhaustion as a penalty', () => {
    expect(saveModifiers(readConditions([], 1), 'con').penalty).toBe(-2);
  });
});

describe('unexpired', () => {
  const stunned: ConditionInstance = { condition: 'stunned', until: { round: 2, tokenId: 'caster', at: 'end' } };
  const prone: ConditionInstance = { condition: 'prone' };

  it('keeps a condition with no end', () => {
    expect(unexpired([prone], { round: 99, tokenId: 'anyone', at: 'end' })).toEqual([prone]);
  });

  it('keeps a condition until its moment comes', () => {
    expect(unexpired([stunned], { round: 2, tokenId: 'caster', at: 'start' })).toEqual([stunned]);
    expect(unexpired([stunned], { round: 2, tokenId: 'other', at: 'end' })).toEqual([stunned]);
    expect(unexpired([stunned], { round: 1, tokenId: 'caster', at: 'end' })).toEqual([stunned]);
  });

  it('drops it at its moment, and in any later round', () => {
    expect(unexpired([stunned], { round: 2, tokenId: 'caster', at: 'end' })).toEqual([]);
    expect(unexpired([stunned], { round: 3, tokenId: 'other', at: 'start' })).toEqual([]);
  });
});
