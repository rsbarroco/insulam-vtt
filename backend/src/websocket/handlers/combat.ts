/**
 * Combat resolution: the server makes an attack for a token, by the D&D
 * rules, and applies what it does.
 *
 * The attacker's attacks come from its character sheet or its stat block;
 * the target's Armor Class and hit points from its own. Distance and cover
 * are worked out on the map as it is stored, with the same code the tactical
 * view shows them with. The roll is recorded in the dice log like any other.
 */

import { creatureSees } from '../../utils/spirit-layer';
import { Server } from 'socket.io';
import { AuthenticatedSocket, type AuthenticatedFields } from '../auth';
import { prisma } from '../../config/database';
import logger from '../../utils/logger';
import { readTokens, toJson } from '../../utils/prisma-json';
import { withMapsLocked } from '../../utils/mapTokens';
import { readTileHeights } from '../../utils/tileHeights';
import { extractCharacterHp } from '../../utils/characterHp';
import { canControlToken } from '../../services/permissions';
import { ackFrom, refuseRequest, type SocketAck } from '../ack';
import { broadcastMapData, withinCeiling, type Token } from '../shared';
import { bestEffort, campaignSockets, emitCharacterUpdated, stillInCampaign } from '../utils';
import { getState as getCombatState, setState as setCombatState, someoneActing, turnSerial, type WeaponMark } from '../initiativeState';
import { resendInitiativeState } from './initiative';
import { applyHpDelta } from './characters';
import { CombatActionsSchema, CombatAttackSchema, CombatCheckSchema, CombatDeathSaveSchema, CombatFallSchema, CombatFeatureSchema, CombatRestSchema, CombatStandSchema, CombatSaveSchema, CombatHelpSchema, CombatReadySchema, CombatConcentrateSchema, CombatHealSchema, CombatUndoSchema } from '../../validators/combat';
import { actionsFromSheet, actionsFromStatBlock, defencesFromStatBlock, legendaryUses, type AreaOfEffect, type CombatAction, type DamageComponent, type SheetAttack } from '../../rules/dnd/actions';
import { castWithSlot, concentrationSpellsOf, findSpell, slotsLeft, spellActionsFromSheet, withSlotSpent, type SheetSpellcasting } from '../../rules/dnd/spells';
import { resolveSave, type SaveResult } from '../../rules/dnd/resolveSave';
import { canAct, DODGING, effectiveSpeed, RAGING, readConditions, saveModifiers, type Ability } from '../../rules/dnd/conditions';
import { rollDie, savingThrow } from '../../rules/dnd/d20';
import { leavesReachOf, sideOf } from '../../rules/dnd/opportunity';
import { resolveFall } from '../../rules/dnd/falling';
import { longRest, spendHitDie } from '../../rules/dnd/rests';
import { bardicDie, POINT_RESOURCES, rageDamage, resourcesOf, restoreResources, secondWindBonus, spendResource, type ResourceName } from '../../rules/dnd/resources';
import { canWrestle, proficiencyBonusForChallenge, pushedTo, unarmedActions } from '../../rules/dnd/unarmed';
import { challengeNumber } from '../../rules/dnd/monsters';
import { ABILITY_CHECK_NAMES, HIDE_DC, passiveScore, resolveCheck, SKILL_CHECKS, type SkillCheck } from '../../rules/dnd/checks';
import { adjustedDamage, applyDamage, concentrationDC, DAMAGE_TYPES, rollDamage, type DamageType, type Defences, type HitPoints } from '../../rules/dnd/damage';
import { hasWeaponMastery, masteryEffect, weaponModifier } from '../../rules/dnd/masteries';
import { deathSavesAfterDamage, deathSavingThrow, isDying, readDeathSaves } from '../../rules/dnd/deathSaves';
import { attacksPerAction, featureOptions, hasFeature, readFeatures } from '../../rules/dnd/featureEffects';
import { resolveAttack, type AttackResult, type Combatant } from '../../rules/dnd/resolveAttack';
import { distanceFeet, type Standing } from '../../utils/boardSight';
import { sneakAttackDamage, sneakAttackDice } from '../../rules/dnd/sneakAttack';
import { canSmiteWith, divineSmiteDamage, hasDivineSmite } from '../../rules/dnd/smites';
import { endure, hasLuck, lucky, speciesResistances } from '../../rules/dnd/species';
import { archeryBonus, greatWeaponFighting, savageAttackerApplies } from '../../rules/dnd/feats';
import { onTurnEnd, onTurnStart } from '../turnHooks';
import { commitUndo, prepareUndo, restoreSnapshot, takeLastUndo, undoCount } from '../combatUndo';
import { multiattackSteps, type MultiattackStep } from '../../rules/dnd/multiattack';
import { hasTurnFeature, turnFeatureEffect, type TurnFeature } from '../../rules/dnd/bonusActions';
import { conditionsOnFailure, conditionsOnHit, fits, sizeOfSquares, turnLimit, type ConditionRider } from '../../rules/dnd/actionConditions';
import { extrasOf, hasTwoWeaponFighting, withoutAbilityModifier, type ExtraAttack } from '../../rules/dnd/extraAttacks';

/** The one system whose rules the engine knows. */
const DND = 'DND_5E';

/** What the client is told of one action, enough to list and choose it. */
interface ActionSummary {
  index: number;
  name: string;
  cost: CombatAction['cost'];
  /** Present when the VTT can make the attack roll. */
  attack: { kind: 'melee' | 'ranged'; bonus: number; reachFeet?: number; rangeFeet?: { normal: number; long: number | null }; damage: string } | null;
  /** For a spell: its level, and for a levelled one the slot levels the caster can cast it with now. */
  spell: { level: number; slotLevels: number[] } | null;
  /** Present when the VTT can roll the targets' saving throws. */
  save: { ability: Ability; dc: number; halfOnSuccess: boolean; damage: string; rangeFeet?: number; area?: AreaOfEffect } | null;
  /** The extra attacks the weapon can be made as: Cleave, or the Light weapon's extra attack. */
  extras?: ExtraAttack[];
  /** A "(Recharge 5–6)" action: the lowest d6 roll that gives it back, and whether it is ready now. */
  recharge?: { min: number; ready: boolean };
  /** A stat block's Multiattack: how many attacks, and which actions (by index) each may be. */
  multiattack?: MultiattackStep[];
  /** A Legendary Action: the uses the creature has a round, and how many it has taken. */
  legendary?: { max: number; used: number };
  /** A healing spell, made with `combat.heal`: what it restores at its own level ("2d8+3") and its range. */
  heal?: { dice: string; rangeFeet: number };
}

const standing = (token: Token): Standing => ({
  cell: { x: Math.floor(token.position.x), y: Math.floor(token.position.y) },
  size: { width: token.size?.width ?? 1, height: token.size?.height ?? 1 },
});

function damageLine({ roll, type }: DamageComponent): string {
  const dice = roll.count > 0 ? `${roll.count}d${roll.sides}` : '';
  const bonus = roll.bonus ? (dice ? `${roll.bonus > 0 ? '+' : '-'}${Math.abs(roll.bonus)}` : String(roll.bonus)) : '';
  return `${dice}${bonus}${type ? ` ${type}` : ''}`.trim();
}

function damageText(action: CombatAction): string {
  return (action.attack?.damage ?? []).map(damageLine).filter(Boolean).join(' + ');
}

function summarizeAction(action: CombatAction, index: number, slots: Record<number, number>, spent: readonly string[] = []): ActionSummary {
  const attack = action.attack;
  return {
    ...(action.recharge ? { recharge: { min: action.recharge, ready: !spent.includes(action.name) } } : {}),
    ...(action.heal
      ? {
          heal: {
            dice: `${action.heal.roll.count}d${action.heal.roll.sides}${action.heal.bonus < 0 ? '-' : '+'}${Math.abs(action.heal.bonus)}`,
            rangeFeet: action.rangeFeet ?? 5,
          },
        }
      : {}),
    index,
    name: action.name,
    cost: action.cost,
    attack: attack
      ? { kind: attack.kind, bonus: attack.bonus, reachFeet: attack.reachFeet, rangeFeet: attack.rangeFeet, damage: damageText(action) }
      : null,
    spell: action.spell
      ? {
          level: action.spell.level,
          slotLevels: Object.keys(slots).map(Number).filter((level) => action.spell!.level > 0 && level >= action.spell!.level),
        }
      : null,
    save: action.save
      ? {
          ability: action.save.ability,
          dc: action.save.dc,
          halfOnSuccess: action.save.halfOnSuccess,
          damage: (action.save.damage ?? []).map(damageLine).filter(Boolean).join(' + '),
          rangeFeet: action.rangeFeet,
          area: action.area,
        }
      : null,
    ...(extrasOf(action).length > 0 ? { extras: extrasOf(action) } : {}),
  };
}

/** The sheet of the character a token is bound to, when it is a D&D one in this campaign. */
async function sheetOf(token: Token, campaignId: string): Promise<Record<string, unknown> | null> {
  if (!token.characterId) return null;
  const character = await prisma.character.findFirst({
    where: { id: token.characterId, campaignId },
    select: { gameSystem: true, data: true },
  });
  if (!character || character.gameSystem !== DND) return null;
  return (character.data ?? null) as Record<string, unknown> | null;
}

/** A token's actions: its character's attacks and spells, or its stat block's. */
function actionsOf(token: Token, sheet: Record<string, unknown> | null): CombatAction[] {
  const own = sheet
    ? [...actionsFromSheet({ attacks: (sheet.attacks ?? []) as SheetAttack[] }), ...spellActionsFromSheet(sheet as SheetSpellcasting)]
    : token.statBlock
      ? actionsFromStatBlock(token.statBlock as Parameters<typeof actionsFromStatBlock>[0])
      : [];
  // Every creature has an Unarmed Strike. They come last, so its own actions keep their places.
  const strength = abilityModifierOf(token, sheet, 'str');
  if (strength === null) return own;
  const listed = own.some((action) => action.name.trim().toLowerCase() === 'unarmed strike');
  return [...own, ...unarmedActions(strength, proficiencyBonusOf(token, sheet)).filter((action) => !(listed && action.unarmed === 'damage'))];
}

/** A creature's Proficiency Bonus: its sheet's, or the one its Challenge Rating gives. */
function proficiencyBonusOf(token: Token, sheet: Record<string, unknown> | null): number {
  if (sheet) return typeof sheet.proficiencyBonus === 'number' ? sheet.proficiencyBonus : 2;
  const rating = (token.statBlock as { challengeRating?: unknown } | null | undefined)?.challengeRating;
  return proficiencyBonusForChallenge(typeof rating === 'string' || typeof rating === 'number' ? challengeNumber(String(rating)) || 0 : 0);
}

/** An ability score from a sheet's stats, or null. */
function scoreOf(sheet: Record<string, unknown>, ability: string): number | null {
  const score = (sheet.stats as Record<string, { score?: unknown } | undefined> | undefined)?.[ability]?.score;
  return typeof score === 'number' ? score : null;
}

/** A Rage's Resistance to Bludgeoning, Piercing and Slashing damage, on top of what the creature has. */
function withRageResistance(defences: Defences | undefined): Defences {
  const resistances = new Set<DamageType>([...(defences?.resistances ?? []), ...RAGE_RESISTANCES]);
  return { ...(defences ?? {}), resistances: [...resistances] };
}

/** A token as the rules see it. */
/** Whether a token's barbarian is raging, by the combat state's marks. */
function isRaging(campaignId: string, tokenId: string): boolean {
  return getCombatState(campaignId).marks.some((mark) => mark.kind === 'rage' && mark.attackerId === tokenId);
}

const RAGE_RESISTANCES = ['bludgeoning', 'piercing', 'slashing'] as const;

function combatant(token: Token, sheet: Record<string, unknown> | null, dodging: readonly string[] = [], raging = false): Combatant {
  const block = (token.statBlock ?? null) as { ac?: unknown } | null;
  const sheetAc = sheet && typeof sheet.armorClass === 'number' ? sheet.armorClass : null;
  const blockAc = block && typeof block.ac === 'number' ? block.ac : null;
  const exhaustion = sheet && typeof sheet.exhaustionLevel === 'number' ? sheet.exhaustionLevel : undefined;
  const features = sheet ? readFeatures(sheet) : [];
  // A character's species gives its resistances; a stat block writes its own.
  const resisted = sheet ? speciesResistances(sheet) : [];
  const own = sheet
    ? resisted.length > 0
      ? { resistances: resisted }
      : undefined
    : defencesFromStatBlock((token.statBlock ?? {}) as Parameters<typeof defencesFromStatBlock>[0]);
  return {
    name: token.name,
    standing: standing(token),
    armorClass: sheet ? sheetAc : blockAc,
    hp: sheet ? extractCharacterHp(DND, sheet) : (token.hp ?? null),
    conditions: [...(token.conditions ?? []), ...(dodging.includes(token.id) ? [DODGING] : []), ...(raging ? [RAGING] : [])],
    exhaustion,
    scores: sheet ? { str: scoreOf(sheet, 'strength'), dex: scoreOf(sheet, 'dexterity') } : undefined,
    defences: raging ? withRageResistance(own) : own,
    ...(sheet && hasLuck(sheet) ? { lucky: true } : {}),
    ...(features.length > 0 && hasFeature(features, 'Danger Sense') ? { dangerSense: true } : {}),
    ...(features.length > 0 && hasFeature(features, 'Evasion') ? { evasion: true } : {}),
  };
}

/** The d20 and its modifier in the shape the dice log draws. */
function breakdownOf(result: AttackResult) {
  const { roll } = result.outcome;
  const notation = roll.mode === 'normal' ? '1d20' : roll.mode === 'advantage' ? '2d20kh1' : '2d20kl1';
  const sign = roll.modifier < 0 ? '-' : '+';
  const expression = `${notation}${sign}${Math.abs(roll.modifier)}`;
  return {
    expression,
    total: roll.total,
    breakdown: {
      expression,
      rolls: [
        { type: 'dice' as const, notation, count: roll.dice.length, sides: 20, results: roll.dice, kept: [roll.natural], total: roll.natural },
        { type: 'modifier' as const, value: roll.modifier },
      ],
      total: roll.total,
      formula: `[${roll.dice.join(', ')}] ${sign} ${Math.abs(roll.modifier)} = ${roll.total}`,
    },
  };
}

/** A player is told the same of a token that is hidden as of one that is not there. */
const hiddenFromPlayers = (token: Token) => token.visible === false || token.obscured === true;

/**
 * Take damage from each target's hit points, on its sheet or on its token, and
 * tell the table. A character whose species has Relentless Endurance left drops
 * to 1 instead of 0 when not killed outright; the lines that say so come back.
 */
async function applyDealt(
  io: Server,
  campaignId: string,
  mapId: string,
  hits: ReadonlyArray<{ token: Token; sheet: Record<string, unknown> | null; dealt: number; hp: HitPoints | null; critical?: boolean }>
): Promise<string[]> {
  const notes: string[] = [];
  const onTokens = new Map<string, HitPoints>();
  // Where each damaged creature's Hit Points end up, for its concentration.
  const after: Array<{ token: Token; sheet: Record<string, unknown> | null; dealt: number; current: number }> = [];
  for (const hit of hits) {
    if (hit.dealt <= 0) continue;
    const characterId = hit.token.characterId;
    if (characterId && hit.sheet) {
      const applied = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
        const fresh = await tx.character.findUnique({ where: { id: characterId }, select: { data: true } });
        if (!fresh) return null;
        const change = applyHpDelta(DND, fresh.data, -hit.dealt);
        if ('error' in change) return null;
        const sheet = (fresh.data ?? {}) as Record<string, unknown>;
        const held = extractCharacterHp(DND, sheet);
        const before = held?.current ?? 0;
        // Relentless Endurance: down to 0 but not killed outright, the Orc stays at 1, once until a Long Rest.
        const relentless = resourcesOf(sheet).find((entry) => entry.name === 'Relentless Endurance');
        const endured =
          held && relentless && relentless.used < relentless.max ? endure(held, hit.dealt, change.hp.current) : null;
        if (endured !== null) {
          const spent = spendResource(sheet, 'Relentless Endurance');
          const kept = { ...(spent.ok ? spent.sheet : sheet), hp: { ...(change.data.hp as object), current: endured } };
          const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(kept) } });
          return { hp: { ...change.hp, current: endured }, sheetChanged: updated, endured: true };
        }
        // Damage at 0 Hit Points is a failed death save; dropping to 0 starts them afresh.
        const saves = deathSavesAfterDamage(readDeathSaves(sheet.deathSaves), before, change.hp.current, hit.critical === true);
        const data = saves ? { ...change.data, deathSaves: saves } : change.data;
        const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(data) } });
        return { hp: change.hp, sheetChanged: saves ? updated : null, endured: false };
      });
      if (applied) io.to(campaignId).emit('character.hp.updated', { characterId, hp: applied.hp });
      if (applied?.endured) notes.push(`${hit.token.name} endures (Relentless Endurance): 1 Hit Point`);
      if (applied) after.push({ token: hit.token, sheet: hit.sheet, dealt: hit.dealt, current: applied.hp.current });
      if (applied?.sheetChanged) {
        const changed = applied.sheetChanged;
        await bestEffort('sheet after a failed death save', () =>
          emitCharacterUpdated(campaignId, changed, { characterId, userId: changed.userId, tokensChanged: false })
        );
      }
    } else if (hit.hp) {
      onTokens.set(hit.token.id, hit.hp);
      after.push({ token: hit.token, sheet: hit.sheet, dealt: hit.dealt, current: hit.hp.current });
    }
  }
  notes.push(...keepConcentration(campaignId, after));
  if (onTokens.size === 0) return notes;
  const updated = await withMapsLocked([mapId], async (tx) => {
    const fresh = await tx.map.findUnique({ where: { id: mapId } });
    if (!fresh) return null;
    const list = readTokens(fresh.tokens);
    let changed = false;
    for (const token of list) {
      const hp = onTokens.get(token.id);
      if (!hp) continue;
      token.hp = hp;
      changed = true;
    }
    return changed ? tx.map.update({ where: { id: mapId }, data: { tokens: toJson(list) } }) : null;
  });
  if (updated) {
    await bestEffort('map after damage', () => broadcastMapData(io, campaignId, updated as unknown as Parameters<typeof broadcastMapData>[2]));
  }
  return notes;
}

