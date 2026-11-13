/**
 * Combat resolution: the server makes an attack for a token, by the D&D
 * rules, and applies what it does.
 *
 * The attacker's attacks come from its character sheet or its stat block;
 * the target's Armor Class and hit points from its own. Distance and cover
 * are worked out on the map as it is stored, with the same code the tactical
 * view shows them with. The roll is recorded in the dice log like any other.
 */

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
import { getState as getCombatState, setState as setCombatState, someoneActing, type WeaponMark } from '../initiativeState';
import { resendInitiativeState } from './initiative';
import { applyHpDelta } from './characters';
import { CombatActionsSchema, CombatAttackSchema, CombatCheckSchema, CombatDeathSaveSchema, CombatFallSchema, CombatRestSchema, CombatStandSchema, CombatSaveSchema } from '../../validators/combat';
import { actionsFromSheet, actionsFromStatBlock, defencesFromStatBlock, type AreaOfEffect, type CombatAction, type DamageComponent, type SheetAttack } from '../../rules/dnd/actions';
import { castWithSlot, slotsLeft, spellActionsFromSheet, withSlotSpent, type SheetSpellcasting } from '../../rules/dnd/spells';
import { resolveSave, type SaveResult } from '../../rules/dnd/resolveSave';
import { canAct, DODGING, effectiveSpeed, readConditions, saveModifiers, type Ability } from '../../rules/dnd/conditions';
import { savingThrow } from '../../rules/dnd/d20';
import { leavesReachOf, sideOf } from '../../rules/dnd/opportunity';
import { resolveFall } from '../../rules/dnd/falling';
import { longRest, spendHitDie } from '../../rules/dnd/rests';
import { canWrestle, proficiencyBonusForChallenge, pushedTo, unarmedActions } from '../../rules/dnd/unarmed';
import { challengeNumber } from '../../rules/dnd/monsters';
import { ABILITY_CHECK_NAMES, HIDE_DC, passiveScore, resolveCheck, SKILL_CHECKS, type SkillCheck } from '../../rules/dnd/checks';
import { adjustedDamage, applyDamage, DAMAGE_TYPES, type DamageType, type Defences, type HitPoints } from '../../rules/dnd/damage';
import { hasWeaponMastery, masteryEffect, weaponModifier } from '../../rules/dnd/masteries';
import { deathSavesAfterDamage, deathSavingThrow, isDying, readDeathSaves } from '../../rules/dnd/deathSaves';
import { attacksPerAction, featureOptions, readFeatures } from '../../rules/dnd/featureEffects';
import { resolveAttack, type AttackResult, type Combatant } from '../../rules/dnd/resolveAttack';
import type { Standing } from '../../utils/boardSight';

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

