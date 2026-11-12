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
import { bestEffort, campaignSockets, stillInCampaign } from '../utils';
import { getState as getCombatState, setState as setCombatState, someoneActing } from '../initiativeState';
import { resendInitiativeState } from './initiative';
import { applyHpDelta } from './characters';
import { CombatActionsSchema, CombatAttackSchema } from '../../validators/combat';
import { actionsFromSheet, actionsFromStatBlock, defencesFromStatBlock, type CombatAction, type SheetAttack } from '../../rules/dnd/actions';
import { spellActionsFromSheet, type SheetSpellcasting } from '../../rules/dnd/spells';
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
}

const standing = (token: Token): Standing => ({
  cell: { x: Math.floor(token.position.x), y: Math.floor(token.position.y) },
  size: { width: token.size?.width ?? 1, height: token.size?.height ?? 1 },
});

function damageText(action: CombatAction): string {
  return (action.attack?.damage ?? [])
    .map(({ roll, type }) => {
      const dice = roll.count > 0 ? `${roll.count}d${roll.sides}` : '';
      const bonus = roll.bonus ? (dice ? `${roll.bonus > 0 ? '+' : '-'}${Math.abs(roll.bonus)}` : String(roll.bonus)) : '';
      return `${dice}${bonus}${type ? ` ${type}` : ''}`.trim();
    })
    .filter(Boolean)
    .join(' + ');
}

function summarizeAction(action: CombatAction, index: number): ActionSummary {
  const attack = action.attack;
  return {
    index,
    name: action.name,
    cost: action.cost,
    attack: attack
      ? { kind: attack.kind, bonus: attack.bonus, reachFeet: attack.reachFeet, rangeFeet: attack.rangeFeet, damage: damageText(action) }
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
  if (sheet) {
    return [
      ...actionsFromSheet({ attacks: (sheet.attacks ?? []) as SheetAttack[] }),
      ...spellActionsFromSheet(sheet as SheetSpellcasting),
    ];
  }
  return token.statBlock ? actionsFromStatBlock(token.statBlock as Parameters<typeof actionsFromStatBlock>[0]) : [];
}

/** A token as the rules see it. */
function combatant(token: Token, sheet: Record<string, unknown> | null): Combatant {
  const block = (token.statBlock ?? null) as { ac?: unknown } | null;
  const sheetAc = sheet && typeof sheet.armorClass === 'number' ? sheet.armorClass : null;
  const blockAc = block && typeof block.ac === 'number' ? block.ac : null;
  const exhaustion = sheet && typeof sheet.exhaustionLevel === 'number' ? sheet.exhaustionLevel : undefined;
  return {
    name: token.name,
    standing: standing(token),
    armorClass: sheet ? sheetAc : blockAc,
    hp: sheet ? extractCharacterHp(DND, sheet) : (token.hp ?? null),
    conditions: token.conditions ?? [],
    exhaustion,
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
      const actions = actionsOf(token, await sheetOf(token, socket.campaignId));
      if (ack) ack({ ok: true, actions: actions.map(summarizeAction) });
    } catch (error) {
      logger.error('combat.actions failed', { err: error });
      refuseRequest(socket, ack, 'Failed to list actions');
    }
  });

  /**
   * COMBAT.ATTACK — Make one attack from a token against another on the current map: the server checks reach, range and cover, rolls against Armor Class with the conditions of both, applies the damage to the target's hit points and records the roll in the dice log. The DM, or the player who controls the attacker; a player may not target a hidden token.
   */
  socket.on('combat.attack', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.attack', ack)) return;
      const parsed = CombatAttackSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid attack');
      const { attackerId, targetId, action: actionIndex, mode } = parsed.data;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const tokens = readTokens(map.tokens);
      const attackerToken = tokens.find((t) => t.id === attackerId);
      const targetToken = tokens.find((t) => t.id === targetId);
      if (!attackerToken || !canControlToken(socket.role, attackerToken.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only attack with your own token');
      }
      // A player is told the same of a token that is hidden as of one that is not there.
      const hiddenFromPlayers = (t: Token) => t.visible === false || t.obscured === true;
      if (!targetToken || targetToken.layer !== attackerToken.layer || (socket.role !== 'DM' && hiddenFromPlayers(targetToken))) {
        return refuseRequest(socket, ack, 'That target is not on the map');
      }

      const [attackerSheet, targetSheet] = await Promise.all([sheetOf(attackerToken, campaignId), sheetOf(targetToken, campaignId)]);
      const action = actionsOf(attackerToken, attackerSheet)[actionIndex];
      if (!action) return refuseRequest(socket, ack, 'That action is not one the attacker has');

      const result = resolveAttack({
        attacker: combatant(attackerToken, attackerSheet),
        target: combatant(targetToken, targetSheet),
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

      // ── Apply the damage ────────────────────────────────────────────────
      if (result.dealt > 0 && targetToken.characterId && targetSheet) {
        const characterId = targetToken.characterId;
        const applied = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
          const fresh = await tx.character.findUnique({ where: { id: characterId }, select: { data: true } });
          if (!fresh) return null;
          const change = applyHpDelta(DND, fresh.data, -result.dealt);
          if ('error' in change) return null;
          await tx.character.update({ where: { id: characterId }, data: { data: toJson(change.data) } });
          return change.hp;
        });
        if (applied) io.to(campaignId).emit('character.hp.updated', { characterId, hp: applied });
      } else if (result.dealt > 0 && result.hp) {
        const hp = result.hp;
        const updated = await withMapsLocked([map.id], async (tx) => {
          const fresh = await tx.map.findUnique({ where: { id: map.id } });
          if (!fresh) return null;
          const list = readTokens(fresh.tokens);
          const target = list.find((t) => t.id === targetId);
          if (!target) return null;
          target.hp = hp;
          return tx.map.update({ where: { id: map.id }, data: { tokens: toJson(list) } });
        });
        if (updated) {
          await bestEffort('map after an attack', () => broadcastMapData(io, campaignId, updated as unknown as Parameters<typeof broadcastMapData>[2]));
        }
      }

      // ── The turn: an attack on its own turn is its action, if it had not taken one ──
      const combat = getCombatState(campaignId);
      if (someoneActing(combat) && combat.currentTokenId === attackerId && combat.turn && combat.turn.action === null) {
        combat.turn = { ...combat.turn, action: 'Attack' };
        setCombatState(campaignId, combat);
      }
      await resendInitiativeState(io, campaignId);

      // ── The dice log ────────────────────────────────────────────────────
      // An attack by or on a token the players are not shown goes to the DM alone.
      const secret = hiddenFromPlayers(attackerToken) || hiddenFromPlayers(targetToken);
      const rolled = breakdownOf(result);
      await bestEffort('attack roll in the dice log', async () => {
        const user = await prisma.user.findUnique({ where: { id: socket.userId! }, select: { displayName: true } });
        const stored = await prisma.diceRoll.create({
          data: {
            campaignId,
            userId: socket.userId!,
            expression: rolled.expression,
            result: rolled.total,
            breakdown: toJson(rolled.breakdown),
            characterName: attackerToken.name,
            purpose: result.summary.slice(0, 200),
            secret,
          },
        });
        const rollData = {
          id: stored.id,
          userId: socket.userId,
          userName: user?.displayName ?? 'Unknown',
          characterName: attackerToken.name,
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

      answer(ack, result);
      logger.debug('combat.attack', { campaignId, attackerId, targetId, hit: result.outcome.hit, dealt: result.dealt });
    } catch (error) {
      logger.error('combat.attack failed', { err: error });
      refuseRequest(socket, ack, 'Failed to resolve the attack');
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