/** Put a condition on a token of the map, if it does not carry it already, and tell the table. */
async function giveCondition(io: Server, campaignId: string, mapId: string, tokenId: string, condition: string): Promise<void> {
  const updated = await withMapsLocked([mapId], async (tx) => {
    const fresh = await tx.map.findUnique({ where: { id: mapId } });
    if (!fresh) return null;
    const list = readTokens(fresh.tokens);
    const token = list.find((t) => t.id === tokenId);
    const carried = token?.conditions ?? [];
    if (!token || carried.some((name) => name.toLowerCase() === condition.toLowerCase())) return null;
    token.conditions = [...carried, condition];
    return tx.map.update({ where: { id: mapId }, data: { tokens: toJson(list) } });
  });
  if (updated) {
    await bestEffort('map after a condition', () => broadcastMapData(io, campaignId, updated as unknown as Parameters<typeof broadcastMapData>[2]));
  }
}

/** Move a shoved token one square straight away from the one that shoved it. False when the board's edge leaves it where it is. */
async function pushToken(
  io: Server,
  campaignId: string,
  map: { id: string; width: number; height: number },
  pusher: Token,
  target: Token,
  squares = 1
): Promise<boolean> {
  const size = (token: Token) => ({ width: token.size?.width ?? 1, height: token.size?.height ?? 1 });
  let to = { ...target.position };
  for (let step = 0; step < squares; step++) {
    to = pushedTo({ ...pusher.position, ...size(pusher) }, { ...to, ...size(target) }, { cols: map.width, rows: map.height });
  }
  if (to.x === target.position.x && to.y === target.position.y) return false;
  const updated = await withMapsLocked([map.id], async (tx) => {
    const fresh = await tx.map.findUnique({ where: { id: map.id } });
    if (!fresh) return null;
    const list = readTokens(fresh.tokens);
    const token = list.find((t) => t.id === target.id);
    if (!token) return null;
    token.position = to;
    return tx.map.update({ where: { id: map.id }, data: { tokens: toJson(list) } });
  });
  if (!updated) return false;
  await bestEffort('map after a shove', () => broadcastMapData(io, campaignId, updated as unknown as Parameters<typeof broadcastMapData>[2]));
  return true;
}

/**
 * What the attack's weapon mastery does, for a character whose sheet marks
 * the weapon as one it uses and lists Weapon Mastery among its features:
 * Topple, Push and Graze are applied here. Answers a line for the log, or
 * null when nothing happened.
 */
async function applyMastery(
  io: Server,
  campaignId: string,
  map: { id: string; width: number; height: number; feetPerSquare: number },
  action: CombatAction,
  attackerToken: Token,
  attackerSheet: Record<string, unknown> | null,
  targetToken: Token,
  targetSheet: Record<string, unknown> | null,
  result: { outcome: { hit: boolean }; dealt: number },
  defences: Defences | undefined
): Promise<string | null> {
  if (!action.mastery || !action.weapon || !attackerSheet || !hasWeaponMastery(readFeatures(attackerSheet))) return null;
  const modifier = weaponModifier(action.weapon, {
    str: abilityModifierOf(attackerToken, attackerSheet, 'str') ?? 0,
    dex: abilityModifierOf(attackerToken, attackerSheet, 'dex') ?? 0,
  });
  const effect = masteryEffect(
    action.mastery,
    { hit: result.outcome.hit, dealt: result.dealt },
    { modifier, proficiencyBonus: proficiencyBonusOf(attackerToken, attackerSheet) },
    { squares: targetToken.size?.width ?? 1 },
    action.weapon,
    map.feetPerSquare
  );
  if (!effect) return null;
  if (effect.kind === 'topple') {
    const bonus = saveBonusOf(targetToken, targetSheet, 'con') ?? 0;
    const state = readConditions(targetToken.conditions ?? []);
    const modifiers = saveModifiers(state, 'con');
    const save = savingThrow({ bonus: bonus + modifiers.penalty, dc: effect.dc, mode: modifiers.mode, autoFail: modifiers.autoFail });
    const rolled = save.roll ? `${save.roll.total}` : 'no roll';
    if (save.success) return `Topple: ${targetToken.name} saves (Constitution ${rolled} vs DC ${effect.dc})`;
    await giveCondition(io, campaignId, map.id, targetToken.id, 'Prone');
    return `Topple: ${targetToken.name} fails (Constitution ${rolled} vs DC ${effect.dc}) and is Prone`;
  }
  if (effect.kind === 'mark') {
    addMark(campaignId, { kind: effect.mark, attackerId: attackerToken.id, targetId: targetToken.id });
    return effect.mark === 'sap'
      ? `Sap: ${targetToken.name} has Disadvantage on its next attack roll`
      : effect.mark === 'slow'
        ? `Slow: ${targetToken.name}'s Speed is 10 ft less`
        : `Vex: ${attackerToken.name} has Advantage on its next attack roll against ${targetToken.name}`;
  }
    if (effect.kind === 'push') {
    const moved = await pushToken(io, campaignId, map, attackerToken, targetToken, effect.squares);
    return moved ? `Push: ${targetToken.name} is pushed ${effect.squares * map.feetPerSquare} ft` : `Push: ${targetToken.name} has nowhere to be pushed`;
  }
  const type = (DAMAGE_TYPES as readonly string[]).includes(effect.type) ? (effect.type as DamageType) : null;
  const dealt = type ? adjustedDamage({ amount: effect.damage, type }, defences ?? {}) : effect.damage;
  if (dealt <= 0) return `Graze: ${targetToken.name} takes no damage`;
  const hp = targetSheet ? null : targetToken.hp ? applyDamage(targetToken.hp, [{ amount: dealt, type: 'force' }]).hp : null;
  await applyDealt(io, campaignId, map.id, [{ token: targetToken, sheet: targetSheet, dealt, hp }]);
  return `Graze: ${targetToken.name} takes ${dealt} ${effect.type} damage`;
}

/**
 * Keep a lasting mastery in the fight. A Vex made on the attacker's own turn
 * runs to the end of its next one; one made off its turn, to the end of the
 * coming one. A creature is Slowed by one weapon at most, and a new mark of a
 * kind replaces the attacker's old one on the same target. The table hears of
 * it with the next send of the combat state.
 */
function addMark(campaignId: string, mark: { kind: WeaponMark['kind']; attackerId: string; targetId: string }): void {
  const combat = getCombatState(campaignId);
  if (!combat.active) return;
  const own = combat.currentTokenId === mark.attackerId;
  const others = combat.marks.filter(
    (kept) =>
      !(kept.kind === mark.kind && kept.targetId === mark.targetId && (mark.kind === 'slow' || kept.attackerId === mark.attackerId))
  );
  combat.marks = [...others, { ...mark, turnEndsLeft: (mark.kind === 'vex' || mark.kind === 'rage') && own ? 2 : 1 }];
  setCombatState(campaignId, combat);
}

/** An attack on the barbarian's own turn keeps its Rage going to the end of its next turn. */
function keepRaging(campaignId: string, tokenId: string): void {
  const combat = getCombatState(campaignId);
  combat.marks = combat.marks.map((mark) => (mark.kind === 'rage' && mark.attackerId === tokenId ? { ...mark, turnEndsLeft: 2 } : mark));
  setCombatState(campaignId, combat);
}

/** Whether an attack uses Strength: an Unarmed Strike, or a melee weapon attack that is not made with Dexterity. */
function usesStrength(action: CombatAction, token: Token, sheet: Record<string, unknown>): boolean {
  if (action.unarmed === 'damage') return true;
  if (action.attack?.kind !== 'melee' || action.source === 'spell') return false;
  if (!action.weapon) return true;
  const str = abilityModifierOf(token, sheet, 'str') ?? 0;
  const dex = abilityModifierOf(token, sheet, 'dex') ?? 0;
  // A Finesse weapon uses the better of the two: a Strength attack when Strength is that one.
  return weaponModifier(action.weapon, { str, dex }) === str;
}

/** The marks an attack roll used: they go. */
function useMarks(campaignId: string, used: ReadonlyArray<WeaponMark | undefined>): void {
  const combat = getCombatState(campaignId);
  combat.marks = combat.marks.filter((mark) => !used.some((gone) => gone && gone.kind === mark.kind && gone.attackerId === mark.attackerId && gone.targetId === mark.targetId));
  setCombatState(campaignId, combat);
}

/** Take a condition off a token of the map, and tell the table. */
async function takeCondition(io: Server, campaignId: string, mapId: string, tokenId: string, condition: string): Promise<void> {
  const updated = await withMapsLocked([mapId], async (tx) => {
    const fresh = await tx.map.findUnique({ where: { id: mapId } });
    if (!fresh) return null;
    const list = readTokens(fresh.tokens);
    const token = list.find((t) => t.id === tokenId);
    const kept = (token?.conditions ?? []).filter((name) => name.toLowerCase() !== condition.toLowerCase());
    if (!token || kept.length === (token.conditions ?? []).length) return null;
    token.conditions = kept;
    return tx.map.update({ where: { id: mapId }, data: { tokens: toJson(list) } });
  });
  if (updated) {
    await bestEffort('map after a condition', () => broadcastMapData(io, campaignId, updated as unknown as Parameters<typeof broadcastMapData>[2]));
  }
}

/**
 * Spend one spell slot of `level` on a character's sheet and tell the table.
 * False when the sheet has none left there by the time it is asked, which a
 * second cast sent at the same moment can bring about.
 */
async function spendSlot(campaignId: string, userId: string, characterId: string, level: number): Promise<boolean> {
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
    const fresh = await tx.character.findUnique({ where: { id: characterId } });
    const spent = fresh ? withSlotSpent((fresh.data ?? {}) as SheetSpellcasting, level) : null;
    if (!spent) return null;
    return tx.character.update({ where: { id: characterId }, data: { data: toJson(spent) } });
  });
  if (!updated) return false;
  await bestEffort('sheet after a spell slot was spent', () =>
    emitCharacterUpdated(campaignId, updated, { characterId, userId, tokensChanged: false })
  );
  return true;
}

/** On its own turn, what a combatant just did is its action, if it had not taken one. */
async function spendAction(io: Server, campaignId: string, tokenId: string, name: string, countsAsAttack = false): Promise<void> {
  const combat = getCombatState(campaignId);
  if (someoneActing(combat) && combat.currentTokenId === tokenId && combat.turn) {
    const turn = combat.turn;
    const action = turn.action ?? name;
    // An attack counts towards the Attack action's attacks only while that is the action taken.
    const attacks = countsAsAttack && action === 'Attack' ? turn.attacks + 1 : turn.attacks;
    if (action !== turn.action || attacks !== turn.attacks) {
      combat.turn = { ...turn, action, attacks };
      setCombatState(campaignId, combat);
    }
  }
  await resendInitiativeState(io, campaignId);
}

/** On its own turn, the combatant's Bonus Action is spent. */
function spendBonusAction(campaignId: string, tokenId: string): void {
  const now = getCombatState(campaignId);
  if (someoneActing(now) && now.currentTokenId === tokenId && now.turn) {
    now.turn = { ...now.turn, bonusAction: true };
    setCombatState(campaignId, now);
  }
}

/**
 * A class feature taken as a Bonus Action that changes the turn: Cunning
 * Action's Dash or Disengage, a Monk's Flurry of Blows, Patient Defense or
 * Step of the Wind, with the Focus Point it costs. On the creature's own turn,
 * with its Bonus Action left.
 */
async function takeTurnFeature(
  io: Server,
  campaignId: string,
  token: Token,
  characterId: string,
  feature: TurnFeature,
  options: { as?: 'Dash' | 'Disengage'; focus?: true },
  ownTurn: boolean
): Promise<{ summary: string; left: number } | { refusal: string }> {
  if (!ownTurn) return { refusal: `${feature} is a Bonus Action on the creature’s own turn` };
  const effect = turnFeatureEffect(feature, options);
  if ('refusal' in effect) return effect;
  let left = 0;
  const spent = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
    const fresh = await tx.character.findUnique({ where: { id: characterId } });
    const sheet = (fresh?.data ?? {}) as Record<string, unknown>;
    if (!fresh || !hasTurnFeature(sheet, feature)) return { refusal: `${token.name} has no ${feature}` };
    if (effect.focus === 0) return { updated: null };
    const result = spendResource(sheet, 'Focus Points', effect.focus);
    if (!result.ok) return { refusal: `${token.name}: ${result.reason}` };
    left = result.left;
    return { updated: await tx.character.update({ where: { id: characterId }, data: { data: toJson(result.sheet) } }) };
  });
  if ('refusal' in spent) return { refusal: spent.refusal! };
  if (spent.updated) {
    const updated = spent.updated;
    await bestEffort('sheet after a Focus Point', () =>
      emitCharacterUpdated(campaignId, updated, { characterId, userId: updated.userId, tokensChanged: false })
    );
  }
  const combat = getCombatState(campaignId);
  if (combat.turn) {
    combat.turn = {
      ...combat.turn,
      bonusAction: true,
      dashes: combat.turn.dashes + (effect.dash ? 1 : 0),
      ...(effect.disengage ? { disengaged: true } : {}),
    };
  }
  if (effect.dodge) combat.dodging = [...combat.dodging.filter((id) => id !== token.id), token.id];
  setCombatState(campaignId, combat);
  if (effect.strikes > 0) turnAttacksOf(campaignId)?.flurry.set(token.id, effect.strikes);
  await resendInitiativeState(io, campaignId);
  const did = [
    ...(effect.dash ? ['Dash'] : []),
    ...(effect.disengage ? ['Disengage'] : []),
    ...(effect.dodge ? ['Dodge'] : []),
    ...(effect.strikes > 0 ? [`${effect.strikes} Unarmed Strikes`] : []),
  ].join(' and ');
  const cost = effect.focus > 0 ? ` (1 Focus Point, ${left} left)` : '';
  return { summary: `${token.name} uses ${feature}: ${did}${cost}`, left };
}

/**
 * Lay on Hands: the paladin touches a creature within 5 feet (or itself) and
 * restores Hit Points from its pool, as many as `amount` but no more than the
 * creature is missing, or spends 5 points to end its Poisoned condition.
 */
async function layOnHands(
  io: Server,
  socket: AuthenticatedSocket,
  campaignId: string,
  map: { id: string; tokens: Parameters<typeof readTokens>[0]; tileHeights: Parameters<typeof readTileHeights>[0]; feetPerSquare: number; diagonalRule: string },
  paladin: Token,
  targetId: string,
  amount: number | undefined,
  curePoison: boolean
): Promise<{ summary: string; left: number } | { refusal: string }> {
  const target = readTokens(map.tokens).find((t) => t.id === targetId);
  if (!target || target.layer !== paladin.layer || (socket.role !== 'DM' && hiddenFromPlayers(target))) {
    return { refusal: 'That creature is not on the map' };
  }
  const board = {
    heights: readTileHeights(map.tileHeights),
    feetPerSquare: map.feetPerSquare,
    diagonalRule: map.diagonalRule === 'alternating' ? ('alternating' as const) : ('flat' as const),
  };
  if (target.id !== paladin.id && distanceFeet(standing(paladin), standing(target), board) > 5) {
    return { refusal: `${target.name} is beyond the reach of a touch` };
  }
  const targetSheet = await sheetOf(target, campaignId);
  let cost: number;
  if (curePoison) {
    if (!(target.conditions ?? []).some((name) => name.toLowerCase() === 'poisoned')) return { refusal: `${target.name} is not Poisoned` };
    cost = 5;
  } else {
    const hp = targetSheet ? extractCharacterHp(DND, targetSheet) : target.hp ?? null;
    if (!hp) return { refusal: `${target.name} tracks no Hit Points` };
    const missing = Math.max(0, hp.max - hp.current);
    if (missing === 0) return { refusal: `${target.name} is at its Hit Point maximum` };
    cost = Math.min(amount ?? missing, missing);
  }

  const characterId = paladin.characterId!;
  const spent = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
    const fresh = await tx.character.findUnique({ where: { id: characterId } });
    if (!fresh) return { refusal: `${paladin.name} has no D&D character sheet` };
    const result = spendResource((fresh.data ?? {}) as Record<string, unknown>, 'Lay on Hands', cost);
    if (!result.ok) return { refusal: `${paladin.name}: ${result.reason}` };
    const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(result.sheet) } });
    return { updated, left: result.left };
  });
  if ('refusal' in spent) return { refusal: spent.refusal! };
  await bestEffort('sheet after Lay on Hands', () =>
    emitCharacterUpdated(campaignId, spent.updated, { characterId, userId: spent.updated.userId, tokensChanged: false })
  );

  if (curePoison) {
    await takeCondition(io, campaignId, map.id, target.id, 'Poisoned');
    return { summary: `${paladin.name} uses Lay on Hands: ${target.name} is no longer Poisoned (${spent.left} left)`, left: spent.left };
  }
  await healToken(io, campaignId, map.id, target, cost);
  return { summary: `${paladin.name} uses Lay on Hands: ${target.name} regains ${cost} Hit Points (${spent.left} left)`, left: spent.left };
}

