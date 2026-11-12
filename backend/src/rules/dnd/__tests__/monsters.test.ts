/**
 * The monsters of the SRD 5.2.1: that the build kept every stat block whole,
 * that the creature library accepts each one, and that the engine can read
 * their attacks and saving throws.
 */

import { NpcStatBlockSchema } from '../../../validators/statBlock';
import { actionsFromStatBlock, defencesFromStatBlock } from '../actions';
import { allMonsters, challengeNumber, findMonster } from '../monsters';

const monster = (name: string) => {
  const found = findMonster(name);
  if (!found) throw new Error(`no monster ${name}`);
  return found;
};

describe('the catalogue', () => {
  it('holds every stat block of the document, each one whole', () => {
    const monsters = allMonsters();
    expect(monsters).toHaveLength(330);
    expect(new Set(monsters.map((m) => m.name)).size).toBe(330);
    for (const m of monsters) {
      const block = m.statBlock;
      expect(m.name).toMatch(/^[A-Z][A-Za-z’' -]+$/);
      expect(block.ac).toBeGreaterThan(0);
      expect(block.hpMax).toBeGreaterThan(0);
      expect(Object.keys(block.abilities).sort()).toEqual(['cha', 'con', 'dex', 'int', 'str', 'wis']);
      expect(block.speed).toMatch(/\d+ ft\./);
      expect(block.challengeRating).toMatch(/^(0|1\/8|1\/4|1\/2|\d{1,2})$/);
      expect(m.size.width).toBe(m.size.height);
      for (const section of [block.traits, block.actions, block.bonusActions, block.reactions, block.legendaryActions]) {
        for (const entry of section ?? []) {
          expect(entry.name.length).toBeLessThan(60);
          // A list of spells ends with its last spell; everything else ends a sentence or opens a list.
          if (entry.name !== 'Spellcasting') expect(entry.description).toMatch(/[.):]$/);
          expect(entry.description.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it('is accepted by the creature library, every one', () => {
    const refused = allMonsters()
      .map((m) => ({ name: m.name, result: NpcStatBlockSchema.safeParse(m.statBlock) }))
      .filter((entry) => !entry.result.success)
      .map((entry) => `${entry.name}: ${entry.result.error?.issues[0]?.path.join('.')} ${entry.result.error?.issues[0]?.message}`);
    expect(refused).toEqual([]);
  });

  it('reads a stat block as the document prints it', () => {
    const goblin = monster('goblin warrior');
    expect(goblin).toMatchObject({ creatureType: 'Small Fey (Goblinoid)', alignment: 'Chaotic Neutral', challengeRating: '1/4', size: { width: 1, height: 1 } });
    expect(goblin.statBlock).toMatchObject({
      ac: 15, hpMax: 10, hitDice: '3d6', speed: '30 ft.', xp: 50, skills: { stealth: 6 },
      abilities: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
      senses: 'Darkvision 60 ft.; Passive Perception 9', languages: 'Common, Goblin',
    });
    expect(goblin.statBlock.savingThrows).toBeUndefined();
    expect(goblin.statBlock.bonusActions?.map((entry) => entry.name)).toEqual(['Nimble Escape']);
    expect(goblin.statBlock.notes).toContain('Gear: Leather Armor, Scimitar, Shield, Shortbow');
  });

  it('keeps saves, defences, legendary actions and size', () => {
    const lich = monster('Lich').statBlock;
    expect(lich.savingThrows).toEqual({ dex: 10, con: 10, int: 12, wis: 9 });
    expect(lich).toMatchObject({ damageResistances: 'Cold, Lightning', damageImmunities: 'Necrotic, Poison', conditionImmunities: 'Charmed, Exhaustion, Frightened, Paralyzed, Poisoned' });
    expect(lich.legendaryActions?.map((entry) => entry.name)).toEqual(['Deathly Teleport', 'Disrupt Life', 'Frightening Gaze']);
    expect(lich.notes).toContain('Legendary Action Uses: 3 (4 in Lair)');
    expect(monster('Adult Red Dragon').size).toEqual({ width: 3, height: 3 });
    expect(monster('Swarm of Rats').statBlock.conditionImmunities).toContain('Grappled');
    expect(monster('Swarm of Rats').statBlock.damageImmunities).toBeUndefined();
  });

  it('orders challenge ratings as numbers', () => {
    expect(['2', '1/4', '10', '0', '1/8'].sort((a, b) => challengeNumber(a) - challengeNumber(b))).toEqual(['0', '1/8', '1/4', '2', '10']);
  });
});

describe('what the engine reads from them', () => {
  it('reads the attack rolls of the 2024 wording', () => {
    const [scimitar, shortbow] = actionsFromStatBlock(monster('Goblin Warrior').statBlock);
    expect(scimitar.attack).toMatchObject({ kind: 'melee', bonus: 4, reachFeet: 5, damage: [{ roll: { count: 1, sides: 6, bonus: 2 }, type: 'slashing' }] });
    expect(shortbow.attack).toMatchObject({ kind: 'ranged', bonus: 4, rangeFeet: { normal: 80, long: 320 } });
  });

  it('reads a saving throw for half', () => {
    const breath = actionsFromStatBlock(monster('Adult Red Dragon').statBlock).find((action) => action.name.startsWith('Fire Breath'));
    expect(breath?.save).toMatchObject({ ability: 'dex', dc: 21, halfOnSuccess: true });
    expect(breath?.save?.damage[0]).toMatchObject({ type: 'fire' });
  });

  it('can roll something for nearly every creature', () => {
    const none = allMonsters()
      .filter((m) => !actionsFromStatBlock(m.statBlock).some((action) => action.attack || action.save))
      .map((m) => m.name);
    // A creature with nothing to roll is rare: it has no actions, or only ones that say what happens.
    expect(none.length).toBeLessThan(8);
  });

  it('reads defences', () => {
    expect(defencesFromStatBlock(monster('Lich').statBlock)).toMatchObject({ resistances: ['cold', 'lightning'], immunities: ['necrotic', 'poison'] });
  });
});