function summarizeAction(action: CombatAction, index: number, slots: Record<number, number>): ActionSummary {
  const attack = action.attack;
  return {
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

/** A token as the rules see it. */
function combatant(token: Token, sheet: Record<string, unknown> | null, dodging: readonly string[] = []): Combatant {
  const block = (token.statBlock ?? null) as { ac?: unknown } | null;
  const sheetAc = sheet && typeof sheet.armorClass === 'number' ? sheet.armorClass : null;
  const blockAc = block && typeof block.ac === 'number' ? block.ac : null;
  const exhaustion = sheet && typeof sheet.exhaustionLevel === 'number' ? sheet.exhaustionLevel : undefined;
  return {
    name: token.name,
    standing: standing(token),
    armorClass: sheet ? sheetAc : blockAc,
    hp: sheet ? extractCharacterHp(DND, sheet) : (token.hp ?? null),
    conditions: dodging.includes(token.id) ? [...(token.conditions ?? []), DODGING] : (token.conditions ?? []),
    exhaustion,
    scores: sheet ? { str: scoreOf(sheet, 'strength'), dex: scoreOf(sheet, 'dexterity') } : undefined,
    defences: sheet ? undefined : defencesFromStatBlock((token.statBlock ?? {}) as Parameters<typeof defencesFromStatBlock>[0]),
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

/** Take damage from each target's hit points, on its sheet or on its token, and tell the table. */
async function applyDealt(
  io: Server,
  campaignId: string,
  mapId: string,
  hits: ReadonlyArray<{ token: Token; sheet: Record<string, unknown> | null; dealt: number; hp: HitPoints | null; critical?: boolean }>
): Promise<void> {
  const onTokens = new Map<string, HitPoints>();
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
        // Damage at 0 Hit Points is a failed death save; dropping to 0 starts them afresh.
        const sheet = (fresh.data ?? {}) as Record<string, unknown>;
        const before = extractCharacterHp(DND, sheet)?.current ?? 0;
        const saves = deathSavesAfterDamage(readDeathSaves(sheet.deathSaves), before, change.hp.current, hit.critical === true);
        const data = saves ? { ...change.data, deathSaves: saves } : change.data;
        const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(data) } });
        return { hp: change.hp, sheetChanged: saves ? updated : null };
      });
      if (applied) io.to(campaignId).emit('character.hp.updated', { characterId, hp: applied.hp });
      if (applied?.sheetChanged) {
        const changed = applied.sheetChanged;
        await bestEffort('sheet after a failed death save', () =>
          emitCharacterUpdated(campaignId, changed, { characterId, userId: changed.userId, tokensChanged: false })
        );
      }
    } else if (hit.hp) {
      onTokens.set(hit.token.id, hit.hp);
    }
  }
  if (onTokens.size === 0) return;
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
function addMark(campaignId: string, mark: { kind: 'sap' | 'slow' | 'vex'; attackerId: string; targetId: string }): void {
  const combat = getCombatState(campaignId);
  if (!combat.active) return;
  const own = combat.currentTokenId === mark.attackerId;
  const others = combat.marks.filter(
    (kept) =>
      !(kept.kind === mark.kind && kept.targetId === mark.targetId && (mark.kind === 'slow' || kept.attackerId === mark.attackerId))
  );
  combat.marks = [...others, { ...mark, turnEndsLeft: mark.kind === 'vex' && own ? 2 : 1 }];
  setCombatState(campaignId, combat);
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
  map: { id: string; tileHeights: unknown; feetPerSquare: number; diagonalRule: string },
  tokens: Token[],
  moverId: string,
  from: { x: number; y: number }
): Promise<void> {
  const before = getCombatState(campaignId);
  if (!someoneActing(before) || before.currentTokenId !== moverId || before.turn?.action === 'Disengage') return;
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
      const unseen = state.has.has('blinded') || (side === 'party' && hiddenFromPlayers(mover));
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
  if (!someoneActing(combat) || combat.currentTokenId !== moverId || combat.turn?.action === 'Disengage') return;
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
   * COMBAT.ACTIONS — List the actions of a token on the current map: its character's attacks and spells or its stat block's actions, with what the server can roll for each. Answered through the acknowledgement. The DM, or the player who controls the token.
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
          actions: actionsOf(token, sheet).map((action, index) => summarizeAction(action, index, slots)),
          // A stat block's Multiattack says how many attacks it makes; a character's features do.
          attacksPerAction: sheet ? attacksPerAction(features) : null,
          features: featureOptions(features),
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
   * COMBAT.ATTACK — Make one attack from a token against another on the current map: the server checks reach, range and cover, rolls against Armor Class with the conditions of both, applies the damage to the target's hit points and records the roll in the dice log. With `opportunity: true` it is the Opportunity Attack the target's movement offered the attacker: one melee attack, with the attacker's reaction, against the target where it stood before it left reach. The DM, or the player who controls the attacker; a player may not target a hidden token.
   */
  socket.on('combat.attack', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.attack', ack)) return;
      const parsed = CombatAttackSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid attack');
      const { attackerId, targetId, action: actionIndex, mode, slotLevel, opportunity } = parsed.data;

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
      const cast = castWithSlot(attackerSheet as SheetSpellcasting | null, listed, slotLevel);
      if ('error' in cast) return refuseRequest(socket, ack, cast.error);
      const action = cast.action;

      // On its own turn a character makes as many attacks with the Attack
      // action as its features give it. A spell is the Magic action, and a
      // stat block's Multiattack is the DM's to follow. The DM may go past
      // the count, as they may overrule anything.
      const turnNow = getCombatState(campaignId);
      const acting = someoneActing(turnNow) && turnNow.currentTokenId === attackerId ? turnNow.turn : null;
      const weapon = action.source !== 'spell';
      const allowed = attackerSheet ? attacksPerAction(readFeatures(attackerSheet)) : null;
      if (acting && weapon && allowed !== null && acting.action === 'Attack' && acting.attacks >= allowed && socket.role !== 'DM') {
        return refuseRequest(
          socket,
          ack,
          `${attackerToken.name} has made its ${allowed === 1 ? 'attack' : `${allowed} attacks`} with the Attack action this turn`
        );
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
      const target = combatant(targetToken, targetSheet, turnNow.dodging);

      // A Vex the attacker holds on this target, and a Sap on the attacker, are used by this roll.
      const vexed = turnNow.marks.find((mark) => mark.kind === 'vex' && mark.attackerId === attackerId && mark.targetId === targetId);
      const sapped = turnNow.marks.find((mark) => mark.kind === 'sap' && mark.targetId === attackerId);
      const extraReasons = [
        ...(vexed ? [`Advantage: Vex (${attackerToken.name}'s last hit)`] : []),
        ...(sapped ? ['Disadvantage: Sapped'] : []),
      ];

      const result = resolveAttack({
        extraReasons,
        attacker: combatant(attackerToken, attackerSheet),
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
      // The slot goes before the damage: a cast that finds it gone changes nothing.
      if (cast.slotLevel !== null && !(await spendSlot(campaignId, socket.userId, attackerToken.characterId!, cast.slotLevel))) {
        return refuseRequest(socket, ack, `No level ${cast.slotLevel} spell slot left to cast ${action.name}`);
      }

      await applyDealt(io, campaignId, map.id, [{ token: targetToken, sheet: targetSheet, dealt: result.dealt, hp: result.hp, critical: result.outcome.critical }]);
      if (vexed || sapped) useMarks(campaignId, [vexed, sapped]);
      const mastered = await applyMastery(io, campaignId, map, action, attackerToken, attackerSheet, targetToken, targetSheet, result, target.defences);
      if (offer) await spendReaction(io, campaignId, attackerId);
      else await spendAction(io, campaignId, attackerId, weapon ? 'Attack' : 'Magic', weapon);
      // An attack by or on a token the players are not shown goes to the DM alone.
      const secret = hiddenFromPlayers(attackerToken) || hiddenFromPlayers(targetToken);
      const summary = mastered ? `${result.summary}; ${mastered}` : result.summary;
      await logRoll(io, socket, campaignId, breakdownOf(result), attackerToken.name, summary, secret);

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

      await applyDealt(io, campaignId, map.id, [{ token, sheet, dealt: result.dealt, hp: result.hp }]);
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
        result.summary,
        hiddenFromPlayers(token)
      );

      ack?.({ ok: true, summary: result.summary, feet, dealt: result.dealt, prone: result.prone });
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
      const { tokenId, ability, hide, mode } = parsed.data;
      const skill = hide ? 'stealth' : parsed.data.skill;
      const dc = hide ? HIDE_DC : parsed.data.dc;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const token = readTokens(map.tokens).find((t) => t.id === tokenId);
      if (!token || !canControlToken(socket.role, token.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      const sheet = await sheetOf(token, campaignId);
      const creature = combatant(token, sheet);
      const state = readConditions(creature.conditions, creature.exhaustion);
      if (hide && !canAct(state)) return refuseRequest(socket, ack, `${token.name} is Incapacitated and cannot take the Hide action`);

      const bonus = skill ? skillBonusOf(token, sheet, skill) : abilityModifierOf(token, sheet, ability!);
      if (bonus === null) return refuseRequest(socket, ack, `${token.name} has no sheet or stat block to make the check with`);
      const label = skill
        ? `${ABILITY_CHECK_NAMES[SKILL_CHECKS[skill].ability]} (${SKILL_CHECKS[skill].name})`
        : ABILITY_CHECK_NAMES[ability!];
      const result = resolveCheck({ name: token.name, label, bonus, dc, mode, conditions: state });

      const hidden = hide === true && result.success === true;
      if (hidden) await giveCondition(io, campaignId, map.id, tokenId, 'Invisible');
      if (hide) await spendAction(io, campaignId, tokenId, 'Hide');
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
        if (kind === 'long') {
          const long = longRest(sheet);
          const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(long.sheet) } });
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
      const { sourceId, targetIds, action: actionIndex, slotLevel } = parsed.data;

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
      const cast = castWithSlot(sourceSheet as SheetSpellcasting | null, listed, slotLevel);
      if ('error' in cast) return refuseRequest(socket, ack, cast.error);
      let action = cast.action;
      if (!action.save) return refuseRequest(socket, ack, `${action.name} calls for no saving throw the VTT can make`);

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
          ...combatant(token, targetSheets[index], getCombatState(campaignId).dodging),
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
      if (cast.slotLevel !== null && !(await spendSlot(campaignId, socket.userId, sourceToken.characterId!, cast.slotLevel))) {
        return refuseRequest(socket, ack, `No level ${cast.slotLevel} spell slot left to cast ${action.name}`);
      }

      await applyDealt(
        io,
        campaignId,
        map.id,
        result.targets.map((target, index) => ({ token: targetTokens[index], sheet: targetSheets[index], dealt: target.dealt, hp: target.hp }))
      );
      // What a failed save against an Unarmed Strike leaves the target with.
      let summary = result.summary;
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
      if (action.unarmed) await spendAction(io, campaignId, sourceId, 'Attack', true);
      else await spendAction(io, campaignId, sourceId, action.source === 'spell' ? 'Magic' : action.name);
      const secret = hiddenFromPlayers(sourceToken) || targetTokens.some(hiddenFromPlayers);
      await logRoll(io, socket, campaignId, saveBreakdown(result, action), sourceToken.name, summary, secret);

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
        const outcome = deathSavingThrow(saves);
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