/** Give Hit Points back to a creature, on its sheet or on its token; a character healed from 0 starts its death saves afresh. */
async function healToken(io: Server, campaignId: string, mapId: string, token: Token, amount: number): Promise<void> {
  const characterId = token.characterId;
  if (characterId) {
    const healed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
      const fresh = await tx.character.findUnique({ where: { id: characterId }, select: { data: true } });
      if (!fresh) return null;
      const change = applyHpDelta(DND, fresh.data, amount);
      if ('error' in change) return null;
      const before = extractCharacterHp(DND, (fresh.data ?? {}) as Record<string, unknown>)?.current ?? 1;
      const data = before <= 0 ? { ...change.data, deathSaves: { successes: 0, failures: 0 } } : change.data;
      const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(data) } });
      return { hp: change.hp, updated };
    });
    if (healed) {
      io.to(campaignId).emit('character.hp.updated', { characterId, hp: healed.hp });
      await bestEffort('sheet after healing', () =>
        emitCharacterUpdated(campaignId, healed.updated, { characterId, userId: healed.updated.userId, tokensChanged: false })
      );
    }
    return;
  }
  const updated = await withMapsLocked([mapId], async (tx) => {
    const fresh = await tx.map.findUnique({ where: { id: mapId } });
    if (!fresh) return null;
    const list = readTokens(fresh.tokens);
    const found = list.find((t) => t.id === token.id);
    if (!found?.hp) return null;
    found.hp = { ...found.hp, current: Math.min(found.hp.max, found.hp.current + amount) };
    return tx.map.update({ where: { id: mapId }, data: { tokens: toJson(list) } });
  });
  if (updated) {
    await bestEffort('map after healing', () => broadcastMapData(io, campaignId, updated as unknown as Parameters<typeof broadcastMapData>[2]));
  }
}

/**
 * Give a creature the conditions an action's text gives it, those its size
 * allows, and say so for the log: "Ogre has the Grappled condition".
 */
async function applyRiders(
  io: Server,
  campaignId: string,
  mapId: string,
  source: Token,
  target: Token,
  riders: ConditionRider[],
  repeat?: { ability: Ability; dc: number }
): Promise<string[]> {
  const size = sizeOfSquares(Math.max(target.size?.width ?? 1, target.size?.height ?? 1));
  const lines: string[] = [];
  for (const rider of riders.filter((entry) => fits(entry, size))) {
    await giveCondition(io, campaignId, mapId, target.id, rider.condition);
    // A condition tied to a turn is kept as a mark, and taken off when that turn starts or ends.
    const limit = turnLimit(rider);
    const combat = getCombatState(campaignId);
    if (!limit && rider.repeats && repeat && combat.active) {
      // Saved against again at the end of each of the target's turns.
      combat.marks = [
        ...combat.marks.filter((mark) => !(mark.kind === 'condition' && mark.targetId === target.id && mark.condition === rider.condition)),
        { kind: 'condition', attackerId: target.id, targetId: target.id, condition: rider.condition, ends: 'save', save: repeat, turnEndsLeft: 1 },
      ];
      setCombatState(campaignId, combat);
    } else if (limit && combat.active) {
      const whose = limit.whose === 'source' ? source.id : target.id;
      const others = combat.marks.filter(
        (mark) => !(mark.kind === 'condition' && mark.targetId === target.id && mark.condition === rider.condition)
      );
      const ownTurn = combat.currentTokenId === whose;
      combat.marks = [
        ...others,
        { kind: 'condition', attackerId: whose, targetId: target.id, condition: rider.condition, ends: limit.ends, turnEndsLeft: limit.ends === 'end' && ownTurn ? 2 : 1 },
      ];
      setCombatState(campaignId, combat);
    }
    lines.push(`${target.name} has the ${rider.condition} condition${rider.until ? ` until the ${rider.until}` : ''}`);
  }
  return lines;
}

/** The log line for a class feature the server counts and the table applies. */
function featureSummary(name: string, feature: string, sheet: Record<string, unknown>, amount: number, left: number): string {
  const uses = `${left} ${left === 1 ? 'use' : 'uses'} left`;
  switch (feature) {
    case 'Bardic Inspiration':
      return `${name} uses Bardic Inspiration: a creature within 60 feet gains a ${bardicDie(sheet) ?? 'd6'} Bardic Inspiration die (${uses})`;
    case 'Channel Divinity':
      return `${name} uses Channel Divinity (${uses})`;
    case 'Wild Shape':
      return `${name} uses Wild Shape (${uses})`;
    case 'Favored Enemy':
      return `${name} casts Hunter's Mark without a spell slot (${uses})`;
    default:
      return `${name} spends ${amount} ${feature === 'Focus Points' ? 'Focus' : 'Sorcery'} ${amount === 1 ? 'Point' : 'Points'} (${left} left)`;
  }
}

/** The attack each token has readied, by campaign: which of its actions, against whom, and for what trigger. */
const readiedAttacks = new Map<string, Map<string, { targetId: string; action: number; name: string; trigger: string }>>();

/** Who has used Savage Attacker on the current turn of each campaign's combat. */
const savageAttacks = new Map<string, { turn: string; tokens: Set<string> }>();

function savageUsed(campaignId: string, tokenId: string): boolean {
  const turn = sneakTurnOf(campaignId);
  const used = savageAttacks.get(campaignId);
  return turn !== null && used?.turn === turn && used.tokens.has(tokenId);
}

function useSavage(campaignId: string, tokenId: string): void {
  const turn = sneakTurnOf(campaignId);
  if (turn === null) return;
  const used = savageAttacks.get(campaignId);
  if (used?.turn === turn) used.tokens.add(tokenId);
  else savageAttacks.set(campaignId, { turn, tokens: new Set([tokenId]) });
}

/** What each attacker has done this turn that a weapon's extra attack follows from. */
interface TurnAttacks {
  turn: string;
  /** Hits with a weapon whose Cleave mastery the attacker uses. */
  cleaveHits: Array<{ attackerId: string; targetId: string }>;
  /** The Light weapons each attacker has attacked with, and whether one has Nick. */
  lightWeapons: Map<string, Array<{ name: string; nick: boolean }>>;
  cleaved: Set<string>;
  lightExtra: Set<string>;
  /** The Unarmed Strikes each Monk has left from Flurry of Blows this turn. */
  flurry: Map<string, number>;
}
const turnAttacks = new Map<string, TurnAttacks>();

/** This turn's record for a campaign, fresh when the turn has moved on; null outside combat. */
function turnAttacksOf(campaignId: string): TurnAttacks | null {
  const turn = sneakTurnOf(campaignId);
  if (turn === null) return null;
  const kept = turnAttacks.get(campaignId);
  if (kept?.turn === turn) return kept;
  const fresh: TurnAttacks = { turn, cleaveHits: [], lightWeapons: new Map(), cleaved: new Set(), lightExtra: new Set(), flurry: new Map() };
  turnAttacks.set(campaignId, fresh);
  return fresh;
}

/** The ability modifier a weapon attack adds to its damage: Strength, Dexterity at range, the better for Finesse. */
function attackAbilityModifier(action: CombatAction, token: Token, sheet: Record<string, unknown> | null): number {
  const str = abilityModifierOf(token, sheet, 'str') ?? 0;
  const dex = abilityModifierOf(token, sheet, 'dex') ?? 0;
  if (action.attack?.finesse) return Math.max(str, dex);
  return action.attack?.kind === 'ranged' ? dex : str;
}

/** The turn in each campaign whose Sneak Attacks have been dealt, and by whom: once on each turn. */
const sneakAttacks = new Map<string, { turn: string; tokens: Set<string> }>();

/** The turn a Sneak Attack now would be dealt on; null outside combat, where nothing counts turns. */
function sneakTurnOf(campaignId: string): string | null {
  const combat = getCombatState(campaignId);
  return combat.active ? `${turnSerial(campaignId)}` : null;
}

function sneakAttackUsed(campaignId: string, tokenId: string): boolean {
  const turn = sneakTurnOf(campaignId);
  const used = sneakAttacks.get(campaignId);
  return turn !== null && used?.turn === turn && used.tokens.has(tokenId);
}

function useSneakAttack(campaignId: string, tokenId: string): void {
  const turn = sneakTurnOf(campaignId);
  if (turn === null) return;
  const used = sneakAttacks.get(campaignId);
  if (used?.turn === turn) used.tokens.add(tokenId);
  else sneakAttacks.set(campaignId, { turn, tokens: new Set([tokenId]) });
}

/** The turn each campaign's last Action Surge was used in: once a turn. */
const actionSurges = new Map<string, { tokenId: string; round: number }>();

/** A combatant's reaction is spent; what it was offered to spend it on goes with it. */
async function spendReaction(io: Server, campaignId: string, tokenId: string): Promise<void> {
  const combat = getCombatState(campaignId);
  if (combat.active && combat.combatants.some((c) => c.tokenId === tokenId)) {
    combat.reactionsSpent = [...combat.reactionsSpent.filter((id) => id !== tokenId), tokenId];
    setCombatState(campaignId, combat);
  }
  await resendInitiativeState(io, campaignId);
}

/**
 * After the acting combatant has moved on its own turn: offer an Opportunity
 * Attack to each combatant on the other side whose reach it has left, that
 * can see it, can act, has its reaction and has a melee attack to make. A
 * creature that took the Disengage action provokes none. `from` is where the
 * mover stood; `tokens` are the map's tokens after the move.
 */
export async function offerOpportunityAttacks(
  io: Server,
  campaignId: string,
  map: {
    id: string;
    tileHeights: unknown;
    feetPerSquare: number;
    diagonalRule: string;
    lightingEnabled?: boolean;
    wallSegments?: unknown;
    lights?: unknown;
    width?: number;
    height?: number;
    gridSize?: number;
    globalIllumination?: boolean;
  },
  tokens: Token[],
  moverId: string,
  from: { x: number; y: number }
): Promise<void> {
  const before = getCombatState(campaignId);
  if (!someoneActing(before) || before.currentTokenId !== moverId || before.turn?.action === 'Disengage' || before.turn?.disengaged) return;
  const mover = tokens.find((t) => t.id === moverId);
  const moverSide = mover ? sideOf({ type: mover.type ?? 'npc', disposition: mover.disposition ?? null }) : null;
  if (!mover || !moverSide || readConditions(mover.conditions ?? []).has.has('invisible')) return;

  const candidates = before.combatants
    .filter((c) => c.tokenId !== moverId && c.mapId === map.id && !before.reactionsSpent.includes(c.tokenId))
    .map((c) => tokens.find((t) => t.id === c.tokenId))
    .filter((token): token is Token => {
      if (!token || token.layer !== mover.layer) return false;
      const side = sideOf({ type: token.type ?? 'npc', disposition: token.disposition ?? null });
      const state = readConditions(token.conditions ?? []);
      // A player's creature cannot see a token hidden from the players.
      // In the dark, a creature that cannot see the mover where it ends up is offered nothing.
      const dark =
        map.lightingEnabled === true &&
        map.width !== undefined &&
        map.height !== undefined &&
        map.gridSize !== undefined &&
        !creatureSees(token, mover, {
          wallSegments: map.wallSegments,
          lights: map.lights,
          width: map.width,
          height: map.height,
          gridSize: map.gridSize,
          globalIllumination: map.globalIllumination ?? false,
        });
      const unseen = dark || state.has.has('blinded') || (side === 'party' && hiddenFromPlayers(mover));
      return side !== null && side !== moverSide && canAct(state) && !unseen && !(token.hp && token.hp.current <= 0);
    });
  if (candidates.length === 0) return;

  const sheets = await Promise.all(candidates.map((token) => sheetOf(token, campaignId)));
  const bystanders = candidates.flatMap((token, index) => {
    const sheet = sheets[index];
    if (sheet && (extractCharacterHp(DND, sheet)?.current ?? 1) <= 0) return [];
    const reaches = actionsOf(token, sheet)
      .filter((action) => action.source !== 'spell' && action.attack?.kind === 'melee')
      .map((action) => action.attack?.reachFeet ?? 5);
    return reaches.length > 0 ? [{ id: token.id, standing: standing(token), reachFeet: Math.max(...reaches) }] : [];
  });
  const board = {
    heights: readTileHeights(map.tileHeights),
    feetPerSquare: map.feetPerSquare,
    diagonalRule: map.diagonalRule === 'alternating' ? ('alternating' as const) : ('flat' as const),
  };
  const provoked = leavesReachOf(standing({ ...mover, position: from }), standing(mover), bystanders, board);
  if (provoked.length === 0) return;

  // Read again after the awaits: the turn may have passed on, or a reaction been spent.
  const combat = getCombatState(campaignId);
  if (!someoneActing(combat) || combat.currentTokenId !== moverId || combat.turn?.action === 'Disengage' || combat.turn?.disengaged) return;
  const fresh = provoked.filter(
    (attackerId) => !combat.reactionsSpent.includes(attackerId) && !combat.opportunities.some((o) => o.attackerId === attackerId)
  );
  if (fresh.length === 0) return;
  combat.opportunities = [...combat.opportunities, ...fresh.map((attackerId) => ({ attackerId, targetId: moverId, from }))];
  setCombatState(campaignId, combat);
  await resendInitiativeState(io, campaignId);
}

interface LoggedRoll {
  expression: string;
  total: number;
  breakdown: unknown;
}

/** Put a roll the server made in the dice log, for the table or for the DM alone. */
async function logRoll(
  io: Server,
  socket: AuthenticatedSocket,
  campaignId: string,
  rolled: LoggedRoll,
  characterName: string,
  purpose: string,
  secret: boolean
): Promise<void> {
  const userId = socket.userId;
  if (!userId) return;
  await bestEffort('combat roll in the dice log', async () => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
    const stored = await prisma.diceRoll.create({
      data: {
        campaignId,
        userId,
        expression: rolled.expression,
        result: rolled.total,
        breakdown: toJson(rolled.breakdown),
        characterName,
        purpose: purpose.slice(0, 200),
        secret,
      },
    });
    const rollData = {
      id: stored.id,
      userId,
      userName: user?.displayName ?? 'Unknown',
      characterName,
      expression: rolled.expression,
      result: rolled.total,
      breakdown: rolled.breakdown,
      purpose: stored.purpose,
      timestamp: stored.rolledAt.toISOString(),
      secret,
    };
    if (!secret) {
      io.to(campaignId).emit('dice.rolled', rollData);
      return;
    }
    for (const member of stillInCampaign(await campaignSockets(io, campaignId), campaignId)) {
      if ((member as unknown as AuthenticatedFields).role === 'DM') member.emit('dice.rolled', rollData);
    }
  });
}

/** What a creature adds to a save: its sheet's total, or its stat block's bonus, modifier or ability score. */
function saveBonusOf(token: Token, sheet: Record<string, unknown> | null, ability: Ability): number | null {
  const full = ABILITY_FULL[ability];
  if (sheet) {
    const saves = sheet.savingThrows as Record<string, { bonus?: unknown } | undefined> | undefined;
    const bonus = saves?.[full]?.bonus;
    return typeof bonus === 'number' ? bonus : null;
  }
  const block = token.statBlock as
    | { savingThrows?: Record<string, number>; attributeModifiers?: Record<string, number>; abilities?: Record<string, number> }
    | null
    | undefined;
  if (!block) return null;
  for (const [name, bonus] of Object.entries(block.savingThrows ?? {})) {
    const key = name.trim().toLowerCase();
    if ((key === ability || key === full) && typeof bonus === 'number') return bonus;
  }
  const modifier = block.attributeModifiers?.[ability];
  if (typeof modifier === 'number') return modifier;
  const score = block.abilities?.[ability];
  return typeof score === 'number' ? Math.floor((score - 10) / 2) : null;
}

/** A creature's ability modifier, from its sheet's stats or its stat block's scores. Null when neither gives one. */
function abilityModifierOf(token: Token, sheet: Record<string, unknown> | null, ability: Ability): number | null {
  if (sheet) {
    const stat = (sheet.stats as Record<string, { score?: unknown; modifier?: unknown } | undefined> | undefined)?.[ABILITY_FULL[ability]];
    if (typeof stat?.modifier === 'number') return stat.modifier;
    return typeof stat?.score === 'number' ? Math.floor((stat.score - 10) / 2) : null;
  }
  const block = token.statBlock as { attributeModifiers?: Record<string, number>; abilities?: Record<string, number> } | null | undefined;
  if (!block) return null;
  const modifier = block.attributeModifiers?.[ability];
  if (typeof modifier === 'number') return modifier;
  const score = block.abilities?.[ability];
  return typeof score === 'number' ? Math.floor((score - 10) / 2) : null;
}

/**
 * A creature's bonus to a skill: the total its sheet keeps, or the one its
 * stat block lists; without either, the modifier of the skill's ability.
 */
function skillBonusOf(token: Token, sheet: Record<string, unknown> | null, skill: SkillCheck): number | null {
  if (sheet) {
    const bonus = (sheet.skills as Record<string, { bonus?: unknown } | undefined> | undefined)?.[skill]?.bonus;
    if (typeof bonus === 'number') return bonus;
  } else {
    const listed = (token.statBlock as { skills?: Record<string, unknown> } | null | undefined)?.skills ?? {};
    const wanted = SKILL_CHECKS[skill].name.toLowerCase().replace(/\s+/g, '');
    for (const [name, bonus] of Object.entries(listed)) {
      if (name.toLowerCase().replace(/\s+/g, '') === wanted && typeof bonus === 'number') return bonus;
    }
  }
  return abilityModifierOf(token, sheet, SKILL_CHECKS[skill].ability);
}

const ABILITY_FULL: Readonly<Record<Ability, string>> = {
  str: 'strength',
  dex: 'dexterity',
  con: 'constitution',
  int: 'intelligence',
  wis: 'wisdom',
  cha: 'charisma',
};

/** The damage dice of a save effect in the shape the dice log draws. */
function saveBreakdown(result: SaveResult, action: CombatAction): LoggedRoll {
  const lines = result.damage.map((entry, index) => ({ rolled: entry.rolled, sides: action.save?.damage[index]?.roll.sides ?? 0 }));
  const total = lines.reduce((sum, line) => sum + line.rolled.total, 0);
  const notation = ({ rolled, sides }: (typeof lines)[number]) =>
    `${rolled.dice.length > 0 ? `${rolled.dice.length}d${sides}` : ''}${rolled.bonus ? `${rolled.bonus > 0 && rolled.dice.length > 0 ? '+' : ''}${rolled.bonus}` : ''}`;
  // An effect with no damage still has a line in the log: its DC.
  const expression = lines.length > 0 ? lines.map(notation).join('+') : `DC ${result.dc}`;
  return {
    expression,
    total,
    breakdown: {
      expression,
      rolls: lines.flatMap(({ rolled, sides }) => [
        ...(rolled.dice.length > 0
          ? [{ type: 'dice' as const, notation: `${rolled.dice.length}d${sides}`, count: rolled.dice.length, sides, results: rolled.dice, kept: rolled.dice, total: rolled.total - rolled.bonus }]
          : []),
        ...(rolled.bonus ? [{ type: 'modifier' as const, value: rolled.bonus }] : []),
      ]),
      total,
      formula: lines.length > 0 ? `${lines.map(({ rolled }) => `[${rolled.dice.join(', ')}]${rolled.bonus ? ` + ${rolled.bonus}` : ''}`).join(' + ')} = ${total}` : `DC ${result.dc}`,
    },
  };
}

/** The spell a creature concentrates on, or null. */
function concentrationOf(campaignId: string, tokenId: string): string | null {
  return getCombatState(campaignId).marks.find((mark) => mark.kind === 'concentration' && mark.attackerId === tokenId)?.action ?? null;
}

/** A creature concentrates on a spell, ending its concentration on any other. */
function startConcentration(campaignId: string, tokenId: string, spell: string): void {
  const combat = getCombatState(campaignId);
  if (!combat.active) return;
  combat.marks = [
    ...combat.marks.filter((mark) => !(mark.kind === 'concentration' && mark.attackerId === tokenId)),
    { kind: 'concentration', attackerId: tokenId, targetId: tokenId, action: spell, turnEndsLeft: 1 },
  ];
  setCombatState(campaignId, combat);
}

function endConcentration(campaignId: string, tokenId: string): void {
  const combat = getCombatState(campaignId);
  combat.marks = combat.marks.filter((mark) => !(mark.kind === 'concentration' && mark.attackerId === tokenId));
  setCombatState(campaignId, combat);
}

/**
 * A concentrating creature that takes damage makes a Constitution save
 * against DC 10 or half the damage, up to 30, and loses its concentration on
 * a failure, or at once at 0 Hit Points. The lines say what happened.
 */
function keepConcentration(
  campaignId: string,
  damaged: ReadonlyArray<{ token: Token; sheet: Record<string, unknown> | null; dealt: number; current: number }>
): string[] {
  const lines: string[] = [];
  for (const { token, sheet, dealt, current } of damaged) {
    const spell = concentrationOf(campaignId, token.id);
    if (!spell || dealt <= 0) continue;
    if (current <= 0) {
      endConcentration(campaignId, token.id);
      lines.push(`${token.name} loses concentration on ${spell} (0 Hit Points)`);
      continue;
    }
    const dc = concentrationDC(dealt);
    const modifiers = saveModifiers(readConditions(token.conditions ?? [], typeof sheet?.exhaustionLevel === 'number' ? sheet.exhaustionLevel : undefined), 'con');
    const outcome = savingThrow(
      { bonus: (saveBonusOf(token, sheet, 'con') ?? 0) + modifiers.penalty, dc, mode: modifiers.mode, autoFail: modifiers.autoFail },
      hasLuck(sheet) ? lucky(rollDie) : rollDie
    );
    const rolled = outcome.roll ? `${outcome.roll.total} vs DC ${dc}` : `DC ${dc}`;
    if (outcome.success) lines.push(`${token.name} keeps concentration on ${spell} (${rolled})`);
    else {
      endConcentration(campaignId, token.id);
      lines.push(`${token.name} loses concentration on ${spell} (${rolled})`);
    }
  }
  return lines;
}

/** The Legendary Actions a creature has taken since its last turn. */
function legendarySpent(campaignId: string, tokenId: string): number {
  return getCombatState(campaignId).marks.filter((mark) => mark.kind === 'legendary' && mark.attackerId === tokenId).length;
}

/**
 * Why a creature cannot take a Legendary Action now, or null. In a fight it
 * takes one after another creature's turn, not on its own, while it has uses
 * left this round; outside one nothing counts them.
 */
function legendaryRefusal(campaignId: string, token: Token): string | null {
  const combat = getCombatState(campaignId);
  if (!combat.active) return null;
  if (combat.currentTokenId === token.id) return `${token.name} takes Legendary Actions after another creature's turn, not on its own`;
  const max = legendaryUses(token.statBlock as Parameters<typeof legendaryUses>[0]);
  if (legendarySpent(campaignId, token.id) >= max) return `${token.name} has no Legendary Action uses left this round`;
  return null;
}

/** One Legendary Action taken: a use gone until the creature's turn starts. */
function spendLegendary(campaignId: string, tokenId: string): void {
  const combat = getCombatState(campaignId);
  if (!combat.active) return;
  combat.marks = [...combat.marks, { kind: 'legendary', attackerId: tokenId, targetId: tokenId, turnEndsLeft: 1 }];
  setCombatState(campaignId, combat);
}

/** The "(Recharge …)" actions a creature has spent in the fight, by name. */
function spentRecharges(campaignId: string, tokenId: string): string[] {
  return getCombatState(campaignId)
    .marks.filter((mark) => mark.kind === 'recharge' && mark.attackerId === tokenId && mark.action)
    .map((mark) => mark.action!);
}

/** A "(Recharge …)" action is spent once used, in a fight. */
function spendRecharge(campaignId: string, tokenId: string, action: CombatAction): void {
  const combat = getCombatState(campaignId);
  if (!action.recharge || !combat.active) return;
  combat.marks = [
    ...combat.marks.filter((mark) => !(mark.kind === 'recharge' && mark.attackerId === tokenId && mark.action === action.name)),
    { kind: 'recharge', attackerId: tokenId, targetId: tokenId, action: action.name, turnEndsLeft: 1 },
  ];
  setCombatState(campaignId, combat);
}

/** At the start of a creature's turn, a d6 for each action it has spent: one high enough gives it back. */
async function rechargeAtTurnStart(io: Server, socket: AuthenticatedSocket, campaignId: string, tokenId: string): Promise<void> {
  const combat = getCombatState(campaignId);
  const spent = combat.marks.filter((mark) => mark.kind === 'recharge' && mark.attackerId === tokenId && mark.action);
  if (spent.length === 0) return;
  const mapId = combat.combatants.find((entry) => entry.tokenId === tokenId)?.mapId;
  const map = mapId ? await prisma.map.findUnique({ where: { id: mapId } }) : null;
  const token = map ? readTokens(map.tokens).find((t) => t.id === tokenId) : undefined;
  if (!token) return;
  const actions = actionsOf(token, await sheetOf(token, campaignId));
  for (const mark of spent) {
    const min = actions.find((action) => action.name === mark.action)?.recharge ?? 7;
    const rolled = rollDie(6);
    const back = rolled >= min;
    if (back) {
      const now = getCombatState(campaignId);
      now.marks = now.marks.filter((kept) => !(kept.kind === 'recharge' && kept.attackerId === tokenId && kept.action === mark.action));
      setCombatState(campaignId, now);
    }
    const summary = `${token.name}'s ${mark.action} ${back ? 'recharges' : 'does not recharge'} (${rolled})`;
    await logRoll(
      io,
      socket,
      campaignId,
      {
        expression: '1d6',
        total: rolled,
        breakdown: {
          expression: '1d6',
          rolls: [{ type: 'dice' as const, notation: '1d6', count: 1, sides: 6, results: [rolled], kept: [rolled], total: rolled }],
          total: rolled,
          formula: `[${rolled}] = ${rolled}`,
        },
      },
      token.name,
      summary,
      hiddenFromPlayers(token)
    );
  }
}
onTurnStart(rechargeAtTurnStart);

/**
 * At the end of a creature's turn, the saves it repeats against conditions
 * that say so: rolled by the server, logged, and on a success the condition
 * comes off its token.
 */
async function repeatSavesAtTurnEnd(io: Server, socket: AuthenticatedSocket, campaignId: string, tokenId: string): Promise<void> {
  const combat = getCombatState(campaignId);
  const due = combat.marks.filter((mark) => mark.kind === 'condition' && mark.ends === 'save' && mark.targetId === tokenId && mark.save);
  if (due.length === 0) return;
  const mapId = combat.combatants.find((entry) => entry.tokenId === tokenId)?.mapId;
  const map = mapId ? await prisma.map.findUnique({ where: { id: mapId } }) : null;
  const token = map ? readTokens(map.tokens).find((t) => t.id === tokenId) : undefined;
  if (!map || !token) return;
  const sheet = await sheetOf(token, campaignId);
  for (const mark of due) {
    const ability = mark.save!.ability as Ability;
    const dc = mark.save!.dc;
    const modifiers = saveModifiers(readConditions(token.conditions ?? [], typeof sheet?.exhaustionLevel === 'number' ? sheet.exhaustionLevel : undefined), ability, {
      dangerSense: hasFeature(readFeatures(sheet), 'Danger Sense'),
    });
    const outcome = savingThrow(
      { bonus: (saveBonusOf(token, sheet, ability) ?? 0) + modifiers.penalty, dc, mode: modifiers.mode, autoFail: modifiers.autoFail },
      hasLuck(sheet) ? lucky(rollDie) : rollDie
    );
    const label = `${ABILITY_FULL[ability][0].toUpperCase()}${ABILITY_FULL[ability].slice(1)}`;
    const summary = `${token.name} repeats the ${label} save against ${mark.condition}: ${outcome.roll ? `${outcome.roll.total} vs DC ${dc}` : `fails (DC ${dc})`}${outcome.success ? `, success: no longer ${mark.condition}` : ', failure'}`;
    if (outcome.success) {
      await takeCondition(io, campaignId, map.id, tokenId, mark.condition!);
      const now = getCombatState(campaignId);
      now.marks = now.marks.filter((kept) => !(kept.kind === 'condition' && kept.targetId === tokenId && kept.condition === mark.condition));
      setCombatState(campaignId, now);
    }
    const roll = outcome.roll;
    if (roll) {
      const notation = roll.mode === 'normal' ? '1d20' : roll.mode === 'advantage' ? '2d20kh1' : '2d20kl1';
      const sign = roll.modifier < 0 ? '-' : '+';
      const expression = `${notation}${sign}${Math.abs(roll.modifier)}`;
      await logRoll(
        io,
        socket,
        campaignId,
        {
          expression,
          total: roll.total,
          breakdown: {
            expression,
            rolls: [
              { type: 'dice' as const, notation, count: roll.dice.length, sides: 20, results: roll.dice, kept: [roll.natural], total: roll.natural },
              { type: 'modifier' as const, value: roll.modifier },
            ],
            total: roll.total,
            formula: `[${roll.dice.join(', ')}] ${sign} ${Math.abs(roll.modifier)} = ${roll.total}`,
          },
        },
        token.name,
        summary,
        hiddenFromPlayers(token)
      );
    }
  }
}
onTurnEnd(repeatSavesAtTurnEnd);

export function registerCombatHandlers(io: Server, socket: AuthenticatedSocket): void {
  /** The campaign's current map with what an attack needs, or null. */
  async function currentMap(campaignId: string) {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { currentMapId: true, gameSystem: true } });
    // A campaign with no system set is flexible, and the D&D rules are the ones the engine has.
    if (!campaign?.currentMapId || (campaign.gameSystem !== null && campaign.gameSystem !== DND)) return null;
    const map = await prisma.map.findUnique({ where: { id: campaign.currentMapId } });
    return map && map.campaignId === campaignId ? map : null;
  }

  /**
   * COMBAT.ACTIONS — List the actions of a token on the current map: its character's attacks and spells or its stat block's actions, with what the server can roll for each (a Multiattack with the attacks it makes). Answered through the acknowledgement. The DM, or the player who controls the token.
   */
  socket.on('combat.actions', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      if (!withinCeiling(socket, 'combat.actions', ack)) return;
      const parsed = CombatActionsSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');

      const map = await currentMap(socket.campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const token = readTokens(map.tokens).find((t) => t.id === parsed.data.tokenId);
      if (!token || !canControlToken(socket.role, token.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      const sheet = await sheetOf(token, socket.campaignId);
      const slots = slotsLeft(sheet as SheetSpellcasting | null);
      const features = readFeatures(sheet);
      if (ack) {
        ack({
          ok: true,
          actions: actionsOf(token, sheet).map((action, index, all) => {
            const summary = summarizeAction(action, index, slots, spentRecharges(socket.campaignId!, token.id));
            const steps =
              action.source === 'statBlock' && (/^multiattack/i.test(action.name) || action.cost === 'legendary')
                ? multiattackSteps(action.text ?? '', all.map((entry) => entry.name))
                : null;
            const legendary =
              action.cost === 'legendary'
                ? { max: legendaryUses(token.statBlock as Parameters<typeof legendaryUses>[0]), used: legendarySpent(socket.campaignId!, token.id) }
                : null;
            return { ...summary, ...(steps ? { multiattack: steps } : {}), ...(legendary ? { legendary } : {}) };
          }),
          // A stat block's Multiattack says how many attacks it makes; a character's features do.
          attacksPerAction: sheet ? attacksPerAction(features) : null,
          features: featureOptions(features),
          // A Barbarian's Reckless Attack, offered with the first attack roll of its turn.
          reckless: sheet ? hasFeature(features, 'Reckless Attack') : false,
          // Divine Smite: the slot levels it could be cast with, when the sheet has it ready.
          divineSmite: sheet && hasDivineSmite(sheet as SheetSpellcasting) ? Object.keys(slots).map(Number) : [],
          // The class features it spends and gets back on a rest, with what is left.
          resources: sheet ? resourcesOf(sheet).map(({ name, max, used }) => ({ name, max, used })) : [],
          // The spell it concentrates on, and those it could.
          concentration: concentrationOf(socket.campaignId, token.id),
          concentrationSpells: sheet ? concentrationSpellsOf(sheet as SheetSpellcasting) : [],
          // What a creature notices without looking: 10 plus its Wisdom (Perception) bonus.
          passivePerception: (() => {
            const bonus = skillBonusOf(token, sheet, 'perception');
            return bonus === null ? null : passiveScore(bonus);
          })(),
        });
      }
    } catch (error) {
      logger.error('combat.actions failed', { err: error });
      refuseRequest(socket, ack, 'Failed to list actions');
    }
  });

  /**
   * COMBAT.ATTACK — Make one attack from a token against another on the current map: the server checks reach, range and cover, rolls against Armor Class with the conditions of both and, on a lit map, whether each can see the other (darkness it cannot see into gives the attacker Disadvantage, or the target's unseen attacker Advantage), with `extra` makes a weapon's Cleave or Light extra attack on the attacker's turn (no positive ability modifier to the damage, once a turn each), adds a Rogue's Sneak Attack dice once on each turn to a Finesse or Ranged weapon hit with Advantage or with an ally beside the target, applies the damage to the target's hit points and records the roll in the dice log. With `readied: true` it is the attack the attacker readied against this target with `combat.ready`, made with its reaction. With `smite: <slot level>` a Paladin with Divine Smite prepared adds it to a Melee weapon or Unarmed Strike hit on its own turn: 2d8 Radiant, 1d8 more a slot level above 1 and against a Fiend or Undead, doubled on a Critical Hit; the slot and the Bonus Action are spent only on a hit. With `reckless: true` (a Barbarian's Reckless Attack, with the first attack roll of its own turn) its attacks using Strength, and attacks against it, have Advantage until its next turn starts. With `opportunity: true` it is the Opportunity Attack the target's movement offered the attacker: one melee attack, with the attacker's reaction, against the target where it stood before it left reach. The DM, or the player who controls the attacker; a player may not target a hidden token.
   */
  socket.on('combat.attack', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.attack', ack)) return;
      const parsed = CombatAttackSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid attack');
      const { attackerId, targetId, mode, slotLevel, opportunity, extra, readied, legendary, reckless, smite } = parsed.data;
      if (extra && opportunity) return refuseRequest(socket, ack, 'An Opportunity Attack is not an extra attack');
      if (readied && (opportunity || extra)) return refuseRequest(socket, ack, 'A readied attack is made on its own');
      // A readied attack is the one readied: its action, against its target, while the mark lasts.
      const ready = readied ? readiedAttacks.get(campaignId)?.get(attackerId) : undefined;
      if (readied) {
        const marked = getCombatState(campaignId).marks.some((m) => m.kind === 'ready' && m.attackerId === attackerId && m.targetId === targetId);
        if (!ready || ready.targetId !== targetId || !marked) return refuseRequest(socket, ack, 'There is no attack readied against that creature');
        if (getCombatState(campaignId).reactionsSpent.includes(attackerId)) return refuseRequest(socket, ack, 'The attacker has used its reaction');
      }
      const actionIndex = ready ? ready.action : parsed.data.action;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const tokens = readTokens(map.tokens);
      const attackerToken = tokens.find((t) => t.id === attackerId);
      const targetToken = tokens.find((t) => t.id === targetId);
      if (!attackerToken || !canControlToken(socket.role, attackerToken.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only attack with your own token');
      }
      if (!targetToken || targetToken.layer !== attackerToken.layer || (socket.role !== 'DM' && hiddenFromPlayers(targetToken))) {
        return refuseRequest(socket, ack, 'That target is not on the map');
      }

      const [attackerSheet, targetSheet] = await Promise.all([sheetOf(attackerToken, campaignId), sheetOf(targetToken, campaignId)]);
      const listed = actionsOf(attackerToken, attackerSheet)[actionIndex];
      if (!listed) return refuseRequest(socket, ack, 'That action is not one the attacker has');
      if (listed.recharge && spentRecharges(campaignId, attackerId).includes(listed.name)) {
        return refuseRequest(socket, ack, `${attackerToken.name}'s ${listed.name} has not recharged`);
      }
      // A Legendary Action: the action itself, or the attack one of them makes ("makes one Tentacle attack").
      const legendaryTaken =
        listed.cost === 'legendary' ? listed : legendary !== undefined ? actionsOf(attackerToken, attackerSheet)[legendary] : undefined;
      if (legendary !== undefined && legendaryTaken?.cost !== 'legendary') return refuseRequest(socket, ack, 'That is not a Legendary Action the attacker has');
      if (legendaryTaken) {
        const refusal = legendaryRefusal(campaignId, attackerToken);
        if (refusal) return refuseRequest(socket, ack, refusal);
      }
      const cast = castWithSlot(attackerSheet as SheetSpellcasting | null, listed, slotLevel);
      if ('error' in cast) return refuseRequest(socket, ack, cast.error);
      let action = cast.action;

      // On its own turn a character makes as many attacks with the Attack
      // action as its features give it. A spell is the Magic action, and a
      // stat block's Multiattack is the DM's to follow. The DM may go past
      // the count, as they may overrule anything.
      const turnNow = getCombatState(campaignId);
      const acting = someoneActing(turnNow) && turnNow.currentTokenId === attackerId ? turnNow.turn : null;
      const weapon = action.source !== 'spell';
      const allowed = attackerSheet ? attacksPerAction(readFeatures(attackerSheet)) : null;
      if (!extra && !readied && acting && weapon && allowed !== null && acting.action === 'Attack' && acting.attacks >= allowed && socket.role !== 'DM') {
        return refuseRequest(
          socket,
          ack,
          `${attackerToken.name} has made its ${allowed === 1 ? 'attack' : `${allowed} attacks`} with the Attack action this turn`
        );
      }

      // Divine Smite, asked with the attack: a Bonus Action on the Paladin's own turn, with a slot it has left.
      if (smite !== undefined) {
        if (!attackerSheet || !hasDivineSmite(attackerSheet as SheetSpellcasting)) {
          return refuseRequest(socket, ack, `${attackerToken.name} has no Divine Smite prepared`);
        }
        if (!canSmiteWith(action)) return refuseRequest(socket, ack, 'Divine Smite follows a hit with a Melee weapon or an Unarmed Strike');
        if (turnNow.active && !acting) return refuseRequest(socket, ack, 'Divine Smite is a Bonus Action, taken on your own turn');
        if (acting?.bonusAction) return refuseRequest(socket, ack, `${attackerToken.name} has used its Bonus Action this turn`);
        const left = slotsLeft(attackerSheet as SheetSpellcasting)[smite] ?? 0;
        const castSlot = cast.slotLevel === smite ? 1 : 0;
        if (left - castSlot <= 0) return refuseRequest(socket, ack, `No level ${smite} spell slot left for Divine Smite`);
      }

      // Reckless Attack is decided with the first attack roll of the Barbarian's own turn.
      const alreadyReckless = turnNow.marks.some((mark) => mark.kind === 'reckless' && mark.attackerId === attackerId);
      if (reckless && !alreadyReckless) {
        if (!attackerSheet || !hasFeature(readFeatures(attackerSheet), 'Reckless Attack')) {
          return refuseRequest(socket, ack, `${attackerToken.name} has no Reckless Attack`);
        }
        if (!acting || acting.attacks > 0 || opportunity || readied) {
          return refuseRequest(socket, ack, 'Reckless Attack is decided with the first attack roll of the turn');
        }
      }

      // An Opportunity Attack is the one the target's movement offered: one
      // melee attack, made with the reaction, that finds the target where it
      // stood right before it left the attacker's reach.
      const offer = opportunity ? turnNow.opportunities.find((o) => o.attackerId === attackerId && o.targetId === targetId) : undefined;
      if (opportunity) {
        if (!offer) return refuseRequest(socket, ack, `${attackerToken.name} has no Opportunity Attack to make against ${targetToken.name}`);
        if (!weapon || action.attack?.kind !== 'melee') {
          return refuseRequest(socket, ack, 'An Opportunity Attack is one melee attack with a weapon or an Unarmed Strike');
        }
      }
      // An extra attack the weapon gives: Cleave after a hit with it, or the
      // Light weapon's after the Attack action (part of it with Nick). Neither
      // adds a positive ability modifier to the damage, save the Light one for
      // the Two-Weapon Fighting style; neither counts against the Attack action.
      const record = turnAttacksOf(campaignId);
      let nicked = false;
      // An Unarmed Strike of Flurry of Blows: one of the two the Bonus Action gave.
      if (extra === 'flurry') {
        if (action.unarmed !== 'damage') return refuseRequest(socket, ack, 'Flurry of Blows makes Unarmed Strikes');
        if (!acting || !record || (record.flurry.get(attackerId) ?? 0) <= 0) {
          return refuseRequest(socket, ack, `${attackerToken.name} has no Flurry of Blows strike left this turn`);
        }
      }
      if (extra && extra !== 'flurry') {
        if (!extrasOf(action).includes(extra)) {
          return refuseRequest(socket, ack, extra === 'cleave' ? `${action.name} has no Cleave` : `${action.name} is not a Light weapon`);
        }
        if (!acting || !record) return refuseRequest(socket, ack, 'An extra attack is made on the attacker’s own turn');
        if (extra === 'cleave') {
          if (record.cleaved.has(attackerId)) return refuseRequest(socket, ack, `${attackerToken.name} has cleaved this turn`);
          const besideFirst = record.cleaveHits.some((hit) => {
            if (hit.attackerId !== attackerId || hit.targetId === targetId) return false;
            const first = tokens.find((t) => t.id === hit.targetId);
            return (
              first !== undefined &&
              distanceFeet(standing(first), standing(targetToken), {
                heights: readTileHeights(map.tileHeights),
                feetPerSquare: map.feetPerSquare,
                diagonalRule: map.diagonalRule === 'alternating' ? 'alternating' : 'flat',
              }) <= 5
            );
          });
          if (!besideFirst) {
            return refuseRequest(socket, ack, `Cleave follows a hit with the weapon on a creature within 5 feet of ${targetToken.name}`);
          }
        } else {
          if (record.lightExtra.has(attackerId)) return refuseRequest(socket, ack, `${attackerToken.name} has made its Light extra attack this turn`);
          if (acting.action !== 'Attack') return refuseRequest(socket, ack, 'The Light extra attack follows the Attack action');
          const prior = (record.lightWeapons.get(attackerId) ?? []).filter((used) => used.name !== action.name);
          if (prior.length === 0) {
            return refuseRequest(socket, ack, 'The Light extra attack is made with a different Light weapon than the Attack action used');
          }
          nicked = action.mastery === 'Nick' || prior.some((used) => used.nick);
          if (!nicked && acting.bonusAction) return refuseRequest(socket, ack, `${attackerToken.name} has used its Bonus Action this turn`);
        }
        const twoWeapons = extra === 'light' && attackerSheet !== null && hasTwoWeaponFighting(readFeatures(attackerSheet));
        if (!twoWeapons) action = withoutAbilityModifier(action, attackAbilityModifier(action, attackerToken, attackerSheet));
      }
      const target = combatant(targetToken, targetSheet, turnNow.dodging, isRaging(campaignId, targetId));
      // A raging barbarian casts no spells, and its Strength attacks deal its Rage Damage.
      const attackerRaging = isRaging(campaignId, attackerId);
      if (attackerRaging && action.source === 'spell') return refuseRequest(socket, ack, `${attackerToken.name} cannot cast spells while raging`);
      const rageBonus = attackerRaging && attackerSheet && usesStrength(action, attackerToken, attackerSheet) ? rageDamage(attackerSheet) : 0;
      if (rageBonus > 0 && action.attack) {
        const type = action.attack.damage[0]?.type ?? 'bludgeoning';
        action = { ...action, attack: { ...action.attack, damage: [...action.attack.damage, { roll: { count: 0, sides: 1, bonus: rageBonus }, type }] } };
      }

      // The attacker's feats: Archery's +2 with a Ranged weapon; Great Weapon
      // Fighting's 3s; Savage Attacker's second damage roll, once a turn.
      const attackerFeatures = attackerSheet ? readFeatures(attackerSheet) : [];
      const archery = archeryBonus(attackerFeatures, action);
      if (archery > 0 && action.attack) action = { ...action, attack: { ...action.attack, bonus: action.attack.bonus + archery } };
      const savage = savageAttackerApplies(attackerFeatures, action) && !savageUsed(campaignId, attackerId);

      // A Vex the attacker holds on this target, and a Sap on the attacker, are used by this roll.
      const vexed = turnNow.marks.find((mark) => mark.kind === 'vex' && mark.attackerId === attackerId && mark.targetId === targetId);
      const sapped = turnNow.marks.find((mark) => mark.kind === 'sap' && mark.targetId === attackerId);
      // A Help an ally of the attacker gave against this target: the attacker's side, not the attacker itself.
      const helped = turnNow.marks.find((mark) => {
        if (mark.kind !== 'help' || mark.targetId !== targetId || mark.attackerId === attackerId) return false;
        const helper = tokens.find((t) => t.id === mark.attackerId);
        const helperSide = helper ? sideOf({ type: helper.type ?? 'npc', disposition: helper.disposition ?? null }) : null;
        const ownSide = sideOf({ type: attackerToken.type ?? 'npc', disposition: attackerToken.disposition ?? null });
        return helperSide !== null && helperSide === ownSide;
      });
      const helperName = helped ? (tokens.find((t) => t.id === helped.attackerId)?.name ?? 'an ally') : null;
      // Reckless Attack: Advantage on the Barbarian's Strength attacks, and on attacks against it.
      const attackingRecklessly =
        (reckless || alreadyReckless) && attackerSheet !== null && usesStrength(action, attackerToken, attackerSheet);
      const targetReckless = turnNow.marks.some((mark) => mark.kind === 'reckless' && mark.attackerId === targetId);
      const extraReasons = [
        ...(attackingRecklessly ? ['Advantage: Reckless Attack'] : []),
        ...(targetReckless ? [`Advantage: Reckless Attack (${targetToken.name})`] : []),
        ...(vexed ? [`Advantage: Vex (${attackerToken.name}'s last hit)`] : []),
        ...(helped ? [`Advantage: Help (${helperName})`] : []),
        ...(sapped ? ['Disadvantage: Sapped'] : []),
      ];

      // A Rogue's Sneak Attack, once on each turn: with Advantage, or with an
      // ally of the Rogue beside the target and no Disadvantage.
      const sneakDice = sneakAttackUsed(campaignId, attackerId) ? 0 : sneakAttackDice(attackerSheet);
      const attackerSide = sideOf({ type: attackerToken.type ?? 'npc', disposition: attackerToken.disposition ?? null });
      const boardOf = {
        heights: readTileHeights(map.tileHeights),
        feetPerSquare: map.feetPerSquare,
        diagonalRule: map.diagonalRule === 'alternating' ? ('alternating' as const) : ('flat' as const),
      };
      const targetStanding = standing(offer ? { ...targetToken, position: offer.from } : targetToken);
      const allyBesideTarget =
        sneakDice > 0 &&
        attackerSide !== null &&
        tokens.some(
          (t) =>
            t.id !== attackerId &&
            t.id !== targetId &&
            t.layer === attackerToken.layer &&
            !(t.hp && t.hp.current <= 0) &&
            sideOf({ type: t.type ?? 'npc', disposition: t.disposition ?? null }) === attackerSide &&
            canAct(readConditions(t.conditions ?? [])) &&
            distanceFeet(standing(t), targetStanding, boardOf) <= 5
        );
      const sneakAttack = (rolled: 'normal' | 'advantage' | 'disadvantage') => {
        const damage = sneakAttackDamage(sneakDice, action, rolled, allyBesideTarget);
        return damage ? { label: `Sneak Attack (${sneakDice}d6)`, damage } : null;
      };

      // On a lit map, darkness decides who sees whom, as the views draw it.
      const lit = map.lightingEnabled
        ? {
            attacker: !creatureSees(targetToken, attackerToken, map),
            target: !creatureSees(attackerToken, offer ? { ...targetToken, position: offer.from } : targetToken, map),
          }
        : undefined;

      // Uncanny Dodge the target holds ready: its reaction halves a hit from an attacker it can see.
      const targetState = readConditions(targetToken.conditions ?? []);
      const uncanny =
        turnNow.marks.some((mark) => mark.kind === 'uncanny' && mark.attackerId === targetId) &&
        targetSheet !== null &&
        hasFeature(readFeatures(targetSheet), 'Uncanny Dodge') &&
        !turnNow.reactionsSpent.includes(targetId) &&
        canAct(targetState) &&
        !targetState.has.has('blinded') &&
        !readConditions(attackerToken.conditions ?? []).has.has('invisible') &&
        !lit?.attacker;

      const result = resolveAttack({
        unseen: lit,
        extraReasons,
        ...(uncanny ? { halveDamage: 'Uncanny Dodge' } : {}),
        ...(smite !== undefined
          ? {
              hitDamage: [
                {
                  label: `Divine Smite (level ${smite})`,
                  damage: divineSmiteDamage(smite, (targetToken.statBlock as { creatureType?: string } | undefined)?.creatureType),
                },
              ],
            }
          : {}),
        bonusDamage: sneakDice > 0 ? sneakAttack : undefined,
        savage,
        greatWeapon: greatWeaponFighting(attackerFeatures, action),
        attacker: combatant(attackerToken, attackerSheet, [], attackerRaging),
        target: offer ? { ...target, standing: standing({ ...targetToken, position: offer.from }) } : target,
        action,
        board: {
          heights: readTileHeights(map.tileHeights),
          feetPerSquare: map.feetPerSquare,
          diagonalRule: map.diagonalRule === 'alternating' ? 'alternating' : 'flat',
          others: tokens
            .filter((t) => t.id !== attackerId && t.id !== targetId && t.layer === attackerToken.layer && !(t.hp && t.hp.current <= 0))
            .map(standing),
        },
        mode,
      });
      if (!result.ok) return refuseRequest(socket, ack, result.reason);
      const undo = await prepareUndo(campaignId, map.id, [attackerToken.characterId, targetToken.characterId]);
      // The slot goes before the damage: a cast that finds it gone changes nothing.
      if (cast.slotLevel !== null && !(await spendSlot(campaignId, socket.userId, attackerToken.characterId!, cast.slotLevel))) {
        return refuseRequest(socket, ack, `No level ${cast.slotLevel} spell slot left to cast ${action.name}`);
      }
      // Divine Smite takes its slot and the Bonus Action only when the attack hits.
      if (smite !== undefined && result.outcome.hit) {
        if (!(await spendSlot(campaignId, socket.userId, attackerToken.characterId!, smite))) {
          return refuseRequest(socket, ack, `No level ${smite} spell slot left for Divine Smite`);
        }
        spendBonusAction(campaignId, attackerId);
      }

      const endured = await applyDealt(io, campaignId, map.id, [{ token: targetToken, sheet: targetSheet, dealt: result.dealt, hp: result.hp, critical: result.outcome.critical }]);
      spendRecharge(campaignId, attackerId, action);
      // A concentration spell cast starts its concentration, ending any other.
      const concentrating = action.spell ? findSpell(action.name) : null;
      if (concentrating?.concentration) startConcentration(campaignId, attackerId, concentrating.name);
      if (vexed || sapped || helped) useMarks(campaignId, [vexed, sapped, helped]);
      if (result.halvedBy) {
        const now = getCombatState(campaignId);
        now.marks = now.marks.filter((mark) => !(mark.kind === 'uncanny' && mark.attackerId === targetId));
        setCombatState(campaignId, now);
        await spendReaction(io, campaignId, targetId);
      }
      if (reckless && !alreadyReckless) {
        const now = getCombatState(campaignId);
        now.marks = [...now.marks, { kind: 'reckless', attackerId, targetId: attackerId, turnEndsLeft: 1 }];
        setCombatState(campaignId, now);
      }
      if (ready) {
        const now = getCombatState(campaignId);
        now.marks = now.marks.filter((m) => !(m.kind === 'ready' && m.attackerId === attackerId));
        setCombatState(campaignId, now);
        readiedAttacks.get(campaignId)?.delete(attackerId);
      }
      if (result.bonuses.some((bonus) => bonus.startsWith('Sneak Attack'))) useSneakAttack(campaignId, attackerId);
      if (result.bonuses.includes('Savage Attacker')) useSavage(campaignId, attackerId);
      if (attackerRaging && turnNow.currentTokenId === attackerId) keepRaging(campaignId, attackerId);
      const mastered = await applyMastery(io, campaignId, map, action, attackerToken, attackerSheet, targetToken, targetSheet, result, target.defences);
      // A stat block's hit can leave a condition: a grapple, a poison, a fall.
      const riders =
        action.source === 'statBlock' && result.outcome.hit && !result.dropped
          ? await applyRiders(io, campaignId, map.id, attackerToken, targetToken, conditionsOnHit(action.text ?? ''))
          : [];
      // What the turn remembers for the extra attacks that follow.
      if (record && !offer && turnNow.currentTokenId === attackerId) {
        if (extra === 'flurry') record.flurry.set(attackerId, (record.flurry.get(attackerId) ?? 1) - 1);
        else if (extra === 'cleave') record.cleaved.add(attackerId);
        else if (extra === 'light') record.lightExtra.add(attackerId);
        else if (weapon) {
          if (result.outcome.hit && extrasOf(action).includes('cleave')) record.cleaveHits.push({ attackerId, targetId });
          if (action.attack?.light) {
            record.lightWeapons.set(attackerId, [...(record.lightWeapons.get(attackerId) ?? []), { name: action.name, nick: action.mastery === 'Nick' }]);
          }
        }
      }
      if (legendaryTaken) {
        spendLegendary(campaignId, attackerId);
        await resendInitiativeState(io, campaignId);
      } else if (offer || ready) await spendReaction(io, campaignId, attackerId);
      else if (extra === 'light' && !nicked) {
        spendBonusAction(campaignId, attackerId);
        await resendInitiativeState(io, campaignId);
      } else if (!extra) await spendAction(io, campaignId, attackerId, weapon ? 'Attack' : 'Magic', weapon);
      // An attack by or on a token the players are not shown goes to the DM alone.
      const secret = hiddenFromPlayers(attackerToken) || hiddenFromPlayers(targetToken);
      const extraLabel = legendaryTaken
        ? `Legendary Action: ${legendaryTaken.name}`
        : extra === 'flurry'
        ? 'Flurry of Blows'
        : ready
        ? `readied: ${ready.trigger}`
        : extra === 'cleave'
          ? 'Cleave'
          : extra === 'light'
            ? nicked
              ? 'Light extra attack, with Nick'
              : 'Light extra attack, a Bonus Action'
            : null;
      const summary = [result.summary, ...(extraLabel ? [extraLabel] : []), ...result.bonuses, ...(mastered ? [mastered] : []), ...riders, ...endured].join('; ');
      await logRoll(io, socket, campaignId, breakdownOf(result), attackerToken.name, summary, secret);

      commitUndo(campaignId, undo, summary);
      answer(ack, { ...result, summary });
      logger.debug('combat.attack', { campaignId, attackerId, targetId, hit: result.outcome.hit, dealt: result.dealt });
    } catch (error) {
      logger.error('combat.attack failed', { err: error });
      refuseRequest(socket, ack, 'Failed to resolve the attack');
    }
  });

  /**
   * COMBAT.FALL — A token on the current map has fallen `feet` feet: the server rolls 1d6 Bludgeoning damage for every 10 feet, at most 20d6, takes it from the token's hit points through its defences, gives it the Prone condition unless it took no damage, and records the roll in the dice log. The DM, or the player who controls the token.
   */
  socket.on('combat.fall', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.fall', ack)) return;
      const parsed = CombatFallSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { tokenId, feet } = parsed.data;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const token = readTokens(map.tokens).find((t) => t.id === tokenId);
      if (!token || !canControlToken(socket.role, token.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      const sheet = await sheetOf(token, campaignId);
      const faller = combatant(token, sheet);
      const result = resolveFall({ name: faller.name, hp: faller.hp, defences: faller.defences }, feet);
      const undo = await prepareUndo(campaignId, map.id, [token.characterId]);

      const endured = await applyDealt(io, campaignId, map.id, [{ token, sheet, dealt: result.dealt, hp: result.hp }]);
      const summary = [result.summary, ...endured].join('; ');
      if (result.prone) await giveCondition(io, campaignId, map.id, tokenId, 'Prone');
      const dice = result.rolled.dice;
      const expression = `${dice.length}d6`;
      await logRoll(
        io,
        socket,
        campaignId,
        {
          expression,
          total: result.rolled.total,
          breakdown: {
            expression,
            rolls: [{ type: 'dice' as const, notation: expression, count: dice.length, sides: 6, results: dice, kept: dice, total: result.rolled.total }],
            total: result.rolled.total,
            formula: `[${dice.join(', ')}] = ${result.rolled.total}`,
          },
        },
        token.name,
        summary,
        hiddenFromPlayers(token)
      );

      commitUndo(campaignId, undo, summary);
      ack?.({ ok: true, summary, feet, dealt: result.dealt, prone: result.prone });
      logger.debug('combat.fall', { campaignId, tokenId, feet, dealt: result.dealt });
    } catch (error) {
      logger.error('combat.fall failed', { err: error });
      refuseRequest(socket, ack, 'Failed to resolve the fall');
    }
  });

  /**
   * COMBAT.CHECK — A token on the current map makes an ability check: a skill, a bare ability, or the Hide action. The server reads the bonus from the character's sheet or the stat block, rolls the d20 with the token's conditions (Disadvantage while Poisoned or Frightened, the Exhaustion penalty), compares the total with the DC when one is given, and records the roll in the dice log. The Hide action is a Dexterity (Stealth) check against DC 15 that gives the token the Invisible condition on a success and is its action on its own turn. The DM, or the player who controls the token.
   */
  socket.on('combat.check', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.check', ack)) return;
      const parsed = CombatCheckSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { tokenId, ability, hide, mode, bonusAction } = parsed.data;
      const skill = hide ? 'stealth' : parsed.data.skill;
      const dc = hide ? HIDE_DC : parsed.data.dc;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const token = readTokens(map.tokens).find((t) => t.id === tokenId);
      if (!token || !canControlToken(socket.role, token.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      const sheet = await sheetOf(token, campaignId);
      const creature = combatant(token, sheet, [], isRaging(campaignId, tokenId));
      const state = readConditions(creature.conditions, creature.exhaustion);
      if (hide && !canAct(state)) return refuseRequest(socket, ack, `${token.name} is Incapacitated and cannot take the Hide action`);
      // Hide as a Bonus Action is a Rogue's Cunning Action, on its own turn with the Bonus Action left.
      if (bonusAction) {
        const turnNow = getCombatState(campaignId);
        if (!hide) return refuseRequest(socket, ack, 'Only the Hide action is taken as a Bonus Action');
        if (!sheet || !hasTurnFeature(sheet, 'Cunning Action')) return refuseRequest(socket, ack, `${token.name} has no Cunning Action`);
        if (!(someoneActing(turnNow) && turnNow.currentTokenId === tokenId && turnNow.turn)) return refuseRequest(socket, ack, 'Cunning Action is a Bonus Action on the creature’s own turn');
        if (turnNow.turn.bonusAction) return refuseRequest(socket, ack, `${token.name} has used its Bonus Action this turn`);
      }

      const bonus = skill ? skillBonusOf(token, sheet, skill) : abilityModifierOf(token, sheet, ability!);
      if (bonus === null) return refuseRequest(socket, ack, `${token.name} has no sheet or stat block to make the check with`);
      const label = skill
        ? `${ABILITY_CHECK_NAMES[SKILL_CHECKS[skill].ability]} (${SKILL_CHECKS[skill].name})`
        : ABILITY_CHECK_NAMES[ability!];
      const used = skill ? SKILL_CHECKS[skill].ability : ability!;
      const result = resolveCheck({ name: token.name, label, bonus, dc, mode, conditions: state, ability: used, lucky: hasLuck(sheet) });

      const hidden = hide === true && result.success === true;
      if (hidden) await giveCondition(io, campaignId, map.id, tokenId, 'Invisible');
      if (hide && bonusAction) {
        spendBonusAction(campaignId, tokenId);
        await resendInitiativeState(io, campaignId);
      } else if (hide) await spendAction(io, campaignId, tokenId, 'Hide');
      // Hiding well enough to be Invisible sets what a search for the creature must beat.
      const summary = hidden ? `${result.summary}; hidden (Invisible) until found with a Wisdom (Perception) check of DC ${result.total}` : result.summary;

      const { roll } = result;
      const notation = roll.mode === 'normal' ? '1d20' : roll.mode === 'advantage' ? '2d20kh1' : '2d20kl1';
      const sign = roll.modifier < 0 ? '-' : '+';
      const expression = `${notation}${sign}${Math.abs(roll.modifier)}`;
      await logRoll(
        io,
        socket,
        campaignId,
        {
          expression,
          total: roll.total,
          breakdown: {
            expression,
            rolls: [
              { type: 'dice' as const, notation, count: roll.dice.length, sides: 20, results: roll.dice, kept: [roll.natural], total: roll.natural },
              { type: 'modifier' as const, value: roll.modifier },
            ],
            total: roll.total,
            formula: `[${roll.dice.join(', ')}] ${sign} ${Math.abs(roll.modifier)} = ${roll.total}`,
          },
        },
        token.name,
        summary,
        hiddenFromPlayers(token)
      );

      ack?.({ ok: true, summary, total: result.total, success: result.success, reasons: result.reasons, hidden });
      logger.debug('combat.check', { campaignId, tokenId, skill, ability, total: result.total });
    } catch (error) {
      logger.error('combat.check failed', { err: error });
      refuseRequest(socket, ack, 'Failed to resolve the check');
    }
  });

  /**
   * COMBAT.REST — A D&D 5e character of the campaign rests. `short` spends one Hit Point Die: the server rolls it, adds the Constitution modifier, restores that many Hit Points (at least 1) and records the roll in the dice log; the character's player or the DM. `long` gives back all Hit Points, Hit Point Dice and spell slots, ends Temporary Hit Points, takes off one level of Exhaustion and clears death saves; the DM only.
   */
  socket.on('combat.rest', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.rest', ack)) return;
      const parsed = CombatRestSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { characterId, kind } = parsed.data;
      const isDM = socket.role === 'DM';
      if (kind === 'long' && !isDM) return refuseRequest(socket, ack, 'A Long Rest is the DM’s to give');

      // Rolled and written under the row lock, so two dice spent at once are two dice.
      const rested = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
        const fresh = await tx.character.findFirst({ where: { id: characterId, campaignId } });
        if (!fresh || fresh.gameSystem !== DND || (!isDM && fresh.userId !== socket.userId)) {
          return { refusal: 'That is not a D&D 5e character you can rest' };
        }
        const sheet = (fresh.data ?? {}) as Record<string, unknown>;
        if (kind === 'shortFinish') {
          const back = restoreResources(sheet, 'short');
          const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(back.sheet) } });
          const gains = back.regained.length > 0 ? back.regained.join(', ') : 'no feature to regain';
          return { updated, hp: null, die: null, summary: `${fresh.name} finishes a Short Rest: ${gains}` };
        }
        if (kind === 'long') {
          const long = longRest(sheet);
          const features = restoreResources(long.sheet, 'long');
          const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(features.sheet) } });
          long.regained.push(...features.regained);
          const gains = long.regained.length > 0 ? long.regained.join(', ') : 'nothing to regain';
          return { updated, hp: long.hp, die: null, summary: `${fresh.name} finishes a Long Rest: ${gains}` };
        }
        const spent = spendHitDie(sheet);
        if (!spent.ok) return { refusal: `${fresh.name}: ${spent.reason}` };
        const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(spent.sheet) } });
        const sign = spent.modifier < 0 ? '-' : '+';
        return {
          updated,
          hp: spent.hp,
          die: spent,
          summary: `${fresh.name} spends a Hit Point Die (d${spent.sides}${sign}${Math.abs(spent.modifier)}): regains ${spent.regained} Hit Points, ${spent.left} ${spent.left === 1 ? 'die' : 'dice'} left`,
        };
      });
      if ('refusal' in rested) return refuseRequest(socket, ack, rested.refusal!);

      const { updated, hp, die, summary } = rested;
      await bestEffort('sheet after a rest', () =>
        emitCharacterUpdated(campaignId, updated, { characterId, userId: updated.userId, tokensChanged: false })
      );
      if (hp) io.to(campaignId).emit('character.hp.updated', { characterId, hp: { current: hp.current, max: hp.maximum, temp: hp.temporary } });
      if (die) {
        const sign = die.modifier < 0 ? '-' : '+';
        const expression = `1d${die.sides}${sign}${Math.abs(die.modifier)}`;
        const total = die.rolled + die.modifier;
        await logRoll(
          io,
          socket,
          campaignId,
          {
            expression,
            total,
            breakdown: {
              expression,
              rolls: [
                { type: 'dice' as const, notation: `1d${die.sides}`, count: 1, sides: die.sides, results: [die.rolled], kept: [die.rolled], total: die.rolled },
                { type: 'modifier' as const, value: die.modifier },
              ],
              total,
              formula: `[${die.rolled}] ${sign} ${Math.abs(die.modifier)} = ${total}`,
            },
          },
          updated.name,
          summary,
          false
        );
      }

      ack?.({ ok: true, summary });
      logger.debug('combat.rest', { campaignId, characterId, kind });
    } catch (error) {
      logger.error('combat.rest failed', { err: error });
      refuseRequest(socket, ack, 'Failed to resolve the rest');
    }
  });

  /**
   * COMBAT.FEATURE — A token's D&D 5e character uses a class feature with a number of uses: `Second Wind` (a Bonus Action: the server rolls 1d10 + the character's level, restores those Hit Points and logs the roll) or `Action Surge` (one more action this turn, once a turn: the turn's action is given back). Also `Bardic Inspiration` and `Wild Shape` (Bonus Actions), `Channel Divinity`, `Favored Enemy` (Hunter's Mark without a slot) and `Focus Points` or `Sorcery Points` (`amount` points at once): the server counts the use and the table applies what it does. `Lay on Hands` (a Bonus Action) takes a `targetId` within 5 feet, the paladin itself when left out, and restores `amount` Hit Points from the pool, no more than the creature is missing, or with `cure: 'Poisoned'` spends 5 points to end that condition. `Uncanny Dodge` holds the Rogue's reaction ready, or lets it go: the next hit from an attacker it can see deals half damage and spends it. The use comes off the sheet's `featureUses`. On the character's own turn in combat, the Bonus Action must still be there for a feature that spends it. The DM, or the player who controls the token.
   */
  socket.on('combat.feature', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.feature', ack)) return;
      const parsed = CombatFeatureSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { tokenId, feature, amount, targetId, cure, as, focus } = parsed.data;
      if ((targetId !== undefined || cure !== undefined) && feature !== 'Lay on Hands') {
        return refuseRequest(socket, ack, 'Only Lay on Hands takes a target');
      }
      if (amount !== undefined && amount > 1 && !POINT_RESOURCES.includes(feature as ResourceName)) {
        return refuseRequest(socket, ack, `${feature} is spent one use at a time`);
      }

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const token = readTokens(map.tokens).find((t) => t.id === tokenId);
      if (!token || !canControlToken(socket.role, token.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      const characterId = token.characterId;
      const ownSheet = characterId ? await sheetOf(token, campaignId) : null;
      if (!characterId || !ownSheet) return refuseRequest(socket, ack, `${token.name} has no D&D character sheet`);

      const combat = getCombatState(campaignId);
      const ownTurn = someoneActing(combat) && combat.currentTokenId === tokenId && combat.turn !== null;
      // Uncanny Dodge: the reaction is held for the next hit from an attacker the Rogue can see, or let go.
      if (feature === 'Uncanny Dodge') {
        if (!combat.active) return refuseRequest(socket, ack, 'Uncanny Dodge is held ready during combat');
        if (!hasFeature(readFeatures(ownSheet), 'Uncanny Dodge')) return refuseRequest(socket, ack, `${token.name} has no Uncanny Dodge`);
        const held = combat.marks.some((mark) => mark.kind === 'uncanny' && mark.attackerId === tokenId);
        combat.marks = held
          ? combat.marks.filter((mark) => !(mark.kind === 'uncanny' && mark.attackerId === tokenId))
          : [...combat.marks, { kind: 'uncanny', attackerId: tokenId, targetId: tokenId, turnEndsLeft: 1 }];
        setCombatState(campaignId, combat);
        await resendInitiativeState(io, campaignId);
        const summary = held ? `${token.name} no longer holds Uncanny Dodge ready` : `${token.name} holds Uncanny Dodge ready`;
        ack?.({ ok: true, summary, left: 0 });
        return;
      }
      if (feature === 'End Rage') {
        if (!isRaging(campaignId, tokenId)) return refuseRequest(socket, ack, `${token.name} is not raging`);
        const now = getCombatState(campaignId);
        now.marks = now.marks.filter((mark) => !(mark.kind === 'rage' && mark.attackerId === tokenId));
        setCombatState(campaignId, now);
        await resendInitiativeState(io, campaignId);
        const summary = `${token.name}'s Rage ends`;
        ack?.({ ok: true, summary, left: 0 });
        return;
      }
      if (feature === 'Rage') {
        if (!combat.active) return refuseRequest(socket, ack, 'A Rage is kept during combat');
        if (isRaging(campaignId, tokenId)) return refuseRequest(socket, ack, `${token.name} is already raging`);
      }
      const bonusAction =
        feature === 'Second Wind' || feature === 'Rage' || feature === 'Bardic Inspiration' || feature === 'Wild Shape' || feature === 'Lay on Hands' ||
        feature === 'Cunning Action' || feature === 'Flurry of Blows' || feature === 'Patient Defense' || feature === 'Step of the Wind';
      if (bonusAction && ownTurn && combat.turn!.bonusAction) {
        return refuseRequest(socket, ack, `${token.name} has used its Bonus Action this turn`);
      }
      if (feature === 'Cunning Action' || feature === 'Flurry of Blows' || feature === 'Patient Defense' || feature === 'Step of the Wind') {
        const taken = await takeTurnFeature(io, campaignId, token, characterId, feature, { as, focus }, ownTurn);
        if ('refusal' in taken) return refuseRequest(socket, ack, taken.refusal);
        ack?.({ ok: true, summary: taken.summary, left: taken.left });
        return;
      }
      if (feature === 'Lay on Hands') {
        const touched = await layOnHands(io, socket, campaignId, map, token, targetId ?? tokenId, amount, cure === 'Poisoned');
        if ('refusal' in touched) return refuseRequest(socket, ack, touched.refusal);
        if (ownTurn) spendBonusAction(campaignId, tokenId);
        await resendInitiativeState(io, campaignId);
        ack?.({ ok: true, summary: touched.summary, left: touched.left });
        return;
      }
      if (feature === 'Action Surge') {
        if (!ownTurn) return refuseRequest(socket, ack, 'Action Surge is used on the character’s own turn');
        const surged = actionSurges.get(campaignId);
        if (surged && surged.tokenId === tokenId && surged.round === combat.round) {
          return refuseRequest(socket, ack, `${token.name} has used Action Surge this turn`);
        }
      }

      const undo = await prepareUndo(campaignId, map.id, [characterId]);
      const used = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
        const fresh = await tx.character.findUnique({ where: { id: characterId } });
        if (!fresh) return { refusal: `${token.name} has no D&D character sheet` };
        const sheet = (fresh.data ?? {}) as Record<string, unknown>;
        const spent = spendResource(sheet, feature, amount ?? 1);
        if (!spent.ok) return { refusal: `${token.name}: ${spent.reason}` };
        let next = spent.sheet;
        let healed: { rolled: number; bonus: number; hp: { current: number; max: number; temp: number } } | null = null;
        if (feature === 'Second Wind') {
          const rolled = rollDie(10);
          const bonus = secondWindBonus(sheet);
          const change = applyHpDelta(DND, next, rolled + bonus);
          if ('error' in change) return { refusal: `${token.name} tracks no Hit Points` };
          next = change.data as Record<string, unknown>;
          healed = { rolled, bonus, hp: change.hp };
        }
        const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(next) } });
        return { updated, healed, left: spent.left };
      });
      if ('refusal' in used) return refuseRequest(socket, ack, used.refusal!);

      const { updated, healed, left } = used;
      await bestEffort('sheet after a feature', () =>
        emitCharacterUpdated(campaignId, updated, { characterId, userId: updated.userId, tokensChanged: false })
      );
      const usesLeft = `${left} ${left === 1 ? 'use' : 'uses'} left`;
      let summary: string;
      if (healed) {
        io.to(campaignId).emit('character.hp.updated', { characterId, hp: healed.hp });
        summary = `${token.name} uses Second Wind: regains ${healed.rolled + healed.bonus} Hit Points (${usesLeft})`;
        if (ownTurn) spendBonusAction(campaignId, tokenId);
        const expression = `1d10+${healed.bonus}`;
        await logRoll(
          io,
          socket,
          campaignId,
          {
            expression,
            total: healed.rolled + healed.bonus,
            breakdown: {
              expression,
              rolls: [
                { type: 'dice' as const, notation: '1d10', count: 1, sides: 10, results: [healed.rolled], kept: [healed.rolled], total: healed.rolled },
                { type: 'modifier' as const, value: healed.bonus },
              ],
              total: healed.rolled + healed.bonus,
              formula: `[${healed.rolled}] + ${healed.bonus} = ${healed.rolled + healed.bonus}`,
            },
          },
          token.name,
          summary,
          hiddenFromPlayers(token)
        );
      } else if (feature === 'Rage') {
        addMark(campaignId, { kind: 'rage', attackerId: tokenId, targetId: tokenId });
        if (ownTurn) spendBonusAction(campaignId, tokenId);
        summary = `${token.name} enters a Rage: Resistance to Bludgeoning, Piercing and Slashing damage, +${rageDamage(updated.data as Record<string, unknown>)} damage on Strength attacks, Advantage on Strength checks and saves (${usesLeft})`;
      } else if (feature !== 'Action Surge') {
        // A use the table applies: the server counts it, and a Bonus Action feature spends the Bonus Action.
        if (bonusAction && ownTurn) spendBonusAction(campaignId, tokenId);
        summary = featureSummary(token.name, feature, updated.data as Record<string, unknown>, amount ?? 1, left);
      } else {
        // One more action: the one taken is given back, and the turn remembers the surge.
        const now = getCombatState(campaignId);
        if (someoneActing(now) && now.currentTokenId === tokenId && now.turn) {
          now.turn = { ...now.turn, action: null, attacks: 0 };
          setCombatState(campaignId, now);
          actionSurges.set(campaignId, { tokenId, round: now.round });
        }
        summary = `${token.name} uses Action Surge: one more action this turn, not the Magic action (${usesLeft})`;
      }
      await resendInitiativeState(io, campaignId);

      commitUndo(campaignId, undo, summary);
      ack?.({ ok: true, summary, left });
      logger.debug('combat.feature', { campaignId, tokenId, feature });
    } catch (error) {
      logger.error('combat.feature failed', { err: error });
      refuseRequest(socket, ack, 'Failed to use the feature');
    }
  });

  /**
   * COMBAT.STAND — A Prone token on the current map stands up: the server takes the Prone condition off it and tells the table. Refused while its Speed is 0 (Grappled, Paralyzed, Petrified, Restrained or Unconscious). What standing costs of its movement, half its Speed, is the sender's to record with `turn.update`. The DM, or the player who controls the token.
   */
  socket.on('combat.stand', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.stand', ack)) return;
      const parsed = CombatStandSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { tokenId } = parsed.data;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const token = readTokens(map.tokens).find((t) => t.id === tokenId);
      if (!token || !canControlToken(socket.role, token.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      const state = readConditions(token.conditions ?? []);
      if (!state.has.has('prone')) return refuseRequest(socket, ack, `${token.name} is not Prone`);
      if (effectiveSpeed(30, state) === 0) return refuseRequest(socket, ack, `${token.name} cannot stand up while its Speed is 0`);

      await takeCondition(io, campaignId, map.id, tokenId, 'Prone');
      ack?.({ ok: true });
      logger.debug('combat.stand', { campaignId, tokenId });
    } catch (error) {
      logger.error('combat.stand failed', { err: error });
      refuseRequest(socket, ack, 'Failed to stand the token up');
    }
  });

  /**
   * COMBAT.HELP — The acting combatant takes the Help action to assist an attack: it distracts an enemy within 5 feet of it, and the next attack roll one of its allies makes against that enemy has Advantage, until the helper's next turn starts. The server spends the helper's action and keeps the help as a mark of kind `help`. On the helper's own turn, with its action not yet taken; the DM may overrule both. The DM, or the player who controls the helper.
   */
  socket.on('combat.help', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.help', ack)) return;
      const parsed = CombatHelpSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { helperId, targetId } = parsed.data;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const tokens = readTokens(map.tokens);
      const helper = tokens.find((t) => t.id === helperId);
      if (!helper || !canControlToken(socket.role, helper.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      const target = tokens.find((t) => t.id === targetId);
      if (!target || target.id === helperId || target.layer !== helper.layer || (socket.role !== 'DM' && hiddenFromPlayers(target))) {
        return refuseRequest(socket, ack, 'That creature is not on the map');
      }
      const combat = getCombatState(campaignId);
      if (!combat.active) return refuseRequest(socket, ack, 'Help is given during combat');
      const ownTurn = someoneActing(combat) && combat.currentTokenId === helperId && combat.turn !== null;
      if (socket.role !== 'DM') {
        if (!ownTurn) return refuseRequest(socket, ack, 'Help is an action on the helper’s own turn');
        if (combat.turn!.action !== null) return refuseRequest(socket, ack, `${helper.name} has taken its action this turn`);
      }
      if (!canAct(readConditions(helper.conditions ?? []))) return refuseRequest(socket, ack, `${helper.name} is Incapacitated`);
      const board = {
        heights: readTileHeights(map.tileHeights),
        feetPerSquare: map.feetPerSquare,
        diagonalRule: map.diagonalRule === 'alternating' ? ('alternating' as const) : ('flat' as const),
      };
      if (distanceFeet(standing(helper), standing(target), board) > 5) {
        return refuseRequest(socket, ack, `${target.name} is more than 5 feet from ${helper.name}`);
      }

      addMark(campaignId, { kind: 'help', attackerId: helperId, targetId });
      if (ownTurn) {
        const now = getCombatState(campaignId);
        if (now.turn) {
          now.turn = { ...now.turn, action: 'Help' };
          setCombatState(campaignId, now);
        }
      }
      await resendInitiativeState(io, campaignId);
      const summary = `${helper.name} helps against ${target.name}: an ally's next attack roll against it has Advantage`;
      ack?.({ ok: true, summary });
      logger.debug('combat.help', { campaignId, helperId, targetId });
    } catch (error) {
      logger.error('combat.help failed', { err: error });
      refuseRequest(socket, ack, 'Failed to give the help');
    }
  });

  /**
   * COMBAT.READY — The acting combatant takes the Ready action: it readies one of its attacks (by its place in `combat.actions`; not a spell) against a creature, for a trigger it names. The server spends its action and keeps the readied attack as a mark of kind `ready`; `combat.attack` with `readied: true` makes it, with the reaction, while the mark lasts (until the readier's next turn starts). On the readier's own turn, with its action not yet taken; the DM may overrule both. The DM, or the player who controls the token.
   */
  socket.on('combat.ready', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.ready', ack)) return;
      const parsed = CombatReadySchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { tokenId, targetId, action: actionIndex, trigger } = parsed.data;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const tokens = readTokens(map.tokens);
      const token = tokens.find((t) => t.id === tokenId);
      if (!token || !canControlToken(socket.role, token.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      const target = tokens.find((t) => t.id === targetId);
      if (!target || target.id === tokenId || target.layer !== token.layer || (socket.role !== 'DM' && hiddenFromPlayers(target))) {
        return refuseRequest(socket, ack, 'That creature is not on the map');
      }
      const combat = getCombatState(campaignId);
      if (!combat.active) return refuseRequest(socket, ack, 'An action is readied during combat');
      const ownTurn = someoneActing(combat) && combat.currentTokenId === tokenId && combat.turn !== null;
      if (socket.role !== 'DM') {
        if (!ownTurn) return refuseRequest(socket, ack, 'Ready is an action on the creature’s own turn');
        if (combat.turn!.action !== null) return refuseRequest(socket, ack, `${token.name} has taken its action this turn`);
      }
      const sheet = await sheetOf(token, campaignId);
      const action = actionsOf(token, sheet)[actionIndex];
      if (!action?.attack) return refuseRequest(socket, ack, 'That is not an attack the creature has');
      if (action.source === 'spell') return refuseRequest(socket, ack, 'A readied spell is the table’s to hold for now');

      const now = getCombatState(campaignId);
      now.marks = [
        ...now.marks.filter((m) => !(m.kind === 'ready' && m.attackerId === tokenId)),
        { kind: 'ready', attackerId: tokenId, targetId, turnEndsLeft: 1 },
      ];
      if (ownTurn && now.turn) now.turn = { ...now.turn, action: 'Ready' };
      setCombatState(campaignId, now);
      const kept = readiedAttacks.get(campaignId) ?? new Map();
      kept.set(tokenId, { targetId, action: actionIndex, name: action.name, trigger });
      readiedAttacks.set(campaignId, kept);
      await resendInitiativeState(io, campaignId);
      const summary = `${token.name} readies ${action.name} against ${target.name}: ${trigger}`;
      ack?.({ ok: true, summary });
      logger.debug('combat.ready', { campaignId, tokenId, targetId });
    } catch (error) {
      logger.error('combat.ready failed', { err: error });
      refuseRequest(socket, ack, 'Failed to ready the attack');
    }
  });

  /**
   * COMBAT.CONCENTRATE — A token's caster starts concentrating on a spell its sheet has ready that needs Concentration (one it cast by hand, a buff the VTT does not roll), ending its concentration on any other; or, with `end: true`, ends its concentration. During combat. A concentration spell cast through `combat.attack` or `combat.save` starts concentration by itself, and damage makes the caster save to keep it. The DM, or the player who controls the token.
   */
  socket.on('combat.concentrate', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.concentrate', ack)) return;
      const parsed = CombatConcentrateSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { tokenId, spell, end } = parsed.data;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const token = readTokens(map.tokens).find((t) => t.id === tokenId);
      if (!token || !canControlToken(socket.role, token.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      if (!getCombatState(campaignId).active) return refuseRequest(socket, ack, 'Concentration is kept during combat');
      let summary: string;
      if (end) {
        const was = concentrationOf(campaignId, tokenId);
        if (!was) return refuseRequest(socket, ack, `${token.name} is not concentrating`);
        endConcentration(campaignId, tokenId);
        summary = `${token.name} ends concentration on ${was}`;
      } else {
        const sheet = await sheetOf(token, campaignId);
        const known = sheet ? concentrationSpellsOf(sheet as SheetSpellcasting) : [];
        const chosen = known.find((name) => name.toLowerCase() === spell!.toLowerCase());
        if (!chosen) return refuseRequest(socket, ack, `${token.name} has no concentration spell called ${spell}`);
        const was = concentrationOf(campaignId, tokenId);
        startConcentration(campaignId, tokenId, chosen);
        summary = `${token.name} concentrates on ${chosen}${was && was !== chosen ? `, ending ${was}` : ''}`;
      }
      await resendInitiativeState(io, campaignId);
      ack?.({ ok: true, summary });
      logger.debug('combat.concentrate', { campaignId, tokenId, end: end === true });
    } catch (error) {
      logger.error('combat.concentrate failed', { err: error });
      refuseRequest(socket, ack, 'Failed to change the concentration');
    }
  });

  /**
   * COMBAT.HEAL — A caster casts one of its healing spells (Cure Wounds, Healing Word, …, by its place in `combat.actions`) on a creature within the spell's range, at a slot level: the server rolls the spell's dice plus the caster's spellcasting modifier, restores that many Hit Points to the creature's sheet or token (a character healed from 0 starts its death saves afresh), spends the slot, spends the action or the Bonus Action on the caster's turn, and records the roll in the dice log. The DM, or the player who controls the caster; a player may not target a hidden token.
   */
  socket.on('combat.heal', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.heal', ack)) return;
      const parsed = CombatHealSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { casterId, targetId, action: actionIndex, slotLevel } = parsed.data;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const tokens = readTokens(map.tokens);
      const caster = tokens.find((t) => t.id === casterId);
      if (!caster || !canControlToken(socket.role, caster.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      const target = tokens.find((t) => t.id === targetId);
      if (!target || target.layer !== caster.layer || (socket.role !== 'DM' && hiddenFromPlayers(target))) {
        return refuseRequest(socket, ack, 'That creature is not on the map');
      }
      const sheet = await sheetOf(caster, campaignId);
      const listed = actionsOf(caster, sheet)[actionIndex];
      if (!listed?.heal) return refuseRequest(socket, ack, 'That is not a healing spell the caster has');
      const cast = castWithSlot(sheet as SheetSpellcasting | null, listed, slotLevel);
      if ('error' in cast) return refuseRequest(socket, ack, cast.error);
      const action = cast.action;
      const heal = action.heal ?? listed.heal;
      const board = {
        heights: readTileHeights(map.tileHeights),
        feetPerSquare: map.feetPerSquare,
        diagonalRule: map.diagonalRule === 'alternating' ? ('alternating' as const) : ('flat' as const),
      };
      const reach = action.rangeFeet ?? 5;
      if (target.id !== caster.id && distanceFeet(standing(caster), standing(target), board) > reach) {
        return refuseRequest(socket, ack, `${target.name} is beyond the ${reach} ft range of ${action.name}`);
      }
      const combat = getCombatState(campaignId);
      const ownTurn = someoneActing(combat) && combat.currentTokenId === casterId && combat.turn !== null;
      if (ownTurn && action.cost === 'bonusAction' && combat.turn!.bonusAction && socket.role !== 'DM') {
        return refuseRequest(socket, ack, `${caster.name} has used its Bonus Action this turn`);
      }

      const undo = await prepareUndo(campaignId, map.id, [caster.characterId, target.characterId]);
      if (cast.slotLevel !== null && !(await spendSlot(campaignId, socket.userId, caster.characterId!, cast.slotLevel))) {
        return refuseRequest(socket, ack, `No level ${cast.slotLevel} spell slot left to cast ${action.name}`);
      }
      const rolled = rollDamage({ count: heal.roll.count, sides: heal.roll.sides, bonus: heal.bonus });
      await healToken(io, campaignId, map.id, target, rolled.total);
      if (action.cost === 'bonusAction') {
        if (ownTurn) spendBonusAction(campaignId, casterId);
        await resendInitiativeState(io, campaignId);
      } else await spendAction(io, campaignId, casterId, 'Magic');

      const expression = `${heal.roll.count}d${heal.roll.sides}${heal.bonus < 0 ? '-' : '+'}${Math.abs(heal.bonus)}`;
      const summary = `${action.name} (level ${cast.slotLevel ?? action.spell?.level ?? 0}): ${target.name} regains ${rolled.total} Hit Points`;
      await logRoll(
        io,
        socket,
        campaignId,
        {
          expression,
          total: rolled.total,
          breakdown: {
            expression,
            rolls: [
              { type: 'dice' as const, notation: `${heal.roll.count}d${heal.roll.sides}`, count: rolled.dice.length, sides: heal.roll.sides, results: rolled.dice, kept: rolled.dice, total: rolled.dice.reduce((sum, die) => sum + die, 0) },
              { type: 'modifier' as const, value: heal.bonus },
            ],
            total: rolled.total,
            formula: `[${rolled.dice.join(', ')}] ${heal.bonus < 0 ? '-' : '+'} ${Math.abs(heal.bonus)} = ${rolled.total}`,
          },
        },
        caster.name,
        summary,
        hiddenFromPlayers(caster) || hiddenFromPlayers(target)
      );
      commitUndo(campaignId, undo, summary);
      ack?.({ ok: true, summary, healed: rolled.total });
      logger.debug('combat.heal', { campaignId, casterId, targetId, healed: rolled.total });
    } catch (error) {
      logger.error('combat.heal failed', { err: error });
      refuseRequest(socket, ack, 'Failed to cast the healing spell');
    }
  });

  /**
   * COMBAT.UNDO — The DM undoes the last combat action the server resolved (an attack, a save, a heal, a fall or a class feature; five are kept): the Hit Points and conditions of the map's tokens, the sheets of the characters it touched and the combat state go back to what they were before it. Its roll stays in the dice log. The DM only.
   */
  socket.on('combat.undo', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.undo', ack)) return;
      if (socket.role !== 'DM') return refuseRequest(socket, ack, 'Only the DM can undo');
      const parsed = CombatUndoSchema.safeParse(data ?? {});
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const last = takeLastUndo(campaignId);
      if (!last) return refuseRequest(socket, ack, 'There is no combat action to undo');

      const { map, characters } = await restoreSnapshot(campaignId, last);
      if (map) await bestEffort('map after an undo', () => broadcastMapData(io, campaignId, map as unknown as Parameters<typeof broadcastMapData>[2]));
      for (const character of characters) {
        const hp = extractCharacterHp(DND, (character.data ?? {}) as Record<string, unknown>);
        if (hp) io.to(campaignId).emit('character.hp.updated', { characterId: character.id, hp });
        await bestEffort('sheet after an undo', () =>
          emitCharacterUpdated(campaignId, character, { characterId: character.id, userId: character.userId, tokensChanged: false })
        );
      }
      await resendInitiativeState(io, campaignId);
      const summary = `Undone: ${last.summary}`;
      ack?.({ ok: true, summary, left: undoCount(campaignId) });
      logger.debug('combat.undo', { campaignId });
    } catch (error) {
      logger.error('combat.undo failed', { err: error });
      refuseRequest(socket, ack, 'Failed to undo');
    }
  });

  /**
   * COMBAT.SAVE — Use an action or spell that calls for a saving throw against one or more tokens on the current map: the server rolls the damage once and a save for each target with its own conditions and cover, applies full, half or no damage to each one's hit points and records the roll in the dice log. The DM, or the player who controls the acting token; a player may not target a hidden token.
   */
  socket.on('combat.save', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.save', ack)) return;
      const parsed = CombatSaveSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { sourceId, targetIds, action: actionIndex, slotLevel, point } = parsed.data;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const tokens = readTokens(map.tokens);
      const sourceToken = tokens.find((t) => t.id === sourceId);
      if (!sourceToken || !canControlToken(socket.role, sourceToken.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      const targetTokens: Token[] = [];
      for (const id of targetIds) {
        const token = tokens.find((t) => t.id === id);
        if (!token || token.layer !== sourceToken.layer || (socket.role !== 'DM' && hiddenFromPlayers(token))) {
          return refuseRequest(socket, ack, 'That target is not on the map');
        }
        targetTokens.push(token);
      }

      const sourceSheet = await sheetOf(sourceToken, campaignId);
      const listed = actionsOf(sourceToken, sourceSheet)[actionIndex];
      if (!listed) return refuseRequest(socket, ack, 'That action is not one the creature has');
      if (listed.recharge && spentRecharges(campaignId, sourceId).includes(listed.name)) {
        return refuseRequest(socket, ack, `${sourceToken.name}'s ${listed.name} has not recharged`);
      }
      if (listed.cost === 'legendary') {
        const refusal = legendaryRefusal(campaignId, sourceToken);
        if (refusal) return refuseRequest(socket, ack, refusal);
      }
      const cast = castWithSlot(sourceSheet as SheetSpellcasting | null, listed, slotLevel);
      if ('error' in cast) return refuseRequest(socket, ack, cast.error);
      let action = cast.action;
      if (!action.save) return refuseRequest(socket, ack, `${action.name} calls for no saving throw the VTT can make`);
      // An area aimed at an empty square: the square must be within the action's range.
      if (point) {
        if (!action.area) return refuseRequest(socket, ack, `${action.name} has no area to aim at a square`);
        const away = distanceFeet(standing(sourceToken), { cell: point, size: { width: 1, height: 1 } }, {
          heights: readTileHeights(map.tileHeights),
          feetPerSquare: map.feetPerSquare,
          diagonalRule: map.diagonalRule === 'alternating' ? 'alternating' : 'flat',
        });
        if (action.rangeFeet !== undefined && action.rangeFeet > 0 && away > action.rangeFeet) {
          return refuseRequest(socket, ack, `That square is ${away} ft away, beyond the range of ${action.name} (${action.rangeFeet} ft)`);
        }
      }

      const targetSheets = await Promise.all(targetTokens.map((token) => sheetOf(token, campaignId)));
      // A grapple or a shove is against one creature no more than a size larger, which saves with the better of its Strength and Dexterity.
      if (action.unarmed) {
        if (targetTokens.length !== 1) return refuseRequest(socket, ack, `${action.name} is against one creature`);
        const [only] = targetTokens;
        if (!canWrestle(sourceToken.size?.width ?? 1, only.size?.width ?? 1)) {
          return refuseRequest(socket, ack, `${only.name} is too large for ${sourceToken.name} to ${action.unarmed === 'grapple' ? 'grapple' : 'shove'}`);
        }
        const strength = saveBonusOf(only, targetSheets[0], 'str');
        const dexterity = saveBonusOf(only, targetSheets[0], 'dex');
        action = { ...action, save: { ...action.save, ability: (dexterity ?? -99) > (strength ?? -99) ? 'dex' : 'str' } };
      }
      const ability = action.save!.ability;
      const involved = new Set([sourceId, ...targetIds]);
      const result = resolveSave({
        source: combatant(sourceToken, sourceSheet),
        targets: targetTokens.map((token, index) => ({
          ...combatant(token, targetSheets[index], getCombatState(campaignId).dodging, isRaging(campaignId, token.id)),
          saveBonus: saveBonusOf(token, targetSheets[index], ability),
        })),
        action,
        board: {
          heights: readTileHeights(map.tileHeights),
          feetPerSquare: map.feetPerSquare,
          diagonalRule: map.diagonalRule === 'alternating' ? 'alternating' : 'flat',
          others: tokens
            .filter((t) => !involved.has(t.id) && t.layer === sourceToken.layer && !(t.hp && t.hp.current <= 0))
            .map(standing),
        },
      });
      if (!result.ok) return refuseRequest(socket, ack, result.reason);
      const undo = await prepareUndo(campaignId, map.id, [sourceToken.characterId, ...targetTokens.map((t) => t.characterId)]);
      if (cast.slotLevel !== null && !(await spendSlot(campaignId, socket.userId, sourceToken.characterId!, cast.slotLevel))) {
        return refuseRequest(socket, ack, `No level ${cast.slotLevel} spell slot left to cast ${action.name}`);
      }

      spendRecharge(campaignId, sourceId, action);
      const concentrating = action.spell ? findSpell(action.name) : null;
      if (concentrating?.concentration) startConcentration(campaignId, sourceId, concentrating.name);
      const endured = await applyDealt(
        io,
        campaignId,
        map.id,
        result.targets.map((target, index) => ({ token: targetTokens[index], sheet: targetSheets[index], dealt: target.dealt, hp: target.hp }))
      );
      // A stat block's effect can leave a condition on each creature that fails.
      const riders: string[] = [];
      if (action.source === 'statBlock') {
        const written = conditionsOnFailure(action.text ?? '');
        for (const [index, target] of result.targets.entries()) {
          if (!target.outcome.success && !target.dropped) riders.push(
            ...(await applyRiders(io, campaignId, map.id, sourceToken, targetTokens[index], written, action.save ? { ability: action.save.ability, dc: action.save.dc } : undefined))
          );
        }
      }
      // What a failed save against an Unarmed Strike leaves the target with.
      let summary = [result.summary, ...riders, ...endured].join('; ');
      if (action.unarmed && !result.targets[0].outcome.success) {
        const [only] = targetTokens;
        if (action.unarmed === 'grapple') await giveCondition(io, campaignId, map.id, only.id, 'Grappled');
        if (action.unarmed === 'prone') await giveCondition(io, campaignId, map.id, only.id, 'Prone');
        const moved = action.unarmed === 'push' ? await pushToken(io, campaignId, map, sourceToken, only) : false;
        summary +=
          action.unarmed === 'grapple'
            ? `: ${only.name} is Grappled (escape DC ${result.dc})`
            : action.unarmed === 'prone'
              ? `: ${only.name} is knocked Prone`
              : moved
                ? `: ${only.name} is pushed 5 ft`
                : `: ${only.name} has nowhere to be pushed`;
      }
      if (listed.cost === 'legendary') {
        spendLegendary(campaignId, sourceId);
        await resendInitiativeState(io, campaignId);
      } else if (action.unarmed) await spendAction(io, campaignId, sourceId, 'Attack', true);
      else await spendAction(io, campaignId, sourceId, action.source === 'spell' ? 'Magic' : action.name);
      const secret = hiddenFromPlayers(sourceToken) || targetTokens.some(hiddenFromPlayers);
      await logRoll(io, socket, campaignId, saveBreakdown(result, action), sourceToken.name, summary, secret);
      commitUndo(campaignId, undo, summary);

      if (ack) {
        ack({
          ok: true,
          summary,
          dc: result.dc,
          ability: result.ability,
          targets: result.targets.map((target, index) => ({
            tokenId: targetIds[index],
            saved: target.outcome.success,
            total: target.outcome.roll?.total ?? null,
            dealt: target.dealt,
          })),
        });
      }
      logger.debug('combat.save', { campaignId, sourceId, targets: targetIds.length });
    } catch (error) {
      logger.error('combat.save failed', { err: error });
      refuseRequest(socket, ack, 'Failed to resolve the saving throw');
    }
  });

  /**
   * COMBAT.DEATHSAVE — Roll a death saving throw for the character a token is bound to, at 0 Hit Points: the server rolls the d20, marks the success or failure on the sheet (two failures on a 1), revives the character with 1 Hit Point on a 20, and records the roll in the dice log. The DM, or the player who controls the token.
   */
  socket.on('combat.deathSave', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.deathSave', ack)) return;
      const parsed = CombatDeathSaveSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const token = readTokens(map.tokens).find((t) => t.id === parsed.data.tokenId);
      if (!token || !canControlToken(socket.role, token.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      const characterId = token.characterId;
      if (!characterId || !(await sheetOf(token, campaignId))) {
        return refuseRequest(socket, ack, `${token.name} has no D&D character sheet to keep death saves on`);
      }

      // Rolled and written under the row lock, so two rolls sent at once count as two.
      const rolled = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
        const fresh = await tx.character.findUnique({ where: { id: characterId } });
        const sheet = (fresh?.data ?? null) as Record<string, unknown> | null;
        const hp = extractCharacterHp(DND, sheet);
        if (!fresh || !sheet || !hp) return { refusal: `${token.name} tracks no Hit Points` };
        const saves = readDeathSaves(sheet.deathSaves);
        if (!isDying(hp.current, saves)) {
          return { refusal: hp.current > 0 ? `${token.name} is not at 0 Hit Points` : `${token.name} has no more death saves to make` };
        }
        const outcome = deathSavingThrow(saves, hasLuck(sheet) ? lucky(rollDie) : rollDie);
        const revived = outcome.result === 'revived';
        const next = { ...sheet, deathSaves: outcome.saves, ...(revived ? { hp: { ...(sheet.hp as object), current: 1 } } : {}) };
        const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(next) } });
        return { outcome, updated, hp: revived ? { current: 1, max: hp.max, temp: hp.temp } : null };
      });
      if ('refusal' in rolled) return refuseRequest(socket, ack, rolled.refusal!);

      const { outcome, updated } = rolled;
      await bestEffort('sheet after a death save', () =>
        emitCharacterUpdated(campaignId, updated, { characterId, userId: updated.userId, tokensChanged: false })
      );
      if (rolled.hp) io.to(campaignId).emit('character.hp.updated', { characterId, hp: rolled.hp });

      const verdict =
        outcome.result === 'revived'
          ? 'a 20: back up with 1 Hit Point'
          : outcome.result === 'dead'
            ? `${outcome.natural === 1 ? 'a 1, two failures' : 'failure'}: dead`
            : outcome.result === 'stable'
              ? 'success: Stable'
              : `${outcome.natural >= 10 ? 'success' : outcome.natural === 1 ? 'a 1, two failures' : 'failure'} (${outcome.saves.successes} successes, ${outcome.saves.failures} failures)`;
      const summary = `${token.name} death save: ${verdict}`;
      await logRoll(
        io,
        socket,
        campaignId,
        {
          expression: '1d20',
          total: outcome.natural,
          breakdown: {
            expression: '1d20',
            rolls: [{ type: 'dice' as const, notation: '1d20', count: 1, sides: 20, results: [outcome.natural], kept: [outcome.natural], total: outcome.natural }],
            total: outcome.natural,
            formula: `[${outcome.natural}] = ${outcome.natural}`,
          },
        },
        token.name,
        summary,
        hiddenFromPlayers(token)
      );
      if (ack) ack({ ok: true, summary, natural: outcome.natural, result: outcome.result, saves: outcome.saves });
    } catch (error) {
      logger.error('combat.deathSave failed', { err: error });
      refuseRequest(socket, ack, 'Failed to roll the death save');
    }
  });
}

function answer(ack: SocketAck | null, result: AttackResult): void {
  if (!ack) return;
  ack({
    ok: true,
    summary: result.summary,
    hit: result.outcome.hit,
    critical: result.outcome.critical,
    dealt: result.dealt,
    distanceFeet: result.distanceFeet,
    cover: result.cover,
    reasons: result.reasons,
  });
}
