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
import { CombatActionsSchema, CombatAttackSchema, CombatCheckSchema, CombatDeathSaveSchema, CombatFallSchema, CombatFeatureSchema, CombatRestSchema, CombatStandSchema, CombatSaveSchema, CombatHelpSchema, CombatReadySchema, CombatConcentrateSchema, CombatHealSchema, CombatUndoSchema, CombatReactSchema } from '../../validators/combat';
import { actionsFromSheet, actionsFromStatBlock, defencesFromStatBlock, legendaryUses, type AreaOfEffect, type CombatAction, type DamageComponent, type SheetAttack } from '../../rules/dnd/actions';
import { castWithSlot, concentrationSpellsOf, findSpell, slotsLeft, spellActionsFromSheet, withSlotSpent, type SheetSpellcasting } from '../../rules/dnd/spells';
import { resolveSave, type SaveResult } from '../../rules/dnd/resolveSave';
import { canAct, DODGING, effectiveSpeed, RAGING, readConditions, saveModifiers, type Ability } from '../../rules/dnd/conditions';
import { rollDie, savingThrow } from '../../rules/dnd/d20';
import { leavesReachOf, sideOf } from '../../rules/dnd/opportunity';
import { resolveFall, withSlowFall } from '../../rules/dnd/falling';
import { longRest, spendHitDie } from '../../rules/dnd/rests';
import { bardicDie, classLevel, POINT_RESOURCES, rageDamage, resourcesOf, restoreResources, secondWindBonus, spendResource, type ResourceName } from '../../rules/dnd/resources';
import { canWrestle, proficiencyBonusForChallenge, pushedTo, unarmedActions } from '../../rules/dnd/unarmed';
import { challengeNumber } from '../../rules/dnd/monsters';
import { ABILITY_CHECK_NAMES, HIDE_DC, passiveScore, resolveCheck, SKILL_CHECKS, withInspiration, withStrokeOfLuck, withTacticalMind, type SkillCheck } from '../../rules/dnd/checks';
import { adjustedDamage, applyDamage, concentrationDC, DAMAGE_TYPES, rerollLowest, rollDamage, type DamageType, type Defences, type HitPoints } from '../../rules/dnd/damage';
import { hasWeaponMastery, masteryEffect, weaponModifier } from '../../rules/dnd/masteries';
import { criticalFrom, DEFY_DEATH, duelingBonus, hasRemarkableAthlete, hasStudiedAttacks, hasSurvivor, heroicRally, readInventory, withDamageBonus } from '../../rules/dnd/fighter';
import { deathSavesAfterDamage, deathSavingThrow, isDying, readDeathSaves } from '../../rules/dnd/deathSaves';
import { attacksPerAction, featureName, featureOptions, hasFeature, readFeatures } from '../../rules/dnd/featureEffects';
import { resolveAttack, withExtraDamage, withReaction, withRerolledDamage, type AttackRequest, type AttackResult, type Combatant } from '../../rules/dnd/resolveAttack';
import { distanceFeet, type Standing } from '../../utils/boardSight';
import { sneakAttackDamage, sneakAttackDice } from '../../rules/dnd/sneakAttack';
import { canSmiteWith, divineSmiteDamage, hasDivineSmite } from '../../rules/dnd/smites';
import { deflectReduction } from '../../rules/dnd/reactions';
import { answerPrompt, askReaction } from '../reactionPrompts';
import { isMonkAttack, monkSaveDC } from '../../rules/dnd/stunningStrike';
import {
  flurryStrikes,
  martialArtsDie,
  OPEN_HAND_OPTIONS,
  OPEN_HAND_PUSH_FEET,
  redirectDamage,
  REDIRECT_MELEE_FEET,
  REDIRECT_RANGED_FEET,
  selfRestorable,
  slowFallReduction,
  wholenessOfBodyHealing,
} from '../../rules/dnd/monk';
import { auraFeet, auraImmunities, auraOfProtectionBonus, EXPANDED_AURA_FEET } from '../../rules/dnd/auras';
import {
  ABJURE_FOES_TURNS, canBeSacred, CURE_COST, hasSacredWeapon, layOnHandsCures, paladinChannelActions, radiantStrikes, SACRED_WEAPON_MS,
  sacredWeaponBonus, withSacredWeapon,
} from '../../rules/dnd/paladin';
import { channelDivinityActions, TURN_UNDEAD_TURNS } from '../../rules/dnd/channelDivinity';
import { blessedHealerHealing, discipleOfLifeBonus, divineStrikeDamage, divineStrikeDice, DIVINE_STRIKE_OPTIONS, hasSupremeHealing, preserveLife, rollHealing, withPotentSpellcasting } from '../../rules/dnd/cleric';
import { wildShapeForms, wildShapeOf, wildShapeTemporaryHitPoints } from '../../rules/dnd/wildShape';
import {
  naturesWard,
  PRIMAL_STRIKE_OPTIONS,
  primalStrikeChoice,
  primalStrikeDice,
  shortRestRecovery,
  wildCompanion,
  wildResurgence,
  withDruidFeatures,
} from '../../rules/dnd/druid';
import { carefulCount, distantAction, empoweredCount, knowsMetamagic, METAMAGIC, type CastingMetamagic } from '../../rules/dnd/metamagic';
import { repels, withInvocations } from '../../rules/dnd/invocations';
import { chooseCunningStrike, cunningEffectsOf, CUNNING_LABELS, cunningStrikeDC, hasPoisonersKit, type CunningEffect } from '../../rules/dnd/cunningStrike';
import { BRUTAL_LABELS, brutalStrikeDamage, FORCEFUL_FEET, HAMSTRING_FEET } from '../../rules/dnd/brutalStrike';
import {
  frenzyDamage, hasMindlessRage, hasPersistentRage, hasRetaliation, indomitableMight, intimidatingPresenceActions, mindlessRageBlocks,
  MINDLESS_RAGE_CONDITIONS, PERSISTENT_RAGE_TURNS, primalKnowledgeApplies, relentlessRageApplies, relentlessRageDC, relentlessRageHitPoints,
  withRagesRegained, withRelentlessRageUsed,
} from '../../rules/dnd/barbarian';
import { endure, hasLuck, lucky, speciesResistances } from '../../rules/dnd/species';
import { archeryBonus, greatWeaponFighting, savageAttackerApplies } from '../../rules/dnd/feats';
import { onTurnEnd, onTurnStart } from '../turnHooks';
import { commitUndo, prepareUndo, restoreSnapshot, takeLastUndo, undoCount } from '../combatUndo';
import { multiattackSteps, type MultiattackStep } from '../../rules/dnd/multiattack';
import { hasSteadyAim, hasTurnFeature, steadyAimRefusal, turnFeatureEffect, type TurnFeature } from '../../rules/dnd/bonusActions';
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
  /** Preserve Life, made with `combat.heal` and `shares`: the Hit Points to divide and how far it reaches. */
  divide?: { pool: number; rangeFeet: number };
  /** Land's Aid: the dice one creature in its area regains, named with `healId` in `combat.save`. */
  areaHeal?: string;
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
          ...(action.maxTargets !== undefined ? { maxTargets: action.maxTargets } : {}),
        }
      : null,
    ...(extrasOf(action).length > 0 ? { extras: extrasOf(action) } : {}),
    ...(action.beams && action.beams > 1 ? { beams: action.beams } : {}),
    ...(action.divide ? { divide: { pool: action.divide.pool, rangeFeet: action.rangeFeet ?? 30 } } : {}),
    ...(action.areaHeal ? { areaHeal: `${action.areaHeal.count}d${action.areaHeal.sides}` } : {}),
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
  // In a Wild Shape form the Beast's actions are the creature's, and it casts no spells.
  const form = wildShapeOf(token);
  const base = form
    ? actionsFromStatBlock(form.statBlock as unknown as Parameters<typeof actionsFromStatBlock>[0])
    : sheet
    ? [...actionsFromSheet({ attacks: (sheet.attacks ?? []) as SheetAttack[] }), ...withPotentSpellcasting(sheet, withInvocations(sheet, spellActionsFromSheet(sheet as SheetSpellcasting))), ...channelDivinityActions(sheet), ...paladinChannelActions(sheet), ...intimidatingPresenceActions(sheet)]
    : token.statBlock
      ? actionsFromStatBlock(token.statBlock as Parameters<typeof actionsFromStatBlock>[0])
      : [];
  // A Druid's features: Potent Spellcasting on its cantrips, Land's Aid, and its spells in a form with Beast Spells.
  const own = sheet ? withDruidFeatures(sheet, base, form !== null) : base;
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
  const ward = naturesWard(sheet)?.resistance;
  const resisted = sheet ? [...speciesResistances(sheet), ...(ward ? [ward] : [])] : [];
  const own = sheet
    ? resisted.length > 0
      ? { resistances: resisted }
      : undefined
    : defencesFromStatBlock((token.statBlock ?? {}) as Parameters<typeof defencesFromStatBlock>[0]);
  return {
    name: token.name,
    standing: standing(token),
    armorClass: wildShapeOf(token)?.statBlock.ac ?? (sheet ? sheetAc : blockAc),
    hp: sheet ? extractCharacterHp(DND, sheet) : (token.hp ?? null),
    conditions: [...(token.conditions ?? []), ...(dodging.includes(token.id) ? [DODGING] : []), ...(raging ? [RAGING] : [])],
    exhaustion,
    scores: (() => {
      const form = wildShapeOf(token);
      if (form) return { str: form.statBlock.abilities.str, dex: form.statBlock.abilities.dex };
      return sheet ? { str: scoreOf(sheet, 'strength'), dex: scoreOf(sheet, 'dexterity') } : undefined;
    })(),
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
 * A raging Barbarian with Relentless Rage is asked first, and may save to stay up.
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
      // Relentless Rage: a raging Barbarian this damage would drop to 0 is asked, and makes its Constitution save.
      const relentlessRage = await relentlessRageSave(io, campaignId, mapId, hit.token, hit.sheet, hit.dealt);
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
        // Relentless Rage: the save counts as a use; a success leaves twice the Barbarian level in Hit Points.
        const counted = relentlessRage ? withRelentlessRageUsed(change.data as Record<string, unknown>) : change.data;
        if (relentlessRage?.success && held && endure(held, hit.dealt, change.hp.current) !== null) {
          const current = relentlessRageHitPoints(sheet, change.hp.max);
          const kept = { ...counted, hp: { ...(change.data.hp as object), current } };
          const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(kept) } });
          return { hp: { ...change.hp, current }, sheetChanged: updated, endured: false, raged: current };
        }
        // Damage at 0 Hit Points is a failed death save; dropping to 0 starts them afresh.
        const saves = deathSavesAfterDamage(readDeathSaves(sheet.deathSaves), before, change.hp.current, hit.critical === true);
        const data = saves ? { ...counted, deathSaves: saves } : counted;
        const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(data) } });
        return { hp: change.hp, sheetChanged: saves || relentlessRage ? updated : null, endured: false };
      });
      if (relentlessRage) {
        notes.push(`${relentlessRage.line}${applied && 'raged' in applied && applied.raged !== undefined ? `, ${applied.raged} Hit Points` : ''}`);
      }
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
  // Turn Undead ends for a creature that takes damage.
  for (const { token, dealt } of after) {
    if (dealt > 0) notes.push(...(await endTurned(io, campaignId, mapId, token)));
  }
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

/**
 * Relentless Rage (Barbarian 11): a raging Barbarian that this damage would
 * drop to 0 Hit Points without killing it outright is asked whether it makes
 * the Constitution save (DC 10, 5 more for each use since its last rest).
 * Null when the feature does not answer the damage or is not taken.
 */
async function relentlessRageSave(
  io: Server,
  campaignId: string,
  mapId: string,
  token: Token,
  sheet: Record<string, unknown>,
  dealt: number
): Promise<{ success: boolean; line: string } | null> {
  if (!relentlessRageApplies(sheet, isRaging(campaignId, token.id), extractCharacterHp(DND, sheet), dealt)) return null;
  // An Orc's Relentless Endurance, while it has it, keeps the creature up without a save.
  const endurance = resourcesOf(sheet).find((entry) => entry.name === 'Relentless Endurance');
  if (endurance && endurance.used < endurance.max) return null;
  const dc = relentlessRageDC(sheet);
  const choice = await askReaction(io, campaignId, {
    token,
    text: `${token.name} drops to 0 Hit Points while raging (${dealt} damage). Relentless Rage is a DC ${dc} Constitution save.`,
    options: ['Relentless Rage'],
  });
  if (choice !== 'Relentless Rage') return null;
  const exhaustion = typeof sheet.exhaustionLevel === 'number' ? sheet.exhaustionLevel : undefined;
  const modifiers = saveModifiers(readConditions(token.conditions ?? [], exhaustion), 'con');
  const aura = await auraFor(campaignId, mapId, token);
  const save = savingThrow(
    { bonus: (saveBonusOf(token, sheet, 'con') ?? 0) + aura.bonus + modifiers.penalty, dc, mode: modifiers.mode, autoFail: modifiers.autoFail },
    hasLuck(sheet) ? lucky(rollDie) : rollDie
  );
  const rolled = save.roll ? `${save.roll.total}` : 'no roll';
  return { success: save.success, line: `${token.name}'s Relentless Rage: Constitution ${rolled} vs DC ${dc}, ${save.success ? 'success' : 'failure'}` };
}

/** Whether a raging Berserker's Mindless Rage keeps a condition off the token. */
async function immuneWhileRaging(campaignId: string, token: Token, condition: string): Promise<boolean> {
  if (!isRaging(campaignId, token.id) || !MINDLESS_RAGE_CONDITIONS.some((name) => name.toLowerCase() === condition.toLowerCase())) return false;
  return mindlessRageBlocks(await sheetOf(token, campaignId), true, condition);
}

/**
 * Retaliation (Berserker 10): a creature with the feature that took damage
 * from one within 5 feet of it is asked, with its reaction left, whether it
 * retaliates; a yes offers it one melee attack against that creature, made
 * with `combat.attack` and `opportunity: true` like an Opportunity Attack.
 */
async function offerRetaliation(
  io: Server,
  campaignId: string,
  map: { id: string; tileHeights: unknown; feetPerSquare: number; diagonalRule: string },
  source: Token,
  damaged: Token,
  dealt: number
): Promise<void> {
  const before = getCombatState(campaignId);
  if (dealt <= 0 || !damaged.characterId || source.id === damaged.id || !before.active || before.reactionsSpent.includes(damaged.id)) return;
  if (!before.combatants.some((c) => c.tokenId === damaged.id) || !before.combatants.some((c) => c.tokenId === source.id)) return;
  if (!canAct(readConditions(damaged.conditions ?? []))) return;
  // The sheet as the damage left it: a creature at 0 Hit Points retaliates against nothing.
  const sheet = await sheetOf(damaged, campaignId);
  if (!hasRetaliation(sheet) || (extractCharacterHp(DND, sheet!)?.current ?? 0) <= 0) return;
  const board = {
    heights: readTileHeights(map.tileHeights),
    feetPerSquare: map.feetPerSquare,
    diagonalRule: map.diagonalRule === 'alternating' ? ('alternating' as const) : ('flat' as const),
  };
  if (distanceFeet(standing(damaged), standing(source), board) > 5) return;
  const choice = await askReaction(io, campaignId, {
    token: damaged,
    text: `${source.name} deals ${dealt} damage to ${damaged.name} from within 5 feet.`,
    options: ['Retaliation'],
  });
  if (choice !== 'Retaliation') return;
  const combat = getCombatState(campaignId);
  if (!combat.active || combat.reactionsSpent.includes(damaged.id)) return;
  combat.opportunities = [
    ...combat.opportunities.filter((offer) => !(offer.attackerId === damaged.id && offer.targetId === source.id)),
    { attackerId: damaged.id, targetId: source.id, from: source.position, reason: 'Retaliation' },
  ];
  setCombatState(campaignId, combat);
  await resendInitiativeState(io, campaignId);
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
  combat.marks = [...others, { ...mark, turnEndsLeft: (mark.kind === 'vex' || mark.kind === 'rage' || mark.kind === 'studied') && own ? 2 : 1 }];
  setCombatState(campaignId, combat);
}

/** An attack on the barbarian's own turn keeps its Rage going to the end of its next turn. */
function keepRaging(campaignId: string, tokenId: string): void {
  const combat = getCombatState(campaignId);
  // A Persistent Rage has longer left than an extension gives.
  combat.marks = combat.marks.map((mark) =>
    mark.kind === 'rage' && mark.attackerId === tokenId ? { ...mark, turnEndsLeft: Math.max(mark.turnEndsLeft, 2) } : mark
  );
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
 * with its Bonus Action left. Heightened Focus adds a third Flurry of Blows
 * strike, and Temporary Hit Points to Patient Defense taken with a Focus Point.
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
    // Heightened Focus (Monk 10): a third Flurry of Blows strike, and Temporary Hit Points with Patient Defense.
    const heightened = hasFeature(readFeatures(sheet), 'Heightened Focus') ? { sides: martialArtsDie(sheet) } : null;
    if (effect.focus === 0) return { updated: null, heightened };
    const result = spendResource(sheet, 'Focus Points', effect.focus);
    if (!result.ok) return { refusal: `${token.name}: ${result.reason}` };
    left = result.left;
    return { updated: await tx.character.update({ where: { id: characterId }, data: { data: toJson(result.sheet) } }), heightened };
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
  const strikes = effect.strikes > 0 ? flurryStrikes(spent.heightened !== null && spent.heightened !== undefined) : 0;
  if (strikes > 0) turnAttacksOf(campaignId)?.flurry.set(token.id, strikes);
  await resendInitiativeState(io, campaignId);
  // Heightened Focus: Patient Defense with a Focus Point gives two rolls of the Martial Arts die in Temporary Hit Points.
  let temporary = '';
  if (feature === 'Patient Defense' && effect.focus > 0 && spent.heightened) {
    const rolled = rollDie(spent.heightened.sides) + rollDie(spent.heightened.sides);
    const kept = await giveTemporaryHitPoints(io, campaignId, characterId, rolled);
    temporary = `; Heightened Focus: ${rolled} Temporary Hit Points${kept > rolled ? ` (keeps the ${kept} it has)` : ''}`;
  }
  const did = [
    ...(effect.dash ? ['Dash'] : []),
    ...(effect.disengage ? ['Disengage'] : []),
    ...(effect.dodge ? ['Dodge'] : []),
    ...(strikes > 0 ? [`${strikes} Unarmed Strikes`] : []),
  ].join(' and ');
  const cost = effect.focus > 0 ? ` (1 Focus Point, ${left} left)` : '';
  return { summary: `${token.name} uses ${feature}: ${did}${cost}${temporary}`, left };
}

/**
 * Lay on Hands: the paladin touches a creature within 5 feet (or itself) and
 * restores Hit Points from its pool, as many as `amount` but no more than the
 * creature is missing, and spends 5 points for each condition it ends:
 * Poisoned, and with Restoring Touch Blinded, Charmed, Deafened, Frightened,
 * Paralyzed or Stunned.
 */
async function layOnHands(
  io: Server,
  socket: AuthenticatedSocket,
  campaignId: string,
  map: { id: string; tokens: Parameters<typeof readTokens>[0]; tileHeights: Parameters<typeof readTileHeights>[0]; feetPerSquare: number; diagonalRule: string },
  paladin: Token,
  targetId: string,
  amount: number | undefined,
  cures: string[]
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
  // The conditions ended, 5 points each; Hit Points are restored with them only when an amount is given.
  let healed = 0;
  if (cures.length > 0) {
    const allowed = layOnHandsCures(await sheetOf(paladin, campaignId));
    for (const cure of cures) {
      if (!allowed.includes(cure)) return { refusal: `${paladin.name}'s Lay on Hands does not end the ${cure} condition` };
      if (!(target.conditions ?? []).some((name) => name.toLowerCase() === cure.toLowerCase())) return { refusal: `${target.name} is not ${cure}` };
    }
    if (amount !== undefined) {
      const hp = targetSheet ? extractCharacterHp(DND, targetSheet) : target.hp ?? null;
      healed = hp ? Math.min(amount, Math.max(0, hp.max - hp.current)) : 0;
    }
    cost = CURE_COST * cures.length + healed;
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

  if (cures.length > 0) {
    for (const cure of cures) await takeCondition(io, campaignId, map.id, target.id, cure);
    if (healed > 0) await healToken(io, campaignId, map.id, target, healed);
    const restored = healed > 0 ? ` and regains ${healed} Hit Points` : '';
    return { summary: `${paladin.name} uses Lay on Hands: ${target.name} is no longer ${cures.join(' or ')}${restored} (${spent.left} left)`, left: spent.left };
  }
  await healToken(io, campaignId, map.id, target, cost);
  return { summary: `${paladin.name} uses Lay on Hands: ${target.name} regains ${cost} Hit Points (${spent.left} left)`, left: spent.left };
}

/**
 * Preserve Life: a Life Domain Cleric's use of Channel Divinity restores five
 * times its Cleric level in Hit Points, divided as `shares` say among Bloodied
 * creatures within 30 feet (itself among them), none to more than half its
 * Hit Point maximum. Spends the use and the Magic action.
 */
async function dividePreserveLife(
  io: Server,
  socket: AuthenticatedSocket,
  campaignId: string,
  map: { id: string; tokens: Parameters<typeof readTokens>[0]; tileHeights: Parameters<typeof readTileHeights>[0]; feetPerSquare: number; diagonalRule: string },
  cleric: Token,
  actionIndex: number,
  shares: ReadonlyArray<{ targetId: string; amount: number }>,
  ack: SocketAck | null
): Promise<void> {
  const sheet = await sheetOf(cleric, campaignId);
  const action = actionsOf(cleric, sheet)[actionIndex];
  if (!action?.divide) return refuseRequest(socket, ack, 'Only Preserve Life divides Hit Points among creatures');
  const tokens = readTokens(map.tokens);
  const board = {
    heights: readTileHeights(map.tileHeights),
    feetPerSquare: map.feetPerSquare,
    diagonalRule: map.diagonalRule === 'alternating' ? ('alternating' as const) : ('flat' as const),
  };
  const reach = action.rangeFeet ?? 30;
  const chosen: Token[] = [];
  for (const share of shares) {
    const token = tokens.find((t) => t.id === share.targetId);
    if (!token || token.layer !== cleric.layer || (socket.role !== 'DM' && hiddenFromPlayers(token))) {
      return refuseRequest(socket, ack, 'That creature is not on the map');
    }
    if (chosen.some((other) => other.id === token.id)) return refuseRequest(socket, ack, `${token.name} is chosen twice`);
    if (token.id !== cleric.id && distanceFeet(standing(cleric), standing(token), board) > reach) {
      return refuseRequest(socket, ack, `${token.name} is beyond the ${reach} ft range of ${action.name}`);
    }
    chosen.push(token);
  }
  const sheets = await Promise.all(chosen.map((token) => sheetOf(token, campaignId)));
  const plan = preserveLife(
    action.divide.pool,
    chosen.map((token, index) => ({
      name: token.name,
      hp: sheets[index] ? extractCharacterHp(DND, sheets[index]!) : (token.hp ?? null),
      amount: shares[index].amount,
    }))
  );
  if ('error' in plan) return refuseRequest(socket, ack, plan.error);

  const undo = await prepareUndo(campaignId, map.id, [cleric.characterId, ...chosen.map((token) => token.characterId)]);
  for (const [index, token] of chosen.entries()) {
    if (plan.restored[index] > 0) await healToken(io, campaignId, map.id, token, plan.restored[index]);
  }
  if (action.channel) await spendSheetUse(campaignId, cleric, action.channel);
  await spendAction(io, campaignId, cleric.id, 'Magic');
  const total = plan.restored.reduce((sum, amount) => sum + amount, 0);
  const summary = `${action.name}, a use of Channel Divinity: ${chosen.map((token, index) => `${token.name} regains ${plan.restored[index]} Hit Points`).join(', ')}`;
  await logRoll(
    io,
    socket,
    campaignId,
    {
      expression: String(total),
      total,
      breakdown: { expression: String(total), rolls: plan.restored.map((value) => ({ type: 'modifier' as const, value })), total, formula: `${plan.restored.join(' + ')} = ${total}` },
    },
    cleric.name,
    summary,
    hiddenFromPlayers(cleric) || chosen.some(hiddenFromPlayers)
  );
  commitUndo(campaignId, undo, summary);
  ack?.({ ok: true, summary, healed: total, restored: chosen.map((token, index) => ({ tokenId: token.id, healed: plan.restored[index] })) });
  logger.debug('combat.heal', { campaignId, casterId: cleric.id, shares: shares.length, healed: total });
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
    // Aura of Courage, Aura of Devotion: the condition does not take in the aura.
    const warded = await auraImmunity(campaignId, mapId, target, rider.condition);
    if (warded) {
      lines.push(`${target.name} is immune to the ${rider.condition} condition (${warded})`);
      continue;
    }
    // Mindless Rage: a raging Berserker is immune to the Charmed and Frightened conditions.
    if (await immuneWhileRaging(campaignId, target, rider.condition)) {
      lines.push(`${target.name} is immune to the ${rider.condition} condition (Mindless Rage)`);
      continue;
    }
    // Nature's Ward: a Land Druid of level 10 is immune to the Poisoned condition.
    if (rider.condition.toLowerCase() === 'poisoned' && target.characterId && naturesWard(await sheetOf(target, campaignId))) {
      lines.push(`${target.name} is immune to the Poisoned condition (Nature's Ward)`);
      continue;
    }
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
function featureSummary(name: string, feature: string, amount: number, left: number): string {
  const uses = `${left} ${left === 1 ? 'use' : 'uses'} left`;
  switch (feature) {
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

/** Who has used Stunning Strike on the current turn of each campaign's combat. */
const stunningStrikes = new Map<string, { turn: string; tokens: Set<string> }>();

function stunUsed(campaignId: string, tokenId: string): boolean {
  const turn = sneakTurnOf(campaignId);
  const used = stunningStrikes.get(campaignId);
  return turn !== null && used?.turn === turn && used.tokens.has(tokenId);
}

function useStun(campaignId: string, tokenId: string): void {
  const turn = sneakTurnOf(campaignId);
  if (turn === null) return;
  const used = stunningStrikes.get(campaignId);
  if (used?.turn === turn) used.tokens.add(tokenId);
  else stunningStrikes.set(campaignId, { turn, tokens: new Set([tokenId]) });
}

/** Who has dealt its Frenzy damage on the current turn of each campaign's combat. */
const frenzies = new Map<string, { turn: string; tokens: Set<string> }>();

function frenzyUsed(campaignId: string, tokenId: string): boolean {
  const turn = sneakTurnOf(campaignId);
  const used = frenzies.get(campaignId);
  return turn !== null && used?.turn === turn && used.tokens.has(tokenId);
}

function useFrenzy(campaignId: string, tokenId: string): void {
  const turn = sneakTurnOf(campaignId);
  if (turn === null) return;
  const used = frenzies.get(campaignId);
  if (used?.turn === turn) used.tokens.add(tokenId);
  else frenzies.set(campaignId, { turn, tokens: new Set([tokenId]) });
}

/** Who has used Primal Strike, and who Wild Resurgence's spell slot for a use, on the current turn of each campaign's combat. */
const primalStrikes = new Map<string, { turn: string; tokens: Set<string> }>();
const resurgences = new Map<string, { turn: string; tokens: Set<string> }>();

function usedThisTurn(kept: Map<string, { turn: string; tokens: Set<string> }>, campaignId: string, tokenId: string): boolean {
  const turn = sneakTurnOf(campaignId);
  const used = kept.get(campaignId);
  return turn !== null && used?.turn === turn && used.tokens.has(tokenId);
}

function useThisTurn(kept: Map<string, { turn: string; tokens: Set<string> }>, campaignId: string, tokenId: string): void {
  const turn = sneakTurnOf(campaignId);
  if (turn === null) return;
  const used = kept.get(campaignId);
  if (used?.turn === turn) used.tokens.add(tokenId);
  else kept.set(campaignId, { turn, tokens: new Set([tokenId]) });
}

/** Who has used Brutal Strike on the current turn of each campaign's combat. */
const brutalStrikes = new Map<string, { turn: string; tokens: Set<string> }>();

function brutalUsed(campaignId: string, tokenId: string): boolean {
  const turn = sneakTurnOf(campaignId);
  const used = brutalStrikes.get(campaignId);
  return turn !== null && used?.turn === turn && used.tokens.has(tokenId);
}

function useBrutal(campaignId: string, tokenId: string): void {
  const turn = sneakTurnOf(campaignId);
  if (turn === null) return;
  const used = brutalStrikes.get(campaignId);
  if (used?.turn === turn) used.tokens.add(tokenId);
  else brutalStrikes.set(campaignId, { turn, tokens: new Set([tokenId]) });
}

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

/** The turn in each campaign whose Divine Strikes have been dealt, and by whom: once on each of the Cleric's turns. */
const divineStrikes = new Map<string, { turn: string; tokens: Set<string> }>();

function divineStrikeUsed(campaignId: string, tokenId: string): boolean {
  const turn = sneakTurnOf(campaignId);
  const used = divineStrikes.get(campaignId);
  return turn !== null && used?.turn === turn && used.tokens.has(tokenId);
}

function useDivineStrike(campaignId: string, tokenId: string): void {
  const turn = sneakTurnOf(campaignId);
  if (turn === null) return;
  const used = divineStrikes.get(campaignId);
  if (used?.turn === turn) used.tokens.add(tokenId);
  else divineStrikes.set(campaignId, { turn, tokens: new Set([tokenId]) });
}

/** The turn each campaign's last Action Surge was used in: once a turn. */
const actionSurges = new Map<string, { tokenId: string; round: number }>();

/** What a Fighter's Indomitable adds to a save rolled again (its Fighter level), when it has a use left; null otherwise. */
function indomitableBonus(sheet: Record<string, unknown> | null): number | null {
  if (!sheet) return null;
  const uses = resourcesOf(sheet).find((entry) => entry.name === 'Indomitable');
  return uses && uses.used < uses.max ? classLevel(sheet, 'Fighter') : null;
}

/** Spend one use (or point) of a class feature on the token's sheet, and tell the table. */
async function spendSheetUse(campaignId: string, token: Token, name: ResourceName, amount = 1): Promise<void> {
  const characterId = token.characterId;
  if (!characterId) return;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
    const fresh = await tx.character.findUnique({ where: { id: characterId } });
    const spent = fresh ? spendResource((fresh.data ?? {}) as Record<string, unknown>, name, amount) : null;
    return spent?.ok ? tx.character.update({ where: { id: characterId }, data: { data: toJson(spent.sheet) } }) : null;
  });
  if (updated) {
    await bestEffort(`sheet after ${name}`, () =>
      emitCharacterUpdated(campaignId, updated, { characterId, userId: updated.userId, tokensChanged: false })
    );
  }
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
    // Open Hand Technique's Addle: no Opportunity Attacks until the start of the creature's next turn.
    .filter((c) => !before.marks.some((mark) => mark.kind === 'addle' && mark.targetId === c.tokenId))
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
/**
 * The best Aura of Protection a creature stands in: a Paladin on its side (or
 * itself), on its layer, within 10 feet (30 with Aura Expansion), able to act
 * and above 0 Hit Points. What it adds to the creature's saves and whose it
 * is, and the conditions the auras it stands in keep off it (Aura of Courage,
 * Aura of Devotion), each with whose aura does.
 */
async function auraFor(
  campaignId: string,
  mapId: string,
  target: Token
): Promise<{ bonus: number; from: string | null; immune: Record<string, string> }> {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) return { bonus: 0, from: null, immune: {} };
  const board = {
    heights: readTileHeights(map.tileHeights),
    feetPerSquare: map.feetPerSquare,
    diagonalRule: map.diagonalRule === 'alternating' ? ('alternating' as const) : ('flat' as const),
  };
  const side = sideOf({ type: target.type ?? 'npc', disposition: target.disposition ?? null });
  let best = { bonus: 0, from: null as string | null };
  const immune: Record<string, string> = {};
  for (const token of readTokens(map.tokens)) {
    if (!token.characterId || token.layer !== target.layer || (token.hp && token.hp.current <= 0)) continue;
    const ally = token.id === target.id || (side !== null && sideOf({ type: token.type ?? 'npc', disposition: token.disposition ?? null }) === side);
    if (!ally || !canAct(readConditions(token.conditions ?? []))) continue;
    const away = distanceFeet(standing(token), standing(target), board);
    if (away > EXPANDED_AURA_FEET) continue;
    const sheet = await sheetOf(token, campaignId);
    if (away > auraFeet(sheet)) continue;
    const bonus = auraOfProtectionBonus(sheet);
    if (bonus > best.bonus) best = { bonus, from: token.name };
    for (const kept of auraImmunities(sheet)) immune[kept.condition] ??= `${token.name}'s ${kept.feature}`;
  }
  return { ...best, immune };
}

/** The aura that keeps a condition off a creature where it stands ("Hero's Aura of Courage"), or null. */
async function auraImmunity(campaignId: string, mapId: string, target: Token, condition: string): Promise<string | null> {
  if (!['frightened', 'charmed'].includes(condition.toLowerCase())) return null;
  return (await auraFor(campaignId, mapId, target)).immune[condition.toLowerCase()] ?? null;
}

/** A token without the conditions an aura it stands in keeps from affecting it: Frightened in an Aura of Courage, Charmed in an Aura of Devotion. */
async function calmedByAura(campaignId: string, mapId: string, token: Token): Promise<Token> {
  const carried = token.conditions ?? [];
  if (!carried.some((name) => ['frightened', 'charmed'].includes(name.toLowerCase()))) return token;
  const { immune } = await auraFor(campaignId, mapId, token);
  return { ...token, conditions: carried.filter((name) => !immune[name.toLowerCase()]) };
}

function saveBonusOf(token: Token, sheet: Record<string, unknown> | null, ability: Ability): number | null {
  const full = ABILITY_FULL[ability];
  if (sheet) {
    const saves = sheet.savingThrows as Record<string, { bonus?: unknown } | undefined> | undefined;
    const bonus = saves?.[full]?.bonus;
    const own = typeof bonus === 'number' ? bonus : null;
    // In a Wild Shape form, a physical save uses the better of the Druid's and the Beast's.
    const form = PHYSICAL.includes(ability) ? wildShapeOf(token) : null;
    if (!form) return own;
    const beast = saveBonusOf({ ...token, metadata: {}, statBlock: form.statBlock as unknown as Record<string, unknown> }, null, ability);
    return own === null ? beast : beast === null ? own : Math.max(own, beast);
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

/** The scores a Wild Shape form replaces. */
const PHYSICAL: readonly Ability[] = ['str', 'dex', 'con'];

/** A creature's ability modifier, from its sheet's stats or its stat block's scores. Null when neither gives one. */
function abilityModifierOf(token: Token, sheet: Record<string, unknown> | null, ability: Ability): number | null {
  // In a Wild Shape form, the physical scores are the Beast's.
  const form = PHYSICAL.includes(ability) ? wildShapeOf(token) : null;
  if (form) return Math.floor((form.statBlock.abilities[ability as 'str' | 'dex' | 'con'] - 10) / 2);
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
/**
 * A Sorcerer's Metamagic chosen as a spell is cast, checked against the rules:
 * the option known, the Sorcery Points left, a spell it can change and, for
 * Careful and Heightened Spell, the creatures it picks among the targets.
 */
function castingMetamagic(
  campaignId: string,
  token: Token,
  sheet: Record<string, unknown> | null,
  action: CombatAction,
  chosen: { option: CastingMetamagic; targetIds?: string[] },
  targetIds: readonly string[]
): { error: string } | { action: CombatAction; cost: number; quickened: boolean; protectedIds: ReadonlySet<string>; heightenedId: string | null } {
  const { name, cost } = METAMAGIC[chosen.option];
  if (!sheet || !knowsMetamagic(sheet, chosen.option)) return { error: `${token.name} does not know ${name}` };
  if (action.source !== 'spell') return { error: `${name} changes a spell` };
  const points = resourcesOf(sheet).find((entry) => entry.name === 'Sorcery Points');
  if (!points || points.max - points.used < cost) return { error: `${name} costs ${cost} Sorcery ${cost === 1 ? 'Point' : 'Points'}` };
  const picked = chosen.targetIds ?? [];
  if (chosen.option === 'careful' || chosen.option === 'heightened') {
    if (!action.save) return { error: `${name} changes a spell that calls for a saving throw` };
    if (picked.length === 0 || picked.some((id) => !targetIds.includes(id))) return { error: `${name} picks creatures among the spell's targets` };
    if (chosen.option === 'heightened' && picked.length !== 1) return { error: 'Heightened Spell picks one target' };
    if (chosen.option === 'careful' && picked.length > carefulCount(sheet)) {
      return { error: `Careful Spell protects ${carefulCount(sheet)} ${carefulCount(sheet) === 1 ? 'creature' : 'creatures'} at most` };
    }
  }
  if (chosen.option === 'quickened') {
    if (action.cost !== 'action') return { error: 'Quickened Spell changes a spell cast as an action' };
    const combat = getCombatState(campaignId);
    if (someoneActing(combat) && combat.currentTokenId === token.id && combat.turn?.bonusAction) {
      return { error: `${token.name} has used its Bonus Action this turn` };
    }
  }
  const changed = chosen.option === 'distant' ? distantAction(action) : action;
  if (!changed) return { error: 'Distant Spell changes a spell with a range of Touch or more' };
  return {
    action: changed,
    cost,
    quickened: chosen.option === 'quickened',
    protectedIds: new Set(chosen.option === 'careful' ? picked : []),
    heightenedId: chosen.option === 'heightened' ? picked[0] : null,
  };
}

/** Keep the Beast a token has taken the form of in its metadata (null to leave it), and tell the table. */
async function setWildShape(io: Server, campaignId: string, map: { id: string }, tokenId: string, form: string | null): Promise<void> {
  await setTokenMetadata(io, campaignId, map.id, tokenId, 'wildShape', form);
}

/** How long a Bardic Inspiration die is kept: an hour. */
const INSPIRATION_MS = 60 * 60 * 1000;

interface HeldInspiration {
  sides: number;
  from: string;
  until: number;
}

/** The Bardic Inspiration die a token holds, while the hour lasts; null otherwise. */
function inspirationOf(token: Token): HeldInspiration | null {
  const held = (token.metadata as Record<string, unknown> | undefined)?.bardicInspiration as Partial<HeldInspiration> | undefined;
  if (!held || typeof held.sides !== 'number' || typeof held.until !== 'number' || held.until < Date.now()) return null;
  return { sides: held.sides, from: typeof held.from === 'string' ? held.from : 'a Bard', until: held.until };
}

/**
 * Bardic Inspiration, as the rules have it: a creature that fails a D20
 * Test while it holds the die is asked whether to roll it and add the number.
 * The die is spent if it is rolled; what it rolled comes back, null if not.
 */
async function offerInspiration(io: Server, campaignId: string, mapId: string, token: Token, failed: string): Promise<number | null> {
  const held = inspirationOf(token);
  if (!held) return null;
  const choice = await askReaction(io, campaignId, {
    token,
    text: `${failed} ${token.name} holds a d${held.sides} Bardic Inspiration die from ${held.from}.`,
    options: ['Bardic Inspiration'],
  });
  if (choice !== 'Bardic Inspiration') return null;
  await setTokenMetadata(io, campaignId, mapId, token.id, 'bardicInspiration', null);
  return rollDie(held.sides);
}

/**
 * Stroke of Luck (Rogue 20), as the rules have it: a Rogue that fails a D20
 * Test with its use left is asked whether to turn the roll into a 20. True
 * when it is taken; the caller spends the use.
 */
async function offerStrokeOfLuck(io: Server, campaignId: string, token: Token, sheet: Record<string, unknown> | null, failed: string): Promise<boolean> {
  const uses = sheet ? resourcesOf(sheet).find((entry) => entry.name === 'Stroke of Luck') : undefined;
  if (!uses || uses.used >= uses.max) return false;
  const choice = await askReaction(io, campaignId, { token, text: `${failed} Stroke of Luck turns the d20 into a 20.`, options: ['Stroke of Luck'] });
  return choice === 'Stroke of Luck';
}

/** The names of a sheet's features in lower case, without the class and level each came from. */
function featureNamesOf(sheet: Record<string, unknown> | null): Set<string> {
  return new Set(readFeatures(sheet).map((feature) => featureName(feature.name).toLowerCase()));
}

/** The option that casts Divine Smite with Paladin's Smite, without a spell slot. */
const FREE_SMITE = 'Divine Smite (no slot)';

/** The weapon a token's Sacred Weapon imbues, by its attack's name, while the 10 minutes last; null otherwise. */
function sacredWeaponOf(token: Token): string | null {
  const held = (token.metadata as Record<string, unknown> | undefined)?.sacredWeapon as { weapon?: unknown; until?: unknown } | undefined;
  if (!held || typeof held.weapon !== 'string' || typeof held.until !== 'number' || held.until < Date.now()) return null;
  return held.weapon;
}

/** Set one key of a token's metadata (null to remove it), and tell the table. */
async function setTokenMetadata(io: Server, campaignId: string, mapId: string, tokenId: string, key: string, value: unknown): Promise<void> {
  const map = { id: mapId };
  const updated = await withMapsLocked([map.id], async (tx) => {
    const fresh = await tx.map.findUnique({ where: { id: map.id } });
    if (!fresh) return null;
    const list = readTokens(fresh.tokens);
    const token = list.find((t) => t.id === tokenId);
    if (!token) return null;
    const metadata = { ...(token.metadata ?? {}) };
    if (value !== null && value !== undefined) metadata[key] = value;
    else delete metadata[key];
    token.metadata = metadata;
    return tx.map.update({ where: { id: map.id }, data: { tokens: toJson(list) } });
  });
  if (updated) await bestEffort(`map after ${key}`, () => broadcastMapData(io, campaignId, updated as unknown as Parameters<typeof broadcastMapData>[2]));
}

/** A character gains Temporary Hit Points: they do not add up, so it keeps the larger. What it has after comes back. */
async function giveTemporaryHitPoints(io: Server, campaignId: string, characterId: string, amount: number): Promise<number> {
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
    const fresh = await tx.character.findUnique({ where: { id: characterId } });
    if (!fresh) return null;
    const sheet = (fresh.data ?? {}) as Record<string, unknown>;
    const hp = (sheet.hp ?? {}) as { current?: number; maximum?: number; temporary?: number };
    const temporary = Math.max(typeof hp.temporary === 'number' ? hp.temporary : 0, amount);
    return tx.character.update({ where: { id: characterId }, data: { data: toJson({ ...sheet, hp: { ...hp, temporary } }) } });
  });
  if (!updated) return 0;
  const hp = extractCharacterHp(DND, (updated.data ?? {}) as Record<string, unknown>);
  if (hp) io.to(campaignId).emit('character.hp.updated', { characterId, hp });
  await bestEffort('sheet after Temporary Hit Points', () =>
    emitCharacterUpdated(campaignId, updated, { characterId, userId: updated.userId, tokensChanged: false })
  );
  return hp?.temp ?? amount;
}

/** A creature that takes damage stops being turned: the conditions Turn Undead or Abjure Foes gave it come off. */
async function endTurned(io: Server, campaignId: string, mapId: string, token: Token): Promise<string[]> {
  const combat = getCombatState(campaignId);
  // A Rogue's Knock Out and a Paladin's Abjure Foes end the same way.
  const turned = combat.marks.filter(
    (mark) => mark.kind === 'condition' && mark.targetId === token.id && (mark.action === 'Turn Undead' || mark.action === 'Knock Out' || mark.action === 'Abjure Foes')
  );
  if (turned.length === 0) return [];
  combat.marks = combat.marks.filter((mark) => !turned.includes(mark));
  setCombatState(campaignId, combat);
  for (const mark of turned) await takeCondition(io, campaignId, mapId, token.id, mark.condition!);
  return [
    ...(turned.some((mark) => mark.action === 'Turn Undead') ? [`${token.name} is no longer turned`] : []),
    ...(turned.some((mark) => mark.action === 'Knock Out') ? [`${token.name} is no longer Unconscious (Knock Out)`] : []),
    ...(turned.some((mark) => mark.action === 'Abjure Foes') ? [`${token.name} is no longer Frightened (Abjure Foes)`] : []),
  ];
}

/** Hunter's Mark, as a sheet names it. */
const HUNTERS_MARK = /^hunter[’']?s mark$/i;

/** The creature a Ranger's Hunter's Mark marks, while it concentrates on it; null otherwise. */
function huntersMarkOf(campaignId: string, tokenId: string): string | null {
  const mark = getCombatState(campaignId).marks.find(
    (entry) => entry.kind === 'concentration' && entry.attackerId === tokenId && HUNTERS_MARK.test(entry.action ?? '')
  );
  return mark && mark.targetId !== tokenId ? mark.targetId : null;
}

/** `marked` is the creature a spell such as Hunter's Mark marks; the caster itself otherwise. */
function startConcentration(campaignId: string, tokenId: string, spell: string, marked: string = tokenId): void {
  const combat = getCombatState(campaignId);
  if (!combat.active) return;
  combat.marks = [
    ...combat.marks.filter((mark) => !(mark.kind === 'concentration' && mark.attackerId === tokenId)),
    { kind: 'concentration', attackerId: tokenId, targetId: marked, action: spell, turnEndsLeft: 1 },
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

/** Heroic Rally (a Champion's Survivor): at the start of its turn, Bloodied with at least 1 Hit Point, it regains 5 + its Constitution modifier. */
async function heroicRallyAtTurnStart(io: Server, socket: AuthenticatedSocket, campaignId: string, tokenId: string): Promise<void> {
  const mapId = getCombatState(campaignId).combatants.find((entry) => entry.tokenId === tokenId)?.mapId;
  const map = mapId ? await prisma.map.findUnique({ where: { id: mapId } }) : null;
  const token = map ? readTokens(map.tokens).find((t) => t.id === tokenId) : undefined;
  if (!map || !token?.characterId) return;
  const sheet = await sheetOf(token, campaignId);
  if (!sheet || !hasSurvivor(readFeatures(sheet))) return;
  const hp = extractCharacterHp(DND, sheet);
  const amount = hp ? heroicRally(hp, abilityModifierOf(token, sheet, 'con') ?? 0) : 0;
  if (amount <= 0) return;
  await healToken(io, campaignId, map.id, token, amount);
  await logRoll(
    io,
    socket,
    campaignId,
    {
      expression: `${amount}`,
      total: amount,
      breakdown: { expression: `${amount}`, rolls: [{ type: 'modifier' as const, value: amount }], total: amount, formula: `${amount} = ${amount}` },
    },
    token.name,
    `${token.name} rallies (Survivor): Bloodied at the start of its turn, it regains ${amount} Hit Points`,
    hiddenFromPlayers(token)
  );
}
onTurnStart(heroicRallyAtTurnStart);

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
    const aura = await auraFor(campaignId, map.id, token);
    const outcome = savingThrow(
      { bonus: (saveBonusOf(token, sheet, ability) ?? 0) + aura.bonus + modifiers.penalty, dc, mode: modifiers.mode, autoFail: modifiers.autoFail },
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

/**
 * A save a Monk's feature calls for (a redirected attack, Open Hand
 * Technique): rolled with the creature's conditions and the best Aura of
 * Protection it stands in. Answers whether it saved and "Dexterity 12 vs DC 14".
 */
async function monkFeatureSave(
  campaignId: string,
  mapId: string,
  token: Token,
  sheet: Record<string, unknown> | null,
  ability: Ability,
  dc: number,
  conditions: readonly string[] = token.conditions ?? []
): Promise<{ success: boolean; text: string }> {
  const modifiers = saveModifiers(readConditions([...conditions], typeof sheet?.exhaustionLevel === 'number' ? sheet.exhaustionLevel : undefined), ability, {
    dangerSense: sheet !== null && hasFeature(readFeatures(sheet), 'Danger Sense'),
  });
  const aura = await auraFor(campaignId, mapId, token);
  const save = savingThrow(
    { bonus: (saveBonusOf(token, sheet, ability) ?? 0) + aura.bonus + modifiers.penalty, dc, mode: modifiers.mode, autoFail: modifiers.autoFail },
    sheet && hasLuck(sheet) ? lucky(rollDie) : rollDie
  );
  const label = `${ABILITY_FULL[ability][0].toUpperCase()}${ABILITY_FULL[ability].slice(1)}`;
  return { success: save.success, text: `${label} ${save.roll ? save.roll.total : 'no roll'} vs DC ${dc}` };
}

/**
 * Self-Restoration (Monk 10): at the end of each of its turns, the Monk ends
 * one of Charmed, Frightened or Poisoned on itself. With one of them it comes
 * off; with several its player is asked which, and the first goes when nobody
 * answers. No roll is made, so the table sees the condition leave the token.
 */
async function selfRestorationAtTurnEnd(io: Server, _socket: AuthenticatedSocket, campaignId: string, tokenId: string): Promise<void> {
  const combat = getCombatState(campaignId);
  const mapId = combat.combatants.find((entry) => entry.tokenId === tokenId)?.mapId;
  const map = mapId ? await prisma.map.findUnique({ where: { id: mapId } }) : null;
  const token = map ? readTokens(map.tokens).find((t) => t.id === tokenId) : undefined;
  if (!map || !token?.characterId) return;
  const carried = selfRestorable(token.conditions ?? []);
  if (carried.length === 0) return;
  const sheet = await sheetOf(token, campaignId);
  if (!sheet || !hasFeature(readFeatures(sheet), 'Self-Restoration')) return;
  const asked =
    carried.length > 1
      ? await askReaction(io, campaignId, {
          token,
          text: `${token.name}'s turn ends. Self-Restoration ends one condition:`,
          options: carried,
        })
      : null;
  const condition = asked ?? carried[0];
  await takeCondition(io, campaignId, map.id, tokenId, condition);
  const now = getCombatState(campaignId);
  now.marks = now.marks.filter((kept) => !(kept.kind === 'condition' && kept.targetId === tokenId && kept.condition?.toLowerCase() === condition.toLowerCase()));
  setCombatState(campaignId, now);
}
onTurnEnd(selfRestorationAtTurnEnd);

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
          // A Barbarian's Brutal Strike, on a turn it attacks recklessly.
          brutalStrike: sheet ? hasFeature(features, 'Brutal Strike') : false,
          // A Paladin's Sacred Weapon: whether it has the feature, and the weapon imbued now.
          sacredWeapon: hasSacredWeapon(sheet) ? { imbued: sacredWeaponOf(token) } : null,
          // The conditions its Lay on Hands can end, 5 points each.
          cures: sheet && resourcesOf(sheet).some((entry) => entry.name === 'Lay on Hands') ? layOnHandsCures(sheet) : [],
          // A Sorcerer's Metamagic options chosen as a spell is cast.
          metamagic: sheet ? (Object.keys(METAMAGIC) as CastingMetamagic[]).filter((option) => knowsMetamagic(sheet, option)) : [],
          // A Druid's Wild Shape: the Beasts it can take the form of, and the form it is in.
          wildShapeForms: sheet ? wildShapeForms(sheet) : [],
          wildShape: wildShapeOf(token)?.name ?? null,
          // A Rogue's Cunning Strike effects it can use: Poison only with a Poisoner's Kit.
          cunningStrike: sheet
            ? cunningEffectsOf(featureNamesOf(sheet)).filter(
                (effect) => (effect !== 'poison' || hasPoisonersKit(sheet)) && (effect !== 'stealth' || (token.conditions ?? []).includes('Invisible'))
              )
            : [],
          // Improved Cunning Strike: two effects on one Sneak Attack.
          cunningStrikeLimit: sheet && hasFeature(features, 'Improved Cunning Strike') ? 2 : 1,
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
   * COMBAT.ATTACK — Make one attack from a token against another on the current map: the server checks reach, range and cover, rolls against Armor Class with the conditions of both and, on a lit map, whether each can see the other (darkness it cannot see into gives the attacker Disadvantage, or the target's unseen attacker Advantage), with `extra` makes a weapon's Cleave or Light extra attack on the attacker's turn (no positive ability modifier to the damage, once a turn each), adds a Rogue's Sneak Attack dice once on each turn to a Finesse or Ranged weapon hit with Advantage or with an ally beside the target, applies the damage to the target's hit points and records the roll in the dice log. With `readied: true` it is the attack the attacker readied against this target with `combat.ready`, made with its reaction. After a Melee weapon or Unarmed Strike hit, a Paladin with Divine Smite prepared and its Bonus Action left is asked (`combat.prompt`) which slot to smite with: 2d8 Radiant, 1d8 more a slot level above 1 and against a Fiend or Undead, doubled on a Critical Hit, spending the slot and the Bonus Action; a Paladin of level 2 or higher is also offered `Divine Smite (no slot)` once until a Long Rest (Paladin's Smite), cast as with a level 1 slot. A Paladin with Radiant Strikes adds 1d8 Radiant to a Melee weapon or Unarmed Strike hit. With `sacredWeapon: true` a Paladin with Sacred Weapon, as it takes the Attack action with a Melee weapon, spends a use of Channel Divinity: for 10 minutes that weapon adds the Charisma modifier (at least +1) to its attack rolls, and with `radiant: true` a hit with it deals Radiant damage instead of the weapon's own type. An attacker standing in an Aura of Courage is not affected by its Frightened condition. After a hit with a Monk weapon or an Unarmed Strike, a Monk with Stunning Strike and a Focus Point left is asked, once a turn: the point is spent and the target makes a Constitution save (DC 8 + Wisdom modifier + Proficiency Bonus), Stunned until the start of the Monk's next turn on a failure, its Speed halved and the next attack roll against it with Advantage on a success. With `cunning: 'poison' | 'trip' | 'withdraw'` a Rogue with Cunning Strike forgoes a Sneak Attack die for the effect, applied when Sneak Attack is dealt: a Constitution save (DC 8 + Dexterity modifier + Proficiency Bonus) or Poisoned, repeating the save at the end of each of its turns (with a Poisoner's Kit); a Large or smaller target's Dexterity save or Prone; or a note that the Rogue may withdraw half its Speed. `cunning` may be two different effects in an array with Improved Cunning Strike, paying the dice of each, and Devious Strikes adds `daze` (2d6: a Constitution save or a note that on its next turn the target only moves, or takes an action, or a Bonus Action), `knockOut` (6d6: a Constitution save or Unconscious, repeating the save at the end of each of its turns and ending when it takes damage) and `obscure` (3d6: a Dexterity save or Blinded until the end of its next turn); a Thief's Supreme Sneak adds `stealth` (1d6, while it has the Invisible condition: a note that the attack does not end it). A Rogue that took Steady Aim this turn makes its next attack roll with Advantage. No attack roll against a creature with Elusive has Advantage unless it is Incapacitated. A level 20 Rogue that misses, with Stroke of Luck unspent, is asked (`combat.prompt`) whether to turn the d20 into a 20, a Critical Hit. With `brutal: 'forceful' | 'hamstring'` a Barbarian with Brutal Strike, on a turn it attacks recklessly, once a turn, gives up Advantage on a Strength attack without Disadvantage: a hit adds 1d10 (2d10 from level 17) of the weapon's type and pushes the target 15 ft or takes 15 ft off its Speed until the Barbarian's next turn. With `reckless: true` (a Barbarian's Reckless Attack, with the first attack roll of its own turn) its attacks using Strength, and attacks against it, have Advantage until its next turn starts. A hit on a creature with Uncanny Dodge or Deflect Attacks and its reaction unspent waits while its controller is asked (`combat.prompt`, answered with `combat.react`), and the ack comes once that is settled. A Monk whose Deflect Attacks brings the damage to 0, with a Focus Point left and the attacker in sight within 5 feet (60 for a ranged attack), is then asked whether to redirect it: the point is spent and the attacker makes a Dexterity save (DC 8 + the Monk's Wisdom modifier + Proficiency Bonus) or takes two Martial Arts dice + the Monk's Dexterity modifier of the attack's damage type. After a hit with a Flurry of Blows strike (`extra: 'flurry'`), a Monk with Open Hand Technique is asked for Addle (no Opportunity Attacks for the target until its next turn starts), Push (a Strength save or pushed 15 ft) or Topple (a Dexterity save or Prone). With `opportunity: true` it is the Opportunity Attack the target's movement offered the attacker: one melee attack, with the attacker's reaction, against the target where it stood before it left reach. A Berserker's Frenzy adds as many d6s as its Rage Damage bonus to its first Strength-based hit on a turn it attacks recklessly while raging. A raging Barbarian with Relentless Rage that the damage would drop to 0 Hit Points without killing it outright is asked (`combat.prompt`, option `Relentless Rage`): a Constitution save of DC 10, 5 more for each use since its last rest, and on a success its Hit Points become twice its Barbarian level. Once the attack is answered, a damaged creature with Retaliation, within 5 feet of the attacker and with its reaction left, is asked (option `Retaliation`): a yes adds an offer with `reason: 'Retaliation'` to the combat state's `opportunities`, taken with `opportunity: true` like an Opportunity Attack. The DM, or the player who controls the attacker; a player may not target a hidden token.
   */
  socket.on('combat.attack', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.attack', ack)) return;
      const parsed = CombatAttackSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid attack');
      const { attackerId, targetId, mode, slotLevel, opportunity, extra, readied, legendary, reckless, brutal, sacredWeapon, radiant } = parsed.data;
      const cunning: CunningEffect[] = parsed.data.cunning === undefined ? [] : Array.isArray(parsed.data.cunning) ? parsed.data.cunning : [parsed.data.cunning];
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
      // Metamagic for a spell attack, chosen as it is cast: Distant or Quickened Spell.
      const meta = parsed.data.metamagic ? castingMetamagic(campaignId, attackerToken, attackerSheet, action, parsed.data.metamagic, [targetId]) : null;
      if (meta && 'error' in meta) return refuseRequest(socket, ack, meta.error);
      if (meta) action = meta.action;

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
      // Dueling: +2 damage with a one-handed Melee weapon and no other weapon equipped; not the Light extra attack, which is a second weapon's.
      if (extra !== 'light') action = withDamageBonus(action, duelingBonus(attackerFeatures, action, readInventory(attackerSheet)));
      // Studied Attacks: the Fighter's last attack roll against this target missed.
      const studied = turnNow.marks.find((mark) => mark.kind === 'studied' && mark.attackerId === attackerId && mark.targetId === targetId);
      // Sacred Weapon: imbued as the Attack action is taken, for a use of Channel Divinity. For 10 minutes the
      // weapon adds the Charisma modifier to its attack rolls and deals its own damage type or Radiant.
      if (sacredWeapon) {
        if (!hasSacredWeapon(attackerSheet)) return refuseRequest(socket, ack, `${attackerToken.name} has no Sacred Weapon`);
        if (!canBeSacred(action)) return refuseRequest(socket, ack, 'Sacred Weapon imbues a Melee weapon');
        if (opportunity || readied || extra || (turnNow.active && !acting)) {
          return refuseRequest(socket, ack, 'Sacred Weapon is used as you take the Attack action');
        }
        const divinity = resourcesOf(attackerSheet!).find((entry) => entry.name === 'Channel Divinity');
        if (!divinity || divinity.used >= divinity.max) return refuseRequest(socket, ack, 'No uses of Channel Divinity left until a rest');
      }
      const sacred = attackerSheet !== null && canBeSacred(action) && (sacredWeapon === true || sacredWeaponOf(attackerToken) === action.name);
      if (radiant && !sacred) return refuseRequest(socket, ack, `${action.name} is not a Sacred Weapon`);
      if (sacred && attackerSheet) action = withSacredWeapon(action, sacredWeaponBonus(attackerSheet), radiant === true);

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
      // Brutal Strike: once on a Reckless Attack turn, one Strength attack that forgoes its Advantage.
      if (brutal) {
        if (!attackerSheet || !hasFeature(readFeatures(attackerSheet), 'Brutal Strike')) {
          return refuseRequest(socket, ack, `${attackerToken.name} has no Brutal Strike`);
        }
        if (!acting) return refuseRequest(socket, ack, 'Brutal Strike is used on your own turn in combat');
        if (!(reckless || alreadyReckless)) return refuseRequest(socket, ack, 'Brutal Strike is used on a turn you attack recklessly');
        if (!usesStrength(action, attackerToken, attackerSheet)) return refuseRequest(socket, ack, 'Brutal Strike is used with a Strength-based attack');
        if (brutalUsed(campaignId, attackerId)) return refuseRequest(socket, ack, `${attackerToken.name} has used Brutal Strike this turn`);
      }
      // Reckless Attack: Advantage on the Barbarian's Strength attacks, and on attacks against it.
      const attackingRecklessly =
        (reckless || alreadyReckless) && attackerSheet !== null && usesStrength(action, attackerToken, attackerSheet);
      const targetReckless = turnNow.marks.some((mark) => mark.kind === 'reckless' && mark.attackerId === targetId);
      // Frenzy: on its own turn, raging and reckless, a Berserker's first Strength hit deals as many extra d6s as its Rage Damage.
      const frenzy =
        acting && attackerRaging && attackingRecklessly && !frenzyUsed(campaignId, attackerId)
          ? frenzyDamage(attackerSheet, action.attack?.damage[0]?.type ?? null)
          : null;
      // A target that saved against a Stunning Strike: the next attack roll against it has Advantage.
      const staggered = turnNow.marks.find((mark) => mark.kind === 'stunning' && mark.targetId === targetId && mark.action !== 'used');
      // Steady Aim: the Rogue's next attack roll this turn has Advantage.
      const steadied = acting?.steadyAim === 'ready';
      const extraReasons = [
        ...(steadied ? ['Advantage: Steady Aim'] : []),
        ...(staggered ? ['Advantage: Stunning Strike'] : []),
        ...(attackingRecklessly ? ['Advantage: Reckless Attack'] : []),
        ...(targetReckless ? [`Advantage: Reckless Attack (${targetToken.name})`] : []),
        ...(vexed ? [`Advantage: Vex (${attackerToken.name}'s last hit)`] : []),
        ...(studied ? ['Advantage: Studied Attacks'] : []),
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
      // Cunning Strike: the dice its effect costs come off the Sneak Attack before the roll.
      // Improved Cunning Strike allows two effects; Devious Strikes and Supreme Sneak add their own.
      let cunningCost = 0;
      let cunningLabel = '';
      if (cunning.length > 0) {
        const chosen = chooseCunningStrike(cunning, featureNamesOf(attackerSheet), sneakDice);
        if (!chosen.ok) {
          return refuseRequest(socket, ack, chosen.reason === 'no Cunning Strike' ? `${attackerToken.name} has no Cunning Strike` : chosen.reason);
        }
        if (cunning.includes('poison') && !hasPoisonersKit(attackerSheet!)) {
          return refuseRequest(socket, ack, 'The Poison effect needs a Poisoner’s Kit in the inventory');
        }
        if (cunning.includes('stealth') && !(attackerToken.conditions ?? []).includes('Invisible')) {
          return refuseRequest(socket, ack, 'Stealth Attack is used while hidden: the Hide action’s Invisible condition');
        }
        cunningCost = chosen.cost;
        cunningLabel = chosen.label;
      }
      const sneakRolled = sneakDice - cunningCost;
      const sneakAttack = (rolled: 'normal' | 'advantage' | 'disadvantage') => {
        // With every die forgone, a Sneak Attack still counts as dealt: the effect needs it.
        const damage = sneakAttackDamage(Math.max(1, sneakRolled), action, rolled, allyBesideTarget);
        if (!damage) return null;
        return { label: `Sneak Attack (${sneakRolled}d6${cunningLabel ? `, Cunning Strike: ${cunningLabel}` : ''})`, damage: sneakRolled > 0 ? damage : { ...damage, roll: { ...damage.roll, count: 0 } } };
      };

      // On a lit map, darkness decides who sees whom, as the views draw it.
      const lit = map.lightingEnabled
        ? {
            attacker: !creatureSees(targetToken, attackerToken, map),
            target: !creatureSees(attackerToken, offer ? { ...targetToken, position: offer.from } : targetToken, map),
          }
        : undefined;

      const attackRequest: AttackRequest = {
        unseen: lit,
        extraReasons,
        ...(brutal ? { forgoAdvantage: 'Brutal Strike' } : {}),
        // Elusive (Rogue 18): no attack roll against it has Advantage, unless it is Incapacitated.
        ...(targetSheet && hasFeature(readFeatures(targetSheet), 'Elusive') ? { noAdvantage: 'Elusive' } : {}),
        hitDamage: [
          // Hunter's Mark: a hit on the creature the attacker marks adds 1d6 Force.
          ...(huntersMarkOf(campaignId, attackerId) === targetId
            ? [{ label: "Hunter's Mark", damage: { roll: { count: 1, sides: 6 }, type: 'force' as const } }]
            : []),
          ...(brutal && attackerSheet
            ? [{ label: `Brutal Strike (${BRUTAL_LABELS[brutal]})`, damage: brutalStrikeDamage(attackerSheet, action.attack?.damage[0]?.type ?? null) }]
            : []),
          // Radiant Strikes: a Paladin's hit with a Melee weapon or an Unarmed Strike adds 1d8 Radiant.
          ...[radiantStrikes(attackerSheet, action)].flatMap((damage) => (damage ? [{ label: 'Radiant Strikes', damage }] : [])),
          ...(frenzy ? [{ label: `Frenzy (${frenzy.roll.count}d6)`, damage: frenzy }] : []),
        ],
        bonusDamage: sneakDice > 0 ? sneakAttack : undefined,
        savage,
        greatWeapon: greatWeaponFighting(attackerFeatures, action),
        // A Champion's Improved or Superior Critical, with weapons and Unarmed Strikes.
        criticalFrom: criticalFrom(attackerFeatures, action),
        // In an Aura of Courage, the Frightened condition does not affect the attacker.
        attacker: combatant(await calmedByAura(campaignId, map.id, attackerToken), attackerSheet, [], attackerRaging),
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
      };
      let result = resolveAttack(attackRequest);
      if (!result.ok) return refuseRequest(socket, ack, result.reason);
      // Seeking and Empowered Spell, as the rules have them: asked of the Sorcerer's player once the roll is known.
      let afterRollPoints = 0;
      const pointsLeft = () => {
        const points = attackerSheet ? resourcesOf(attackerSheet).find((entry) => entry.name === 'Sorcery Points') : undefined;
        return points ? points.max - points.used - (meta && !('error' in meta) ? meta.cost : 0) - afterRollPoints : 0;
      };
      if (attackerSheet && action.source === 'spell' && !result.outcome.hit && knowsMetamagic(attackerSheet, 'seeking') && pointsLeft() >= 1) {
        const choice = await askReaction(io, campaignId, {
          token: attackerToken,
          text: `${attackerToken.name}'s ${action.name} misses ${targetToken.name} (${result.outcome.roll.total} against AC ${result.outcome.armorClass}).`,
          options: ['Seeking Spell'],
        });
        if (choice === 'Seeking Spell') {
          afterRollPoints += 1;
          const again = resolveAttack(attackRequest);
          if (again.ok) result = { ...again, bonuses: [...again.bonuses, 'Seeking Spell'] };
        }
      }
      // Bardic Inspiration: an attacker that missed while it holds the die is asked; the die is added to the same roll.
      if (!result.outcome.hit && result.outcome.roll.natural !== 1) {
        const added = await offerInspiration(io, campaignId, map.id, attackerToken, `${attackerToken.name}'s ${action.name} misses ${targetToken.name} (${result.outcome.roll.total} against AC ${result.outcome.armorClass}).`);
        if (added !== null) {
          const again = resolveAttack({ ...attackRequest, inspired: { roll: result.outcome.roll, added, label: 'Bardic Inspiration' } });
          if (again.ok) result = { ...again, bonuses: [...result.bonuses.filter((bonus) => !again.bonuses.includes(bonus)), ...again.bonuses] };
        }
      }
      // Stroke of Luck: a Rogue that still misses, with its use left, is asked; the d20 becomes a 20.
      let luckSpent = false;
      if (
        !result.outcome.hit &&
        (await offerStrokeOfLuck(io, campaignId, attackerToken, attackerSheet, `${attackerToken.name}'s ${action.name} misses ${targetToken.name} (${result.outcome.roll.total} against AC ${result.outcome.armorClass}).`))
      ) {
        const again = resolveAttack({ ...attackRequest, inspired: undefined, turned: { roll: result.outcome.roll, label: 'Stroke of Luck' } });
        if (again.ok) {
          result = { ...again, bonuses: [...result.bonuses.filter((bonus) => !again.bonuses.includes(bonus)), ...again.bonuses] };
          luckSpent = true;
        }
      }
      if (attackerSheet && action.source === 'spell' && result.outcome.hit && result.damage.length > 0 && knowsMetamagic(attackerSheet, 'empowered') && pointsLeft() >= 1) {
        const dice = result.damage.flatMap((line) => line.rolled.dice).join(', ');
        const choice = await askReaction(io, campaignId, {
          token: attackerToken,
          text: `${attackerToken.name}'s ${action.name} hits ${targetToken.name} for ${result.dealt} damage (dice ${dice}).`,
          options: ['Empowered Spell'],
        });
        if (choice === 'Empowered Spell') {
          afterRollPoints += 1;
          result = withRerolledDamage(result, target, action, empoweredCount(attackerSheet));
        }
      }
      // Divine Smite, as the rules have it: once a Melee weapon or Unarmed Strike hits (knowing whether it is a
      // Critical Hit), the Paladin's player is asked which slot to cast it with, a Bonus Action on its own turn.
      let smiteSlot: number | null = null;
      // Paladin's Smite: once until a Long Rest, Divine Smite is cast without a slot (as with a level 1 slot).
      let smiteFree = false;
      const maySmite =
        result.outcome.hit && attackerSheet !== null && hasDivineSmite(attackerSheet as SheetSpellcasting) && canSmiteWith(action) && !(turnNow.active && !acting) && !acting?.bonusAction;
      const smiteWithoutSlot =
        maySmite && attackerSheet !== null && resourcesOf(attackerSheet).some((entry) => entry.name === "Paladin's Smite" && entry.used < entry.max);
      const smiteSlots =
        maySmite && attackerSheet
          ? Object.entries(slotsLeft(attackerSheet as SheetSpellcasting))
              .map(([level, left]) => ({ level: Number(level), left: left - (cast.slotLevel === Number(level) ? 1 : 0) }))
              .filter((slot) => slot.left > 0)
              .map((slot) => slot.level)
          : [];
      const smiteOptions = [...(smiteWithoutSlot ? [FREE_SMITE] : []), ...smiteSlots.map((level) => `Divine Smite (level ${level})`)];
      if (smiteOptions.length > 0) {
        const choice = await askReaction(io, campaignId, {
          token: attackerToken,
          text: `${attackerToken.name} ${result.outcome.critical ? 'lands a Critical Hit on' : 'hits'} ${targetToken.name} with ${action.name} for ${result.dealt} damage.`,
          options: smiteOptions,
        });
        smiteFree = choice === FREE_SMITE;
        const picked = smiteFree ? 1 : choice ? Number(/\(level (\d)\)/.exec(choice)?.[1]) : NaN;
        if (Number.isInteger(picked)) {
          if (!smiteFree) smiteSlot = picked;
          result = withExtraDamage(result, target, action.name, {
            label: smiteFree ? FREE_SMITE : `Divine Smite (level ${picked})`,
            damage: divineSmiteDamage(picked, (targetToken.statBlock as { creatureType?: string } | undefined)?.creatureType),
          });
        }
      }
      // Divine Strike (Blessed Strikes): once on each of the Cleric's turns, a weapon hit can add Radiant or Necrotic damage.
      let divineStrike = false;
      const strikeDice = result.outcome.hit && !(turnNow.active && !acting) && !divineStrikeUsed(campaignId, attackerId) ? divineStrikeDice(attackerSheet, action) : 0;
      if (strikeDice > 0) {
        const choice = await askReaction(io, campaignId, {
          token: attackerToken,
          text: `${attackerToken.name} ${result.outcome.critical ? 'lands a Critical Hit on' : 'hits'} ${targetToken.name} with ${action.name} for ${result.dealt} damage.`,
          options: Object.keys(DIVINE_STRIKE_OPTIONS),
        });
        const type = choice ? DIVINE_STRIKE_OPTIONS[choice] : undefined;
        if (choice && type) {
          divineStrike = true;
          result = withExtraDamage(result, target, action.name, { label: choice, damage: divineStrikeDamage(strikeDice, type) });
        }
      }
      // Primal Strike: once on each of the Druid's turns, a hit with a weapon or a Beast form's attack adds
      // 1d8 (2d8 from Druid 15) of the type its player chooses then.
      const primal =
        result.outcome.hit && attackerSheet && !(turnNow.active && !acting) && !usedThisTurn(primalStrikes, campaignId, attackerId)
          ? primalStrikeDice(attackerSheet, action, wildShapeOf(attackerToken) !== null)
          : null;
      if (primal) {
        const chosen = primalStrikeChoice(
          await askReaction(io, campaignId, {
            token: attackerToken,
            text: `${attackerToken.name} ${result.outcome.critical ? 'lands a Critical Hit on' : 'hits'} ${targetToken.name} with ${action.name} for ${result.dealt} damage.`,
            options: [...PRIMAL_STRIKE_OPTIONS],
          })
        );
        if (chosen) {
          useThisTurn(primalStrikes, campaignId, attackerId);
          result = withExtraDamage(result, target, action.name, {
            label: `Primal Strike (${chosen.charAt(0).toUpperCase()}${chosen.slice(1)})`,
            damage: { roll: primal, type: chosen },
          });
        }
      }
      // Uncanny Dodge, Deflect Attacks: once the hit and its damage are known, the target's player is asked.
      let redirect: { dealt: number; hp: HitPoints | null; line: string } | null = null;
      if (result.outcome.hit && result.dealt > 0 && targetSheet && !getCombatState(campaignId).reactionsSpent.includes(targetId)) {
        const targetState = readConditions(targetToken.conditions ?? []);
        const own = readFeatures(targetSheet);
        const options: string[] = [];
        if (canAct(targetState)) {
          // Uncanny Dodge answers an attacker the target can see.
          const sees = !targetState.has.has('blinded') && !readConditions(attackerToken.conditions ?? []).has.has('invisible') && !lit?.attacker;
          if (hasFeature(own, 'Uncanny Dodge') && sees) options.push('Uncanny Dodge');
          const deflectable = deflectReduction(targetSheet).types;
          if (hasFeature(own, 'Deflect Attacks') && result.damage.some((line) => line.type !== null && deflectable.includes(line.type))) {
            options.push('Deflect Attacks');
          }
        }
        const choice = await askReaction(io, campaignId, {
          token: targetToken,
          text: `${attackerToken.name} hits ${targetToken.name} with ${action.name} for ${result.dealt} damage.`,
          options,
        });
        if (choice === 'Uncanny Dodge') result = withReaction(result, target, action.name, { kind: 'halve', label: 'Uncanny Dodge' });
        if (choice === 'Deflect Attacks') result = withReaction(result, target, action.name, { kind: 'reduce', reduction: deflectReduction(targetSheet) });
        // Deflect Attacks, the redirect: with the damage brought to 0, the Monk may spend a Focus Point to send the
        // attack back at an attacker it can see, within 5 feet (a melee attack) or 60 feet (a ranged one).
        const redirectPoints = resourcesOf(targetSheet).find((entry) => entry.name === 'Focus Points');
        const redirectOption = 'Redirect (1 Focus Point)';
        if (
          choice === 'Deflect Attacks' &&
          result.reducedBy &&
          result.dealt === 0 &&
          redirectPoints !== undefined &&
          redirectPoints.used < redirectPoints.max &&
          result.distanceFeet <= (action.attack?.kind === 'ranged' ? REDIRECT_RANGED_FEET : REDIRECT_MELEE_FEET) &&
          !targetState.has.has('blinded') &&
          !readConditions(attackerToken.conditions ?? []).has.has('invisible') &&
          !lit?.attacker &&
          (await askReaction(io, campaignId, {
            token: targetToken,
            text: `${targetToken.name} deflects ${attackerToken.name}'s ${action.name}: no damage. Redirect it at ${attackerToken.name}?`,
            options: [redirectOption],
          })) === redirectOption
        ) {
          const dc = monkSaveDC(targetSheet);
          const save = await monkFeatureSave(campaignId, map.id, attackerToken, attackerSheet, 'dex', dc);
          if (save.success) redirect = { dealt: 0, hp: null, line: `Deflect Attacks redirect (1 Focus Point): ${attackerToken.name} saves (${save.text})` };
          else {
            // The damage is of the type the attack dealt.
            const type = result.damage.find((line) => line.type !== null)?.type ?? 'bludgeoning';
            const rolled = rollDamage(redirectDamage(targetSheet));
            const struck = combatant(attackerToken, attackerSheet, [], attackerRaging);
            const applied = applyDamage(struck.hp ?? { current: 1, max: 1, temp: 0 }, [{ amount: rolled.total, type }], struck.defences);
            redirect = {
              dealt: applied.dealt,
              hp: struck.hp ? applied.hp : null,
              line: `Deflect Attacks redirect (1 Focus Point): ${attackerToken.name} fails (${save.text}) and takes ${applied.dealt} ${type} damage`,
            };
          }
        }
      }
      const undo = await prepareUndo(campaignId, map.id, [attackerToken.characterId, targetToken.characterId]);
      // The slot goes before the damage: a cast that finds it gone changes nothing.
      if (cast.slotLevel !== null && !(await spendSlot(campaignId, socket.userId, attackerToken.characterId!, cast.slotLevel))) {
        return refuseRequest(socket, ack, `No level ${cast.slotLevel} spell slot left to cast ${action.name}`);
      }
      // Divine Smite cast: its slot and the Bonus Action.
      if (smiteSlot !== null) {
        if (!(await spendSlot(campaignId, socket.userId, attackerToken.characterId!, smiteSlot))) {
          return refuseRequest(socket, ack, `No level ${smiteSlot} spell slot left for Divine Smite`);
        }
        spendBonusAction(campaignId, attackerId);
      }
      if (smiteFree) {
        await spendSheetUse(campaignId, attackerToken, "Paladin's Smite");
        spendBonusAction(campaignId, attackerId);
      }

      const endured = await applyDealt(io, campaignId, map.id, [{ token: targetToken, sheet: targetSheet, dealt: result.dealt, hp: result.hp, critical: result.outcome.critical }]);
      // A deflected attack sent back: the Monk's Focus Point, and what the attacker took.
      if (redirect) {
        await spendSheetUse(campaignId, targetToken, 'Focus Points');
        endured.push(redirect.line, ...(await applyDealt(io, campaignId, map.id, [{ token: attackerToken, sheet: attackerSheet, dealt: redirect.dealt, hp: redirect.hp }])));
      }
      spendRecharge(campaignId, attackerId, action);
      // Sacred Weapon imbued with this attack: the use of Channel Divinity, and the weapon kept on the token for 10 minutes.
      const sacredLines: string[] = [];
      if (sacredWeapon && attackerSheet) {
        await spendSheetUse(campaignId, attackerToken, 'Channel Divinity');
        await setTokenMetadata(io, campaignId, map.id, attackerId, 'sacredWeapon', { weapon: action.name, until: Date.now() + SACRED_WEAPON_MS });
        sacredLines.push(`Sacred Weapon, a use of Channel Divinity: +${sacredWeaponBonus(attackerSheet)} to attack rolls with ${action.name} for 10 minutes`);
      }
      if (meta || afterRollPoints > 0) {
        await spendSheetUse(campaignId, attackerToken, 'Sorcery Points', (meta && !('error' in meta) ? meta.cost : 0) + afterRollPoints);
      }
      // A concentration spell cast starts its concentration, ending any other.
      const concentrating = action.spell ? findSpell(action.name) : null;
      if (concentrating?.concentration) startConcentration(campaignId, attackerId, concentrating.name);
      if (vexed || sapped || helped || studied) useMarks(campaignId, [vexed, sapped, helped, studied]);
      // Studied Attacks: a miss gives the Fighter Advantage on its next attack roll against this creature.
      if (!result.outcome.hit && hasStudiedAttacks(attackerFeatures)) addMark(campaignId, { kind: 'studied', attackerId, targetId });
      // Steady Aim is spent by the roll it gave Advantage to.
      if (steadied) {
        const now = getCombatState(campaignId);
        if (now.turn && now.currentTokenId === attackerId) {
          now.turn = { ...now.turn, steadyAim: 'used' };
          setCombatState(campaignId, now);
        }
      }
      if (luckSpent) await spendSheetUse(campaignId, attackerToken, 'Stroke of Luck');
      if (result.halvedBy || result.reducedBy) await spendReaction(io, campaignId, targetId);
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
      if (divineStrike) useDivineStrike(campaignId, attackerId);
      if (frenzy && result.outcome.hit) useFrenzy(campaignId, attackerId);
      if (attackerRaging && turnNow.currentTokenId === attackerId) keepRaging(campaignId, attackerId);
      const mastered = await applyMastery(io, campaignId, map, action, attackerToken, attackerSheet, targetToken, targetSheet, result, target.defences);
      // A stat block's hit can leave a condition: a grapple, a poison, a fall.
      const riders =
        action.source === 'statBlock' && result.outcome.hit && !result.dropped
          ? await applyRiders(io, campaignId, map.id, attackerToken, targetToken, conditionsOnHit(action.text ?? ''))
          : [];
      // The Advantage a saved Stunning Strike gave is used by this roll; the halved Speed stays.
      if (staggered) {
        const now = getCombatState(campaignId);
        now.marks = now.marks.map((mark) => (mark === staggered || (mark.kind === 'stunning' && mark.targetId === targetId) ? { ...mark, action: 'used' } : mark));
        setCombatState(campaignId, now);
      }
      // Stunning Strike: once a turn, when a Monk weapon or an Unarmed Strike hits, the Monk's player is asked;
      // it spends a Focus Point, and the target makes a Constitution save.
      const stunLines: string[] = [];
      const focus = attackerSheet ? resourcesOf(attackerSheet).find((entry) => entry.name === 'Focus Points') : undefined;
      const mayStun =
        result.outcome.hit &&
        attackerSheet !== null &&
        hasFeature(readFeatures(attackerSheet), 'Stunning Strike') &&
        isMonkAttack(action) &&
        !stunUsed(campaignId, attackerId) &&
        focus !== undefined &&
        focus.used < focus.max;
      const stun =
        mayStun &&
        (await askReaction(io, campaignId, {
          token: attackerToken,
          text: `${attackerToken.name} hits ${targetToken.name} with ${action.name}.`,
          options: ['Stunning Strike'],
        })) === 'Stunning Strike';
      if (stun && attackerSheet) {
        useStun(campaignId, attackerId);
        await spendSheetUse(campaignId, attackerToken, 'Focus Points');
        if (!result.dropped) {
          const dc = monkSaveDC(attackerSheet);
          const modifiers = saveModifiers(readConditions(targetToken.conditions ?? []), 'con');
          const aura = await auraFor(campaignId, map.id, targetToken);
          const save = savingThrow({ bonus: (saveBonusOf(targetToken, targetSheet, 'con') ?? 0) + aura.bonus + modifiers.penalty, dc, mode: modifiers.mode, autoFail: modifiers.autoFail });
          const rolled = save.roll ? `${save.roll.total}` : 'no roll';
          if (save.success) {
            const now = getCombatState(campaignId);
            now.marks = [
              ...now.marks.filter((mark) => !(mark.kind === 'stunning' && mark.targetId === targetId)),
              { kind: 'stunning', attackerId, targetId, turnEndsLeft: 1 },
            ];
            setCombatState(campaignId, now);
            stunLines.push(
              `Stunning Strike: ${targetToken.name} saves (Constitution ${rolled} vs DC ${dc}); its Speed is halved and the next attack roll against it has Advantage until ${attackerToken.name}'s next turn`
            );
          } else {
            stunLines.push(`Stunning Strike: ${targetToken.name} fails (Constitution ${rolled} vs DC ${dc})`);
            stunLines.push(
              ...(await applyRiders(io, campaignId, map.id, attackerToken, targetToken, [{ condition: 'Stunned', until: `start of ${attackerToken.name}'s next turn` }]))
            );
          }
        }
      }
      // Open Hand Technique: a hit with a Flurry of Blows strike imposes Addle, Push or Topple; the Monk's player is asked.
      if (extra === 'flurry' && result.outcome.hit && !result.dropped && attackerSheet && hasFeature(readFeatures(attackerSheet), 'Open Hand Technique')) {
        const technique = await askReaction(io, campaignId, {
          token: attackerToken,
          text: `${attackerToken.name} hits ${targetToken.name} with a Flurry of Blows strike. Open Hand Technique:`,
          options: OPEN_HAND_OPTIONS,
        });
        const dc = monkSaveDC(attackerSheet);
        // A Stunned creature fails Strength and Dexterity saves: the Stunning Strike just before counts.
        const carried = [...(targetToken.conditions ?? []), ...(stunLines.some((line) => line.includes('Stunned')) ? ['Stunned'] : [])];
        if (technique === 'Addle') {
          addMark(campaignId, { kind: 'addle', attackerId: targetId, targetId });
          const now = getCombatState(campaignId);
          now.opportunities = now.opportunities.filter((offered) => offered.attackerId !== targetId);
          setCombatState(campaignId, now);
          await resendInitiativeState(io, campaignId);
          stunLines.push(`Open Hand Technique (Addle): ${targetToken.name} can't make Opportunity Attacks until the start of its next turn`);
        } else if (technique === 'Push') {
          const save = await monkFeatureSave(campaignId, map.id, targetToken, targetSheet, 'str', dc, carried);
          if (save.success) stunLines.push(`Open Hand Technique (Push): ${targetToken.name} saves (${save.text})`);
          else {
            const squares = Math.max(1, Math.round(OPEN_HAND_PUSH_FEET / (map.feetPerSquare || 5)));
            const moved = await pushToken(io, campaignId, map, attackerToken, targetToken, squares);
            stunLines.push(`Open Hand Technique (Push): ${targetToken.name} fails (${save.text}) and ${moved ? `is pushed ${OPEN_HAND_PUSH_FEET} ft` : 'has nowhere to be pushed'}`);
          }
        } else if (technique === 'Topple') {
          const save = await monkFeatureSave(campaignId, map.id, targetToken, targetSheet, 'dex', dc, carried);
          if (save.success) stunLines.push(`Open Hand Technique (Topple): ${targetToken.name} saves (${save.text})`);
          else {
            await giveCondition(io, campaignId, map.id, targetToken.id, 'Prone');
            stunLines.push(`Open Hand Technique (Topple): ${targetToken.name} fails (${save.text}) and is Prone`);
          }
        }
      }
      // Cunning Strike: when Sneak Attack was dealt, its effect right after the damage.
      const cunningLines: string[] = [];
      if (cunning.length > 0 && attackerSheet && result.outcome.hit && result.bonuses.some((bonus) => bonus.startsWith('Sneak Attack'))) {
        const dc = cunningStrikeDC(attackerSheet);
        const aura = await auraFor(campaignId, map.id, targetToken);
        const saveAgainst = (ability: Ability) => {
          const modifiers = saveModifiers(readConditions(targetToken.conditions ?? []), ability);
          return savingThrow({ bonus: (saveBonusOf(targetToken, targetSheet, ability) ?? 0) + aura.bonus + modifiers.penalty, dc, mode: modifiers.mode, autoFail: modifiers.autoFail });
        };
        const rolledOf = (save: ReturnType<typeof savingThrow>) => (save.roll ? `${save.roll.total}` : 'no roll');
        // An effect that calls for a save: the save, its line, and what a failure does.
        const saveOr = async (effect: CunningEffect, ability: Ability, failed: () => Promise<string[]> | string[]) => {
          const save = saveAgainst(ability);
          const head = `Cunning Strike (${CUNNING_LABELS[effect]}): ${targetToken.name}`;
          const versus = `(${ABILITY_CHECK_NAMES[ability]} ${rolledOf(save)} vs DC ${dc})`;
          if (save.success) {
            cunningLines.push(`${head} saves ${versus}`);
            return;
          }
          const after = await failed();
          cunningLines.push(`${head} fails ${versus}${effect === 'trip' ? ' and is Prone' : ''}`, ...after);
        };
        for (const effect of cunning) {
          if (effect === 'withdraw') {
            cunningLines.push(`Cunning Strike (Withdraw): ${attackerToken.name} may move up to half its Speed without provoking Opportunity Attacks`);
          } else if (effect === 'stealth') {
            cunningLines.push(
              `Cunning Strike (Stealth Attack): the attack does not end ${attackerToken.name}'s Invisible condition if it ends the turn behind Three-Quarters or Total Cover`
            );
          } else if (result.dropped) {
            continue;
          } else if (effect === 'poison') {
            await saveOr(effect, 'con', () => applyRiders(io, campaignId, map.id, attackerToken, targetToken, [{ condition: 'Poisoned', repeats: true }], { ability: 'con', dc }));
          } else if (effect === 'trip') {
            if (Math.max(targetToken.size?.width ?? 1, targetToken.size?.height ?? 1) > 2) {
              cunningLines.push(`Cunning Strike (Trip): ${targetToken.name} is too large to trip`);
            } else {
              await saveOr(effect, 'dex', async () => {
                await giveCondition(io, campaignId, map.id, targetToken.id, 'Prone');
                return [];
              });
            }
          } else if (effect === 'daze') {
            await saveOr(effect, 'con', () => [`${targetToken.name} is dazed: on its next turn it can only move, or take an action, or take a Bonus Action`]);
          } else if (effect === 'knockOut') {
            await saveOr(effect, 'con', async () => {
              const lines = await applyRiders(io, campaignId, map.id, attackerToken, targetToken, [{ condition: 'Unconscious', repeats: true }], { ability: 'con', dc });
              // Damage ends it: the mark is named so the next damage takes the condition off.
              const now = getCombatState(campaignId);
              now.marks = now.marks.map((mark) =>
                mark.kind === 'condition' && mark.targetId === targetId && mark.condition === 'Unconscious' && mark.ends === 'save' ? { ...mark, action: 'Knock Out' } : mark
              );
              setCombatState(campaignId, now);
              return [...lines, 'for 1 minute or until it takes damage'];
            });
          } else if (effect === 'obscure') {
            await saveOr(effect, 'dex', () => applyRiders(io, campaignId, map.id, attackerToken, targetToken, [{ condition: 'Blinded', until: 'end of its next turn' }]));
          }
        }
      }
      // Repelling Blast: a hit with the cantrip may push a Large or smaller creature 10 feet; the Warlock's player is asked.
      if (
        attackerSheet &&
        result.outcome.hit &&
        !result.dropped &&
        repels(attackerSheet, action) &&
        Math.max(targetToken.size?.width ?? 1, targetToken.size?.height ?? 1) <= 2 &&
        (await askReaction(io, campaignId, {
          token: attackerToken,
          text: `${attackerToken.name}'s ${action.name} hits ${targetToken.name}.`,
          options: ['Repelling Blast'],
        })) === 'Repelling Blast'
      ) {
        const squares = Math.max(1, Math.round(10 / (map.feetPerSquare || 5)));
        const moved = await pushToken(io, campaignId, map, attackerToken, targetToken, squares);
        cunningLines.push(moved ? `Repelling Blast: ${targetToken.name} is pushed 10 ft` : `Repelling Blast: ${targetToken.name} has nowhere to be pushed`);
      }
      // Brutal Strike: used with the roll; on a hit, its effect.
      const brutalLines: string[] = [];
      if (brutal) {
        useBrutal(campaignId, attackerId);
        if (result.outcome.hit && brutal === 'forceful') {
          const squares = Math.max(1, Math.round(FORCEFUL_FEET / (map.feetPerSquare || 5)));
          const moved = await pushToken(io, campaignId, map, attackerToken, targetToken, squares);
          brutalLines.push(moved ? `Forceful Blow: ${targetToken.name} is pushed ${FORCEFUL_FEET} ft` : `Forceful Blow: ${targetToken.name} has nowhere to be pushed`);
        }
        if (result.outcome.hit && brutal === 'hamstring') {
          // Only the most recent Hamstring Blow counts.
          const now = getCombatState(campaignId);
          now.marks = [
            ...now.marks.filter((mark) => !(mark.kind === 'hamstring' && mark.targetId === targetId)),
            { kind: 'hamstring', attackerId, targetId, turnEndsLeft: 1 },
          ];
          setCombatState(campaignId, now);
          brutalLines.push(`Hamstring Blow: ${targetToken.name}'s Speed is ${HAMSTRING_FEET} ft lower until ${attackerToken.name}'s next turn`);
        }
      }
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
      } else if (meta?.quickened) {
        spendBonusAction(campaignId, attackerId);
        await resendInitiativeState(io, campaignId);
      } else if (!extra) await spendAction(io, campaignId, attackerId, weapon ? 'Attack' : 'Magic', weapon);
      // An attack by or on a token the players are not shown goes to the DM alone.
      const secret = hiddenFromPlayers(attackerToken) || hiddenFromPlayers(targetToken);
      const extraLabel = offer?.reason
        ? offer.reason
        : legendaryTaken
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
      const summary = [result.summary, ...(extraLabel ? [extraLabel] : []), ...result.bonuses, ...(mastered ? [mastered] : []), ...sacredLines, ...brutalLines, ...cunningLines, ...stunLines, ...riders, ...endured].join('; ');
      await logRoll(io, socket, campaignId, breakdownOf(result), attackerToken.name, summary, secret);

      commitUndo(campaignId, undo, summary);
      answer(ack, { ...result, summary });
      // Retaliation: a Berserker damaged from within 5 feet is asked, once the attack is settled.
      await offerRetaliation(io, campaignId, map, attackerToken, targetToken, result.dealt);
      logger.debug('combat.attack', { campaignId, attackerId, targetId, hit: result.outcome.hit, dealt: result.dealt });
    } catch (error) {
      logger.error('combat.attack failed', { err: error });
      refuseRequest(socket, ack, 'Failed to resolve the attack');
    }
  });

  /**
   * COMBAT.FALL — A token on the current map has fallen `feet` feet: the server rolls 1d6 Bludgeoning damage for every 10 feet, at most 20d6, takes it from the token's hit points through its defences, gives it the Prone condition unless it took no damage, and records the roll in the dice log. A Monk with Slow Fall that would take damage, able to act and with its reaction unspent, is asked first (`combat.prompt`): the reaction takes five times its Monk level off the damage. The DM, or the player who controls the token.
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
      let result = resolveFall({ name: faller.name, hp: faller.hp, defences: faller.defences }, feet);
      // Slow Fall: a Monk that would take damage is asked, and its Reaction takes five times its Monk level off.
      let slowed = false;
      if (
        sheet &&
        result.dealt > 0 &&
        hasFeature(readFeatures(sheet), 'Slow Fall') &&
        slowFallReduction(sheet) > 0 &&
        canAct(readConditions(token.conditions ?? [])) &&
        !getCombatState(campaignId).reactionsSpent.includes(tokenId)
      ) {
        const choice = await askReaction(io, campaignId, {
          token,
          text: `${token.name} falls ${feet} ft for ${result.dealt} damage.`,
          options: ['Slow Fall'],
        });
        if (choice === 'Slow Fall') {
          result = withSlowFall(result, { name: faller.name, hp: faller.hp }, slowFallReduction(sheet));
          slowed = true;
        }
      }
      const undo = await prepareUndo(campaignId, map.id, [token.characterId]);
      if (slowed) await spendReaction(io, campaignId, tokenId);

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
   * COMBAT.CHECK — A token on the current map makes an ability check: a skill, a bare ability, or the Hide action. A failed check with a DC by a Fighter with Tactical Mind waits while its controller is asked whether to add 1d10 (`combat.prompt`), and one by a level 20 Rogue with Stroke of Luck unspent while it is asked whether to turn the d20 into a 20. A Rogue with Reliable Talent treats a d20 of 9 or lower as a 10 on a check with a skill its sheet marks proficient. With `skill: 'sleightOfHand'` and `bonusAction: true` a Thief with Fast Hands makes the check as a Bonus Action on its own turn. The server reads the bonus from the character's sheet or the stat block, rolls the d20 with the token's conditions (Disadvantage while Poisoned or Frightened, the Exhaustion penalty), compares the total with the DC when one is given, and records the roll in the dice log. The Hide action is a Dexterity (Stealth) check against DC 15 that gives the token the Invisible condition on a success and is its action on its own turn. A raging Barbarian with Primal Knowledge makes an Acrobatics, Intimidation, Perception, Stealth or Survival check with Strength when that is no worse than the skill's own ability, and one with Indomitable Might uses its Strength score for a Strength check that totals less. The DM, or the player who controls the token.
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
      const fastHands = bonusAction === true && !hide && parsed.data.skill === 'sleightOfHand';
      const skill = hide ? 'stealth' : parsed.data.skill;
      const dc = hide ? HIDE_DC : parsed.data.dc;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const token = readTokens(map.tokens).find((t) => t.id === tokenId);
      if (!token || !canControlToken(socket.role, token.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      const sheet = await sheetOf(token, campaignId);
      // In an Aura of Courage, the Frightened condition does not affect the check.
      const creature = combatant(await calmedByAura(campaignId, map.id, token), sheet, [], isRaging(campaignId, tokenId));
      const state = readConditions(creature.conditions, creature.exhaustion);
      if (hide && !canAct(state)) return refuseRequest(socket, ack, `${token.name} is Incapacitated and cannot take the Hide action`);
      // Hide as a Bonus Action is a Rogue's Cunning Action, on its own turn with the Bonus Action left.
      if (bonusAction) {
        const turnNow = getCombatState(campaignId);
        // A Thief's Fast Hands: a Dexterity (Sleight of Hand) check as a Bonus Action.
        if (!hide && !fastHands) return refuseRequest(socket, ack, 'Only the Hide action, or a Sleight of Hand check with Fast Hands, is taken as a Bonus Action');
        if (fastHands && !(sheet && hasFeature(readFeatures(sheet), 'Fast Hands'))) return refuseRequest(socket, ack, `${token.name} has no Fast Hands`);
        if (hide && (!sheet || !hasTurnFeature(sheet, 'Cunning Action'))) return refuseRequest(socket, ack, `${token.name} has no Cunning Action`);
        if (!(someoneActing(turnNow) && turnNow.currentTokenId === tokenId && turnNow.turn)) {
          return refuseRequest(socket, ack, `${hide ? 'Cunning Action' : 'Fast Hands'} is a Bonus Action on the creature’s own turn`);
        }
        if (turnNow.turn.bonusAction) return refuseRequest(socket, ack, `${token.name} has used its Bonus Action this turn`);
      }

      const listedBonus = skill ? skillBonusOf(token, sheet, skill) : abilityModifierOf(token, sheet, ability!);
      if (listedBonus === null) return refuseRequest(socket, ack, `${token.name} has no sheet or stat block to make the check with`);
      // Primal Knowledge: a raging Barbarian makes the check with Strength when that is no worse than the skill's own ability.
      const strengthBonus =
        skill && SKILL_CHECKS[skill].ability !== 'str' && primalKnowledgeApplies(sheet, isRaging(campaignId, tokenId), skill)
          ? listedBonus - (abilityModifierOf(token, sheet, SKILL_CHECKS[skill].ability) ?? 0) + (abilityModifierOf(token, sheet, 'str') ?? 0)
          : null;
      const primal = strengthBonus !== null && strengthBonus >= listedBonus;
      const bonus = primal ? strengthBonus : listedBonus;
      const used = primal ? 'str' : skill ? SKILL_CHECKS[skill].ability : ability!;
      const label = skill ? `${ABILITY_CHECK_NAMES[used]} (${SKILL_CHECKS[skill].name})` : ABILITY_CHECK_NAMES[ability!];
      // A Champion's Remarkable Athlete: Advantage on Strength (Athletics) checks.
      const athlete = skill === 'athletics' && used === 'str' && sheet !== null && hasRemarkableAthlete(readFeatures(sheet));
      // Reliable Talent (Rogue 7): on a check with a skill the sheet marks proficient, a d20 of 9 or lower counts as 10.
      const trained = skill ? (sheet?.skills as Record<string, { proficient?: unknown; expertise?: unknown } | undefined> | undefined)?.[skill] : undefined;
      const reliable = sheet !== null && hasFeature(readFeatures(sheet), 'Reliable Talent') && (trained?.proficient === true || trained?.expertise === true);
      let result = resolveCheck({ name: token.name, label, bonus, dc, mode, conditions: state, ability: used, lucky: hasLuck(sheet), reliable, ...(athlete ? { extraReasons: ['Advantage: Remarkable Athlete'] } : {}) });
      if (primal) result = { ...result, reasons: [...result.reasons, 'Primal Knowledge: made with Strength'] };
      // Indomitable Might: a Strength check's total is never less than the Strength score.
      const mighty = used === 'str' ? indomitableMight(sheet, result.total) : null;
      if (mighty !== null) {
        const success = dc === undefined ? null : mighty >= dc;
        result = {
          ...result,
          total: mighty,
          success,
          summary: `${token.name} ${label} check: ${success === null ? `${mighty}` : `${mighty} vs DC ${dc}: ${success ? 'success' : 'failure'}`} (Indomitable Might, rolled ${result.total})`,
        };
      }
      // Tactical Mind: a Fighter that failed the check, with a use of Second Wind left, is asked; it adds 1d10,
      // and the use is spent only if that turns the check into a success.
      const secondWind = sheet ? resourcesOf(sheet).find((entry) => entry.name === 'Second Wind') : undefined;
      if (result.success === false && dc !== undefined && sheet && hasFeature(readFeatures(sheet), 'Tactical Mind') && secondWind && secondWind.used < secondWind.max) {
        const choice = await askReaction(io, campaignId, {
          token,
          text: `${token.name} fails the ${label} check (${result.total} vs DC ${dc}).`,
          options: ['Tactical Mind'],
        });
        if (choice === 'Tactical Mind') {
          result = withTacticalMind(result, dc, rollDie(10));
          if (result.success) await spendSheetUse(campaignId, token, 'Second Wind');
        }
      }
      // Bardic Inspiration: a creature that failed the check while it holds the die is asked; the die is added.
      if (result.success === false && dc !== undefined) {
        const added = await offerInspiration(io, campaignId, map.id, token, `${token.name} fails the ${label} check (${result.total} vs DC ${dc}).`);
        if (added !== null) result = withInspiration(result, dc, added);
      }
      // Stroke of Luck: a Rogue that still fails, with its use left, is asked; the d20 becomes a 20.
      if (result.success === false && dc !== undefined && (await offerStrokeOfLuck(io, campaignId, token, sheet, `${token.name} fails the ${label} check (${result.total} vs DC ${dc}).`))) {
        result = withStrokeOfLuck(result, dc);
        await spendSheetUse(campaignId, token, 'Stroke of Luck');
      }

      const hidden = hide === true && result.success === true;
      if (hidden) await giveCondition(io, campaignId, map.id, tokenId, 'Invisible');
      if ((hide || fastHands) && bonusAction) {
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
      const { characterId, kind, recover } = parsed.data;
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
          // Arcane Recovery or Natural Recovery, chosen as the rest ends.
          const recovered = recover ? shortRestRecovery(back.sheet, recover) : null;
          if (recovered && !recovered.ok) return { refusal: `${fresh.name}: ${recovered.reason}` };
          const after = recovered?.ok ? recovered.sheet : back.sheet;
          const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(after) } });
          const gains = [...back.regained, ...(recovered?.ok ? [recovered.summary] : [])];
          return { updated, hp: null, die: null, summary: `${fresh.name} finishes a Short Rest: ${gains.length > 0 ? gains.join(', ') : 'no feature to regain'}` };
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
   * COMBAT.FEATURE — A token's D&D 5e character uses a class feature with a number of uses: `Second Wind` (a Bonus Action: the server rolls 1d10 + the character's level, restores those Hit Points and logs the roll), `Wholeness of Body` (a Bonus Action of a Monk whose sheet lists it: the Martial Arts die + Wisdom modifier Hit Points, at least 1, Wisdom-modifier uses until a Long Rest) or `Action Surge` (one more action this turn, once a turn: the turn's action is given back). `Bardic Inspiration` (a Bonus Action) takes the `targetId` of another creature within 60 feet: the die is kept on its token for an hour, and its controller is asked after a failed attack roll, save or check whether to add it. Also `Channel Divinity`, `Favored Enemy` (Hunter's Mark without a slot) and `Focus Points` or `Sorcery Points` (`amount` points at once): the server counts the use and the table applies what it does. `Wild Shape` (a Bonus Action) takes the `form` of a Beast the Druid's level allows: the form is kept on the token, the character gains Temporary Hit Points equal to its Druid level, and the Beast's actions, Armor Class and physical scores become its own until `End Wild Shape`. `Lay on Hands` (a Bonus Action) takes a `targetId` within 5 feet, the paladin itself when left out, and restores `amount` Hit Points from the pool, no more than the creature is missing, or with `cure: 'Poisoned'` spends 5 points to end that condition; with Restoring Touch `cure` may also be `Blinded`, `Charmed`, `Deafened`, `Frightened`, `Paralyzed` or `Stunned`, or a list of several at 5 points each, and an `amount` given with `cure` is restored as well. `Steady Aim` (a Rogue of level 3, a Bonus Action on its own turn, only if it has not moved this turn) gives Advantage on its next attack roll this turn and sets its Speed to 0 until the turn ends (`turn.steadyAim`). The use comes off the sheet's `featureUses`. On the character's own turn in combat, the Bonus Action must still be there for a feature that spends it. `Extend Rage` (a Bonus Action on the Barbarian's own turn) keeps a Rage going to the end of its next turn, and `Persistent Rage` gives back every use of Rage, once until a Long Rest. Entering a `Rage` with Persistent Rage keeps it for 10 minutes, and with Mindless Rage ends the Charmed and Frightened conditions on the token. The DM, or the player who controls the token. `Wild Resurgence` (Druid 5, no action) with a `slotLevel` expends that spell slot for a use of Wild Shape when none is left, once on each of the Druid's turns; without one it expends a use of Wild Shape for a level 1 spell slot, once until a Long Rest. `Wild Companion` (Druid 2, a Magic action) spends a use of Wild Shape, or the slot of `slotLevel`, to cast Find Familiar; the familiar is the table's.
   */
  socket.on('combat.feature', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.feature', ack)) return;
      const parsed = CombatFeatureSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { tokenId, feature, amount, targetId, cure, as, focus, form, slotLevel } = parsed.data;
      if ((targetId !== undefined && feature !== 'Lay on Hands' && feature !== 'Bardic Inspiration') || (cure !== undefined && feature !== 'Lay on Hands')) {
        return refuseRequest(socket, ack, 'Only Lay on Hands and Bardic Inspiration take a target');
      }
      if (slotLevel !== undefined && feature !== 'Wild Resurgence' && feature !== 'Wild Companion') {
        return refuseRequest(socket, ack, 'Only Wild Resurgence and Wild Companion take a spell slot');
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
      // Wild Shape: a Bonus Action that takes a Beast's form, with Temporary Hit Points; or leaves it.
      if (feature === 'Wild Shape' || feature === 'End Wild Shape') {
        if (ownTurn && combat.turn!.bonusAction) return refuseRequest(socket, ack, `${token.name} has used its Bonus Action this turn`);
        const shaped = wildShapeOf(token);
        if (feature === 'End Wild Shape') {
          if (!shaped) return refuseRequest(socket, ack, `${token.name} is in no Wild Shape form`);
          await setWildShape(io, campaignId, map, tokenId, null);
          if (ownTurn) spendBonusAction(campaignId, tokenId);
          await resendInitiativeState(io, campaignId);
          const summary = `${token.name} leaves the form of the ${shaped.name}`;
          ack?.({ ok: true, summary, left: 0 });
          return;
        }
        const uses = resourcesOf(ownSheet).find((entry) => entry.name === 'Wild Shape');
        if (!uses) return refuseRequest(socket, ack, `${token.name}: The sheet has no Wild Shape`);
        if (!form) return refuseRequest(socket, ack, 'Name the Beast whose form to take');
        const chosen = wildShapeForms(ownSheet).find((name) => name.toLowerCase() === form.toLowerCase());
        if (!chosen) return refuseRequest(socket, ack, `${token.name} cannot take the form of ${form}`);
        if (uses.used >= uses.max) return refuseRequest(socket, ack, 'No uses of Wild Shape left until a rest');
        await spendSheetUse(campaignId, token, 'Wild Shape');
        await setWildShape(io, campaignId, map, tokenId, chosen);
        const temporary = await giveTemporaryHitPoints(io, campaignId, characterId, wildShapeTemporaryHitPoints(ownSheet));
        if (ownTurn) spendBonusAction(campaignId, tokenId);
        await resendInitiativeState(io, campaignId);
        const left = uses.max - uses.used - 1;
        const summary = `${token.name} takes the form of the ${chosen}${temporary > 0 ? ` (${temporary} Temporary Hit Points)` : ''}, ${left} ${left === 1 ? 'use' : 'uses'} of Wild Shape left`;
        ack?.({ ok: true, summary, left });
        return;
      }
      // Wild Resurgence (no action): a spell slot for a use of Wild Shape, once on each of the Druid's turns with none
      // left; or a use for a level 1 slot, once until a Long Rest. Wild Companion: Find Familiar as a Magic action.
      if (feature === 'Wild Resurgence' || feature === 'Wild Companion') {
        const forUse = feature === 'Wild Resurgence' && slotLevel !== undefined;
        if (forUse && combat.active && !ownTurn) return refuseRequest(socket, ack, 'Wild Resurgence gives a use of Wild Shape on the Druid’s own turn');
        if (forUse && usedThisTurn(resurgences, campaignId, tokenId)) {
          return refuseRequest(socket, ack, `${token.name} has expended a spell slot with Wild Resurgence this turn`);
        }
        if (feature === 'Wild Companion' && ownTurn && combat.turn!.action && socket.role !== 'DM') {
          return refuseRequest(socket, ack, `${token.name} has taken its action this turn`);
        }
        const undo = await prepareUndo(campaignId, map.id, [characterId]);
        const changed = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
          const fresh = await tx.character.findUnique({ where: { id: characterId } });
          if (!fresh) return { refusal: 'has no D&D character sheet' };
          const sheet = (fresh.data ?? {}) as Record<string, unknown>;
          const change = feature === 'Wild Resurgence' ? wildResurgence(sheet, slotLevel) : wildCompanion(sheet, slotLevel);
          if (!change.ok) return { refusal: change.reason };
          const updated = await tx.character.update({ where: { id: characterId }, data: { data: toJson(change.sheet) } });
          return { updated, summary: change.summary };
        });
        if ('refusal' in changed) return refuseRequest(socket, ack, `${token.name}: ${changed.refusal}`);
        await bestEffort('sheet after a Druid feature', () =>
          emitCharacterUpdated(campaignId, changed.updated, { characterId, userId: changed.updated.userId, tokensChanged: false })
        );
        if (forUse) useThisTurn(resurgences, campaignId, tokenId);
        if (feature === 'Wild Companion') await spendAction(io, campaignId, tokenId, 'Magic');
        const shape = resourcesOf(changed.updated.data as Record<string, unknown>).find((entry) => entry.name === 'Wild Shape');
        const summary = `${token.name}: ${changed.summary}${feature === 'Wild Companion' ? '; the familiar is the table’s to place' : ''}`;
        await resendInitiativeState(io, campaignId);
        commitUndo(campaignId, undo, summary);
        ack?.({ ok: true, summary, left: shape ? shape.max - shape.used : 0 });
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
      // A Bonus Action extends a Rage to the end of the Barbarian's next turn.
      if (feature === 'Extend Rage') {
        if (!isRaging(campaignId, tokenId)) return refuseRequest(socket, ack, `${token.name} is not raging`);
        if (!ownTurn) return refuseRequest(socket, ack, 'A Rage is extended with a Bonus Action on the Barbarian’s own turn');
        if (combat.turn!.bonusAction) return refuseRequest(socket, ack, `${token.name} has used its Bonus Action this turn`);
        keepRaging(campaignId, tokenId);
        spendBonusAction(campaignId, tokenId);
        await resendInitiativeState(io, campaignId);
        const summary = `${token.name} extends its Rage to the end of its next turn`;
        ack?.({ ok: true, summary, left: 0 });
        return;
      }
      if (feature === 'Persistent Rage') {
        const rages = resourcesOf(ownSheet).find((entry) => entry.name === 'Rage');
        if (!rages || rages.used === 0) return refuseRequest(socket, ack, `${token.name} has every use of Rage`);
      }
      if (feature === 'Rage') {
        if (!combat.active) return refuseRequest(socket, ack, 'A Rage is kept during combat');
        if (isRaging(campaignId, tokenId)) return refuseRequest(socket, ack, `${token.name} is already raging`);
      }
      // Steady Aim (Rogue 3): a Bonus Action on a turn it has not moved; Advantage on its next attack roll, Speed 0.
      if (feature === 'Steady Aim') {
        if (!hasSteadyAim(ownSheet)) return refuseRequest(socket, ack, `${token.name} has no Steady Aim`);
        if (!ownTurn || !combat.turn) return refuseRequest(socket, ack, 'Steady Aim is a Bonus Action on the creature’s own turn');
        if (combat.turn.bonusAction) return refuseRequest(socket, ack, `${token.name} has used its Bonus Action this turn`);
        const refusal = steadyAimRefusal(combat.turn);
        if (refusal) return refuseRequest(socket, ack, refusal);
        combat.turn = { ...combat.turn, bonusAction: true, steadyAim: 'ready' };
        setCombatState(campaignId, combat);
        await resendInitiativeState(io, campaignId);
        const summary = `${token.name} uses Steady Aim: Advantage on its next attack roll this turn, and its Speed is 0 until the turn ends`;
        ack?.({ ok: true, summary, left: 0 });
        return;
      }
      const bonusAction =
        feature === 'Second Wind' || feature === 'Rage' || feature === 'Bardic Inspiration' || feature === 'Lay on Hands' || feature === 'Wholeness of Body' ||
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
        const touched = await layOnHands(io, socket, campaignId, map, token, targetId ?? tokenId, amount, cure === undefined ? [] : [...new Set(typeof cure === 'string' ? [cure] : cure)]);
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

      // Bardic Inspiration: another creature within 60 feet, which holds one die at a time.
      let inspired: Token | null = null;
      if (feature === 'Bardic Inspiration') {
        const picked = readTokens(map.tokens).find((t) => t.id === targetId);
        if (!targetId) return refuseRequest(socket, ack, 'Bardic Inspiration needs a creature to inspire');
        if (!picked || picked.layer !== token.layer || (socket.role !== 'DM' && hiddenFromPlayers(picked))) {
          return refuseRequest(socket, ack, 'That creature is not on the map');
        }
        if (picked.id === tokenId) return refuseRequest(socket, ack, 'Bardic Inspiration goes to another creature');
        const board = {
          heights: readTileHeights(map.tileHeights),
          feetPerSquare: map.feetPerSquare,
          diagonalRule: map.diagonalRule === 'alternating' ? ('alternating' as const) : ('flat' as const),
        };
        if (distanceFeet(standing(token), standing(picked), board) > 60) return refuseRequest(socket, ack, `${picked.name} is more than 60 feet away`);
        if (inspirationOf(picked)) return refuseRequest(socket, ack, `${picked.name} already holds a Bardic Inspiration die`);
        inspired = picked;
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
        let healed: { rolled: number; bonus: number; sides: number; hp: { current: number; max: number; temp: number } } | null = null;
        if (feature === 'Second Wind') {
          const rolled = rollDie(10);
          const bonus = secondWindBonus(sheet);
          const change = applyHpDelta(DND, next, rolled + bonus);
          if ('error' in change) return { refusal: `${token.name} tracks no Hit Points` };
          next = change.data as Record<string, unknown>;
          healed = { rolled, bonus, sides: 10, hp: change.hp };
        }
        // Wholeness of Body: the Martial Arts die + Wisdom modifier, at least 1 Hit Point.
        if (feature === 'Wholeness of Body') {
          const sides = martialArtsDie(sheet);
          const rolled = rollDie(sides);
          const total = wholenessOfBodyHealing(sheet, rolled);
          const change = applyHpDelta(DND, next, total);
          if ('error' in change) return { refusal: `${token.name} tracks no Hit Points` };
          next = change.data as Record<string, unknown>;
          healed = { rolled, bonus: total - rolled, sides, hp: change.hp };
        }
        // Persistent Rage: every use of Rage comes back, once until a Long Rest.
        if (feature === 'Persistent Rage') next = withRagesRegained(next);
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
        summary = `${token.name} uses ${feature}: regains ${healed.rolled + healed.bonus} Hit Points (${usesLeft})`;
        if (ownTurn) spendBonusAction(campaignId, tokenId);
        const expression = `1d${healed.sides}${healed.bonus < 0 ? '-' : '+'}${Math.abs(healed.bonus)}`;
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
                { type: 'dice' as const, notation: `1d${healed.sides}`, count: 1, sides: healed.sides, results: [healed.rolled], kept: [healed.rolled], total: healed.rolled },
                { type: 'modifier' as const, value: healed.bonus },
              ],
              total: healed.rolled + healed.bonus,
              formula: `[${healed.rolled}] ${healed.bonus < 0 ? '-' : '+'} ${Math.abs(healed.bonus)} = ${healed.rolled + healed.bonus}`,
            },
          },
          token.name,
          summary,
          hiddenFromPlayers(token)
        );
      } else if (feature === 'Rage') {
        addMark(campaignId, { kind: 'rage', attackerId: tokenId, targetId: tokenId });
        const entered = updated.data as Record<string, unknown>;
        // Persistent Rage: it lasts 10 minutes without being extended.
        if (hasPersistentRage(entered)) {
          const now = getCombatState(campaignId);
          now.marks = now.marks.map((mark) => (mark.kind === 'rage' && mark.attackerId === tokenId ? { ...mark, turnEndsLeft: PERSISTENT_RAGE_TURNS } : mark));
          setCombatState(campaignId, now);
        }
        // Mindless Rage: the Charmed and Frightened conditions end as the Rage begins.
        const ended: string[] = [];
        if (hasMindlessRage(entered)) {
          for (const condition of MINDLESS_RAGE_CONDITIONS) {
            if (!(token.conditions ?? []).some((name) => name.toLowerCase() === condition.toLowerCase())) continue;
            const now = getCombatState(campaignId);
            now.marks = now.marks.filter((mark) => !(mark.kind === 'condition' && mark.targetId === tokenId && mark.condition?.toLowerCase() === condition.toLowerCase()));
            setCombatState(campaignId, now);
            await takeCondition(io, campaignId, map.id, tokenId, condition);
            ended.push(condition);
          }
        }
        if (ownTurn) spendBonusAction(campaignId, tokenId);
        summary = `${token.name} enters a Rage: Resistance to Bludgeoning, Piercing and Slashing damage, +${rageDamage(entered)} damage on Strength attacks, Advantage on Strength checks and saves (${usesLeft})${ended.length > 0 ? `; no longer ${ended.join(' or ')} (Mindless Rage)` : ''}`;
      } else if (feature === 'Persistent Rage') {
        const rages = resourcesOf(updated.data as Record<string, unknown>).find((entry) => entry.name === 'Rage');
        summary = `${token.name} regains every use of Rage (Persistent Rage): ${rages?.max ?? 0} uses, once until a Long Rest`;
      } else if (inspired) {
        if (ownTurn) spendBonusAction(campaignId, tokenId);
        const die = bardicDie(updated.data as Record<string, unknown>) ?? 'd6';
        await setTokenMetadata(io, campaignId, map.id, inspired.id, 'bardicInspiration', {
          sides: Number(die.slice(1)),
          from: token.name,
          until: Date.now() + INSPIRATION_MS,
        });
        summary = `${token.name} gives ${inspired.name} a ${die} Bardic Inspiration die, to add to a D20 Test it fails within the hour (${usesLeft})`;
      } else if (feature !== 'Action Surge') {
        // A use the table applies: the server counts it, and a Bonus Action feature spends the Bonus Action.
        if (bonusAction && ownTurn) spendBonusAction(campaignId, tokenId);
        summary = featureSummary(token.name, feature, amount ?? 1, left);
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
   * COMBAT.CONCENTRATE — A token's caster starts concentrating on a spell its sheet has ready that needs Concentration (one it cast by hand, a buff the VTT does not roll), ending its concentration on any other; or, with `end: true`, ends its concentration. During combat. A concentration spell cast through `combat.attack` or `combat.save` starts concentration by itself, and damage makes the caster save to keep it. Hunter's Mark takes a `targetId`, the creature it marks (a Bonus Action on the Ranger's own turn): the caster's attack hits on it add 1d6 Force while the concentration lasts. The DM, or the player who controls the token.
   */
  socket.on('combat.concentrate', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.concentrate', ack)) return;
      const parsed = CombatConcentrateSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { tokenId, spell, end, targetId } = parsed.data;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const tokens = readTokens(map.tokens);
      const token = tokens.find((t) => t.id === tokenId);
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
        // A sheet writes an apostrophe straight or curly ("Hunter's Mark", "Hunter’s Mark").
        const plain = (name: string) => name.toLowerCase().replace(/[’']/g, "'");
        const chosen = known.find((name) => plain(name) === plain(spell!));
        if (!chosen) return refuseRequest(socket, ack, `${token.name} has no concentration spell called ${spell}`);
        const was = concentrationOf(campaignId, tokenId);
        // Hunter's Mark marks a creature the Ranger can see within 90 feet: its hits on it add 1d6 Force.
        const marking = HUNTERS_MARK.test(chosen);
        if (marking !== (targetId !== undefined)) {
          return refuseRequest(socket, ack, marking ? `${chosen} marks a creature: name the target` : `${chosen} marks no creature`);
        }
        const marked = targetId ? tokens.find((t) => t.id === targetId) : undefined;
        if (targetId && (!marked || marked.layer !== token.layer || (socket.role !== 'DM' && hiddenFromPlayers(marked)))) {
          return refuseRequest(socket, ack, 'That target is not on the map');
        }
        // Casting it is a Bonus Action on the Ranger's own turn.
        const now = getCombatState(campaignId);
        const ownTurn = someoneActing(now) && now.currentTokenId === tokenId && now.turn !== null;
        if (marking && ownTurn && now.turn!.bonusAction) return refuseRequest(socket, ack, `${token.name} has used its Bonus Action this turn`);
        startConcentration(campaignId, tokenId, chosen, marked?.id);
        if (marking && ownTurn) spendBonusAction(campaignId, tokenId);
        summary = `${token.name} concentrates on ${chosen}${marked ? `, marking ${marked.name}` : ''}${was && was !== chosen ? `, ending ${was}` : ''}`;
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
   * COMBAT.HEAL — A caster casts one of its healing spells (Cure Wounds, Healing Word, …, by its place in `combat.actions`) on a creature within the spell's range, at a slot level: the server rolls the spell's dice plus the caster's spellcasting modifier, restores that many Hit Points to the creature's sheet or token (a character healed from 0 starts its death saves afresh), spends the slot, spends the action or the Bonus Action on the caster's turn, and records the roll in the dice log. A Life Domain Cleric's features are applied: Disciple of Life adds 2 + the slot's level, Blessed Healer restores as much to the Cleric when the creature healed is another, and Supreme Healing takes each die at its highest number. With `shares` in place of `targetId` it resolves Preserve Life, dividing five times the Cleric level among Bloodied creatures within 30 feet. The DM, or the player who controls the caster; a player may not target a hidden token.
   */
  socket.on('combat.heal', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.heal', ack)) return;
      const parsed = CombatHealSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { casterId, targetId, action: actionIndex, slotLevel, shares } = parsed.data;

      const map = await currentMap(campaignId);
      if (!map) return refuseRequest(socket, ack, 'Combat is resolved for D&D campaigns, on the map on screen');
      const tokens = readTokens(map.tokens);
      const caster = tokens.find((t) => t.id === casterId);
      if (!caster || !canControlToken(socket.role, caster.controlledBy, socket.userId)) {
        return refuseRequest(socket, ack, 'You can only act for your own token');
      }
      // Preserve Life: Hit Points divided among the creatures chosen.
      if (shares) return void (await dividePreserveLife(io, socket, campaignId, map, caster, actionIndex, shares, ack));
      const target = tokens.find((t) => t.id === targetId);
      if (!target || target.layer !== caster.layer || (socket.role !== 'DM' && hiddenFromPlayers(target))) {
        return refuseRequest(socket, ack, 'That creature is not on the map');
      }
      const sheet = await sheetOf(caster, campaignId);
      const listed = actionsOf(caster, sheet)[actionIndex];
      if (listed?.divide) return refuseRequest(socket, ack, `${listed.name} divides its Hit Points among creatures: send shares`);
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
      // Divine Spark is aimed at another creature.
      if (action.channel === 'Channel Divinity' && target.id === caster.id) return refuseRequest(socket, ack, `${action.name} is aimed at another creature`);
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
      // The Life Domain: Supreme Healing takes each die at its highest, Disciple of Life adds to a spell cast with a
      // slot, and Blessed Healer heals the Cleric when that spell heals another.
      const supreme = hasSupremeHealing(sheet);
      const dice = rollHealing(heal, supreme);
      const disciple = discipleOfLifeBonus(sheet, cast.slotLevel);
      const rolled = { ...dice, total: dice.total + disciple };
      const blessed = blessedHealerHealing(sheet, cast.slotLevel, target.id !== caster.id);
      await healToken(io, campaignId, map.id, target, rolled.total);
      if (blessed > 0) await healToken(io, campaignId, map.id, caster, blessed);
      if (action.channel) await spendSheetUse(campaignId, caster, action.channel);
      if (action.cost === 'bonusAction') {
        if (ownTurn) spendBonusAction(campaignId, casterId);
        await resendInitiativeState(io, campaignId);
      } else await spendAction(io, campaignId, casterId, 'Magic');

      const expression = `${heal.roll.count}d${heal.roll.sides}${heal.bonus < 0 ? '-' : '+'}${Math.abs(heal.bonus)}`;
      const lifeNotes = [...(supreme ? ['Supreme Healing'] : []), ...(disciple > 0 ? [`Disciple of Life +${disciple}`] : [])];
      const summary =
        (action.channel
          ? `${action.name}, a use of ${action.channel}: ${target.name} regains ${rolled.total} Hit Points`
          : `${action.name} (level ${cast.slotLevel ?? action.spell?.level ?? 0}): ${target.name} regains ${rolled.total} Hit Points`) +
        (lifeNotes.length > 0 ? ` (${lifeNotes.join(', ')})` : '') +
        (blessed > 0 ? `; ${caster.name} regains ${blessed} Hit Points (Blessed Healer)` : '');
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
              ...(disciple > 0 ? [{ type: 'modifier' as const, value: disciple }] : []),
            ],
            total: rolled.total,
            formula: `[${rolled.dice.join(', ')}] ${heal.bonus < 0 ? '-' : '+'} ${Math.abs(heal.bonus)}${disciple > 0 ? ` + ${disciple}` : ''} = ${rolled.total}`,
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
   * COMBAT.REACT — Answer a `combat.prompt` the server sent while it waits on a roll: `choice` is the feature the creature uses (Uncanny Dodge, Deflect Attacks), or null for none. The first answer closes the question, and every member hears `combat.promptClosed`; one that comes after the time ran out is refused. The player who controls the token asked about, or the DM.
   */
  socket.on('combat.react', (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      if (!withinCeiling(socket, 'combat.react', ack)) return;
      const parsed = CombatReactSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const answered = answerPrompt(socket, parsed.data.promptId, parsed.data.choice);
      if (!answered.ok) return refuseRequest(socket, ack, answered.error);
      ack?.({ ok: true });
    } catch (error) {
      logger.error('combat.react failed', { err: error });
      refuseRequest(socket, ack, 'Failed to answer');
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
   * COMBAT.SAVE — Use an action or spell that calls for a saving throw against one or more tokens on the current map: the server rolls the damage once and a save for each target with its own conditions, cover and the best Aura of Protection it stands in, asks a Fighter that failed whether to roll again with Indomitable (and a Monk with Disciplined Survivor whether to roll again for a Focus Point) and a level 20 Rogue that failed whether to turn the d20 into a 20 with Stroke of Luck, refuses more targets than an action that chooses them allows (a Paladin's Abjure Foes: its Charisma modifier, at least one; a failed Wisdom save leaves the creature Frightened for 1 minute or until it takes damage, and spends a use of Channel Divinity), leaves a condition a stat block's effect gives off a creature that an Aura of Courage (Frightened) or Aura of Devotion (Charmed) keeps immune, applies full, half or no damage to each one's hit points and records the roll in the dice log. A Berserker's `Intimidating Presence` is one of its actions, a Bonus Action against creatures of its choice within 30 feet: a Wisdom save (DC 8 + Strength modifier + Proficiency Bonus) or the Frightened condition, saved against again at the end of each of the creature's turns; it spends its one use, and once that is gone it is listed as `Intimidating Presence (a use of Rage)` and spends a use of Rage. A raging creature with Mindless Rage takes neither the Charmed nor the Frightened condition from a failed save. A failed Strength save of a Barbarian with Indomitable Might uses its Strength score when that meets the DC. Relentless Rage and Retaliation are asked as for `combat.attack`. The DM, or the player who controls the acting token; a player may not target a hidden token. A Land Druid's `Land's Aid` also takes `healId`, the creature in its area that regains Hit Points: the server rolls them after the damage, spends a use of Wild Shape, and answers with `healed`.
   */
  socket.on('combat.save', async (data: unknown, callback?: unknown) => {
    const ack = ackFrom(callback);
    try {
      if (!socket.campaignId || !socket.userId) return refuseRequest(socket, ack, 'Not authenticated to a campaign');
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'combat.save', ack)) return;
      const parsed = CombatSaveSchema.safeParse(data);
      if (!parsed.success) return refuseRequest(socket, ack, parsed.error.issues[0]?.message ?? 'Invalid request');
      const { sourceId, targetIds, action: actionIndex, slotLevel, point, metamagic, healId } = parsed.data;

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
      // Metamagic, chosen as the spell is cast.
      const meta = metamagic ? castingMetamagic(campaignId, sourceToken, sourceSheet, action, metamagic, targetIds) : null;
      if (meta && 'error' in meta) return refuseRequest(socket, ack, meta.error);
      if (meta) action = meta.action;
      if (action.channel === 'Channel Divinity' && targetIds.includes(sourceId)) return refuseRequest(socket, ack, `${action.name} is aimed at another creature`);
      if (action.maxTargets !== undefined && targetIds.length > action.maxTargets) {
        return refuseRequest(socket, ack, `${action.name} chooses ${action.maxTargets} ${action.maxTargets === 1 ? 'creature' : 'creatures'} at most`);
      }
      // Intimidating Presence: a Bonus Action, against other creatures of the Berserker's choice.
      if (action.presence) {
        const now = getCombatState(campaignId);
        if (targetIds.includes(sourceId)) return refuseRequest(socket, ack, `${action.name} frightens other creatures`);
        if (someoneActing(now) && now.currentTokenId === sourceId && now.turn?.bonusAction) {
          return refuseRequest(socket, ack, `${sourceToken.name} has used its Bonus Action this turn`);
        }
      }
      // Land's Aid: the creature in the area that regains Hit Points, named with the saves.
      const healed = healId === undefined ? null : tokens.find((t) => t.id === healId);
      if (healId !== undefined) {
        if (!action.areaHeal) return refuseRequest(socket, ack, `${action.name} restores no Hit Points to a creature in its area`);
        if (!healed || healed.layer !== sourceToken.layer || (socket.role !== 'DM' && hiddenFromPlayers(healed))) {
          return refuseRequest(socket, ack, 'That creature is not on the map');
        }
        const board = {
          heights: readTileHeights(map.tileHeights),
          feetPerSquare: map.feetPerSquare,
          diagonalRule: map.diagonalRule === 'alternating' ? ('alternating' as const) : ('flat' as const),
        };
        const radius = action.area?.sizeFeet ?? 0;
        // In the same Sphere as the creatures that save: within its radius of the square aimed at, or its width of each of them.
        const outside =
          distanceFeet(standing(sourceToken), standing(healed), board) > (action.rangeFeet ?? 0) + radius ||
          (point
            ? distanceFeet(standing(healed), { cell: point, size: { width: 1, height: 1 } }, board) > radius
            : targetTokens.some((token) => distanceFeet(standing(healed), standing(token), board) > 2 * radius));
        if (outside) return refuseRequest(socket, ack, `${healed.name} is not in the area of ${action.name}`);
      }
      // Turn Undead chooses Undead only.
      if (action.onlyCreatureType) {
        const wanted = new RegExp(`\\b${action.onlyCreatureType}\\b`, 'i');
        const other = targetTokens.find((token) => !wanted.test(((token.statBlock ?? {}) as { creatureType?: string }).creatureType ?? ''));
        if (other) return refuseRequest(socket, ack, `${other.name} is not an Undead, which ${action.name} turns`);
      }
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
        action = { ...action, save: { ...action.save!, ability: (dexterity ?? -99) > (strength ?? -99) ? 'dex' : 'str' } };
      }
      const ability = action.save!.ability;
      const involved = new Set([sourceId, ...targetIds]);
      // Aura of Protection: each target adds the best aura it stands in.
      const auras = await Promise.all(targetTokens.map((token) => auraFor(campaignId, map.id, token)));
      const saveRequest: Parameters<typeof resolveSave>[0] = {
        source: combatant(sourceToken, sourceSheet),
        targets: targetTokens.map((token, index) => ({
          ...combatant(token, targetSheets[index], getCombatState(campaignId).dodging, isRaging(campaignId, token.id)),
          saveBonus: (() => {
            const own = saveBonusOf(token, targetSheets[index], ability);
            return own === null ? null : own + auras[index].bonus;
          })(),
          ...(meta?.protectedIds.has(token.id) ? { protected: true } : {}),
          ...(meta?.heightenedId === token.id ? { disadvantage: true } : {}),
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
      };
      let result = resolveSave(saveRequest);
      if (!result.ok) return refuseRequest(socket, ack, result.reason);
      // Empowered Spell: once the damage is rolled, the Sorcerer's player is asked; its lowest dice are rolled again.
      let empowered = false;
      const sorcery = sourceSheet ? resourcesOf(sourceSheet).find((entry) => entry.name === 'Sorcery Points') : undefined;
      if (
        sourceSheet &&
        action.source === 'spell' &&
        result.damage.length > 0 &&
        knowsMetamagic(sourceSheet, 'empowered') &&
        sorcery &&
        sorcery.max - sorcery.used - (meta ? meta.cost : 0) >= 1
      ) {
        const choice = await askReaction(io, campaignId, {
          token: sourceToken,
          text: `${action.name} rolls ${result.damage.map((line) => line.rolled.total).reduce((a, b) => a + b, 0)} damage (dice ${result.damage.flatMap((line) => line.rolled.dice).join(', ')}).`,
          options: ['Empowered Spell'],
        });
        if (choice === 'Empowered Spell') {
          empowered = true;
          const sides = result.damage.map((_, index) => action.save!.damage[index]?.roll.sides);
          const rerolled = rerollLowest(result.damage.map((line) => line.rolled), sides, empoweredCount(sourceSheet));
          const first = result;
          const again = resolveSave({
            ...saveRequest,
            fixed: { damage: first.damage.map((line, index) => ({ ...line, rolled: rerolled[index] })), saves: first.targets.map((target) => ({ outcome: target.outcome })) },
          });
          if (!again.ok) return refuseRequest(socket, ack, again.reason);
          result = { ...again, summary: `${again.summary}; Empowered Spell` };
        }
      }
      // Indomitable Might: a Barbarian's failed Strength save uses its Strength score when that is higher than the total.
      const mightLines: string[] = [];
      if (ability === 'str') {
        const raised = new Map<number, number>();
        for (const [index, target] of result.targets.entries()) {
          if (target.outcome.success || target.outcome.roll === null) continue;
          const total = indomitableMight(targetSheets[index], target.outcome.roll.total);
          if (total !== null && total >= target.outcome.dc) raised.set(index, total);
        }
        if (raised.size > 0) {
          const first = result;
          result = resolveSave({
            ...saveRequest,
            fixed: {
              damage: first.damage,
              saves: first.targets.map((target, index) => {
                const total = raised.get(index);
                if (total === undefined || !target.outcome.roll) return { outcome: target.outcome };
                mightLines.push(`${targetTokens[index].name} uses its Strength score, ${total} (Indomitable Might, rolled ${target.outcome.roll.total})`);
                return { outcome: { ...target.outcome, roll: { ...target.outcome.roll, total }, success: true } };
              }),
            },
          });
          if (!result.ok) return refuseRequest(socket, ack, result.reason);
        }
      }
      // Indomitable: a Fighter that failed a save it rolled is asked, and may roll it again with its Fighter level added.
      // Disciplined Survivor: a Monk that failed is asked the same way; a Focus Point rolls the save again as it was.
      const rerolled = new Set<number>();
      const disciplined = new Set<number>();
      for (const [index, target] of result.targets.entries()) {
        const bonus = indomitableBonus(targetSheets[index]);
        const own = targetSheets[index];
        const focusLeft = own ? resourcesOf(own).find((entry) => entry.name === 'Focus Points') : undefined;
        const survivor = own !== null && hasFeature(readFeatures(own), 'Disciplined Survivor') && focusLeft !== undefined && focusLeft.used < focusLeft.max;
        if (target.outcome.success || target.outcome.roll === null || (bonus === null && !survivor)) continue;
        const choice = await askReaction(io, campaignId, {
          token: targetTokens[index],
          text: `${targetTokens[index].name} fails the ${ABILITY_FULL[ability]} save against ${action.name} (${target.outcome.roll.total} vs DC ${result.dc}).`,
          options: [...(bonus !== null ? ['Indomitable'] : []), ...(survivor ? ['Disciplined Survivor'] : [])],
        });
        if (choice === 'Indomitable') rerolled.add(index);
        if (choice === 'Disciplined Survivor') {
          rerolled.add(index);
          disciplined.add(index);
        }
      }
      if (rerolled.size > 0) {
        const first = result;
        result = resolveSave({
          ...saveRequest,
          fixed: {
            damage: first.damage,
            saves: first.targets.map((target, index) => {
              if (!rerolled.has(index)) return { outcome: target.outcome };
              const input = disciplined.has(index)
                ? target.rolledWith
                : { ...target.rolledWith, bonus: target.rolledWith.bonus + indomitableBonus(targetSheets[index])! };
              return {
                outcome: savingThrow(input, hasLuck(targetSheets[index]) ? lucky(rollDie) : rollDie),
                first: target.outcome,
                ...(disciplined.has(index) ? { rerolledBy: 'Disciplined Survivor' } : {}),
              };
            }),
          },
        });
        if (!result.ok) return refuseRequest(socket, ack, result.reason);
      }
      // Bardic Inspiration: a target that failed a save it rolled, holding the die, is asked; the die is added to its total.
      const inspiredSaves = new Map<number, number>();
      for (const [index, target] of result.targets.entries()) {
        if (target.outcome.success || target.outcome.roll === null) continue;
        const added = await offerInspiration(
          io,
          campaignId,
          map.id,
          targetTokens[index],
          `${targetTokens[index].name} fails the ${ABILITY_FULL[ability]} save against ${action.name} (${target.outcome.roll.total} vs DC ${result.dc}).`
        );
        if (added !== null) inspiredSaves.set(index, added);
      }
      if (inspiredSaves.size > 0) {
        const first = result;
        result = resolveSave({
          ...saveRequest,
          fixed: {
            damage: first.damage,
            saves: first.targets.map((target, index) => {
              const added = inspiredSaves.get(index);
              const kept = { outcome: target.outcome, ...(target.rerolled ? { first: target.rerolled, ...(target.rerolledBy ? { rerolledBy: target.rerolledBy } : {}) } : {}) };
              if (added === undefined || !target.outcome.roll) return kept;
              const total = target.outcome.roll.total + added;
              return { ...kept, outcome: { ...target.outcome, roll: { ...target.outcome.roll, total }, success: total >= target.outcome.dc }, inspired: added };
            }),
          },
        });
        if (!result.ok) return refuseRequest(socket, ack, result.reason);
      }
      // Stroke of Luck: a Rogue that still fails a save it rolled, with its use left, is asked; the d20 becomes a 20.
      const luckySaves = new Set<number>();
      for (const [index, target] of result.targets.entries()) {
        if (target.outcome.success || target.outcome.roll === null) continue;
        const failed = `${targetTokens[index].name} fails the ${ABILITY_FULL[ability]} save against ${action.name} (${target.outcome.roll.total} vs DC ${result.dc}).`;
        if (await offerStrokeOfLuck(io, campaignId, targetTokens[index], targetSheets[index], failed)) luckySaves.add(index);
      }
      if (luckySaves.size > 0) {
        const first = result;
        result = resolveSave({
          ...saveRequest,
          fixed: {
            damage: first.damage,
            saves: first.targets.map((target, index) => {
              const kept = {
                outcome: target.outcome,
                ...(target.rerolled ? { first: target.rerolled, ...(target.rerolledBy ? { rerolledBy: target.rerolledBy } : {}) } : {}),
                ...(target.inspired ? { inspired: target.inspired } : {}),
              };
              if (!luckySaves.has(index) || !target.outcome.roll) return kept;
              // What was added after the roll stays added.
              const total = target.outcome.roll.total - target.outcome.roll.natural + 20;
              return { ...kept, outcome: { ...target.outcome, roll: { ...target.outcome.roll, natural: 20, total }, success: total >= target.outcome.dc }, turned: target.outcome };
            }),
          },
        });
        if (!result.ok) return refuseRequest(socket, ack, result.reason);
        for (const index of luckySaves) await spendSheetUse(campaignId, targetTokens[index], 'Stroke of Luck');
      }
      const undo = await prepareUndo(campaignId, map.id, [sourceToken.characterId, ...targetTokens.map((t) => t.characterId), ...(healed ? [healed.characterId] : [])]);
      if (cast.slotLevel !== null && !(await spendSlot(campaignId, socket.userId, sourceToken.characterId!, cast.slotLevel))) {
        return refuseRequest(socket, ack, `No level ${cast.slotLevel} spell slot left to cast ${action.name}`);
      }

      spendRecharge(campaignId, sourceId, action);
      if (action.channel) await spendSheetUse(campaignId, sourceToken, action.channel);
      if (action.presence) await spendSheetUse(campaignId, sourceToken, action.presence);
      // Forcing a saving throw on its own turn keeps a Barbarian's Rage going.
      if (isRaging(campaignId, sourceId) && getCombatState(campaignId).currentTokenId === sourceId) keepRaging(campaignId, sourceId);
      if (meta || empowered) await spendSheetUse(campaignId, sourceToken, 'Sorcery Points', (meta?.cost ?? 0) + (empowered ? 1 : 0));
      // A target that rolled again with Indomitable spends the use.
      for (const [index, target] of result.targets.entries()) {
        if (target.rerolled) await spendSheetUse(campaignId, targetTokens[index], target.rerolledBy === 'Disciplined Survivor' ? 'Focus Points' : 'Indomitable');
      }
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
      // Land's Aid: the creature named regains its dice of Hit Points, after the damage.
      let restored: number | null = null;
      if (healed && action.areaHeal) {
        restored = rollDamage({ ...action.areaHeal, bonus: 0 }).total;
        await healToken(io, campaignId, map.id, healed, restored);
        riders.push(`${healed.name} regains ${restored} Hit Points (${action.areaHeal.count}d${action.areaHeal.sides})`);
      }
      if (action.source === 'statBlock') {
        const written = conditionsOnFailure(action.text ?? '');
        for (const [index, target] of result.targets.entries()) {
          if (!target.outcome.success && !target.dropped) riders.push(
            ...(await applyRiders(io, campaignId, map.id, sourceToken, targetTokens[index], written, action.save ? { ability: action.save.ability, dc: action.save.dc } : undefined))
          );
        }
      }
      // Turn Undead: an Undead that fails is Frightened and Incapacitated for 1 minute, or until it takes damage.
      // Sear Undead's damage was dealt above, before the effect began, so it does not end it.
      const turnedAgain: string[] = [];
      if (action.onlyCreatureType && action.channel) {
        for (const [index, target] of result.targets.entries()) {
          if (target.outcome.success || target.dropped) continue;
          const turned = targetTokens[index];
          for (const condition of ['Frightened', 'Incapacitated']) {
            await giveCondition(io, campaignId, map.id, turned.id, condition);
            const now = getCombatState(campaignId);
            if (now.active) {
              now.marks = [
                ...now.marks.filter((mark) => !(mark.kind === 'condition' && mark.targetId === turned.id && mark.condition === condition)),
                { kind: 'condition', attackerId: sourceId, targetId: turned.id, condition, ends: 'end', turnEndsLeft: TURN_UNDEAD_TURNS, action: action.name },
              ];
              setCombatState(campaignId, now);
            }
          }
          riders.push(`${turned.name} is turned: Frightened and Incapacitated for 1 minute, or until it takes damage`);
          turnedAgain.push(`${turned.name} is no longer turned`);
        }
      }
      // Abjure Foes: a creature that fails is Frightened for 1 minute, or until it takes damage.
      if (action.untilDamaged) {
        for (const [index, target] of result.targets.entries()) {
          if (target.outcome.success || target.dropped) continue;
          const abjured = targetTokens[index];
          for (const condition of action.untilDamaged) {
            const warded = auras[index].immune[condition.toLowerCase()];
            if (warded) {
              riders.push(`${abjured.name} is immune to the ${condition} condition (${warded})`);
              continue;
            }
            await giveCondition(io, campaignId, map.id, abjured.id, condition);
            const now = getCombatState(campaignId);
            if (now.active) {
              now.marks = [
                ...now.marks.filter((mark) => !(mark.kind === 'condition' && mark.targetId === abjured.id && mark.condition === condition)),
                { kind: 'condition', attackerId: sourceId, targetId: abjured.id, condition, ends: 'end', turnEndsLeft: ABJURE_FOES_TURNS, action: action.name },
              ];
              setCombatState(campaignId, now);
            }
            riders.push(`${abjured.name} is ${condition} for 1 minute, or until it takes damage`);
          }
        }
      }
      // Intimidating Presence: a creature that fails is Frightened, and saves again at the end of each of its turns.
      if (action.presence) {
        for (const [index, target] of result.targets.entries()) {
          if (target.outcome.success) continue;
          riders.push(
            ...(await applyRiders(io, campaignId, map.id, sourceToken, targetTokens[index], [{ condition: 'Frightened', repeats: true }], { ability: 'wis', dc: result.dc }))
          );
        }
      }
      riders.push(...mightLines);
      // What a failed save against an Unarmed Strike leaves the target with.
      const auraLines = auras.flatMap((aura, index) =>
        aura.bonus > 0 && aura.from ? [`${targetTokens[index].name} adds +${aura.bonus} (${aura.from}'s Aura of Protection)`] : []
      );
      let summary = [result.summary, ...auraLines, ...riders, ...endured.filter((note) => !turnedAgain.includes(note))].join('; ');
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
      else if (meta?.quickened) {
        spendBonusAction(campaignId, sourceId);
        await resendInitiativeState(io, campaignId);
      } else if (action.presence) {
        spendBonusAction(campaignId, sourceId);
        await resendInitiativeState(io, campaignId);
      } else await spendAction(io, campaignId, sourceId, action.source === 'spell' || action.channel ? 'Magic' : action.name);
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
          ...(healed && restored !== null ? { healed: { tokenId: healed.id, amount: restored } } : {}),
        });
      }
      // Retaliation: a Berserker damaged from within 5 feet is asked, once the action is settled.
      for (const [index, target] of result.targets.entries()) {
        await offerRetaliation(io, campaignId, map, sourceToken, targetTokens[index], target.dealt);
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
        // A Champion's Survivor (Defy Death): Advantage, and an 18 or 19 counts as a 20.
        const outcome = deathSavingThrow(saves, hasLuck(sheet) ? lucky(rollDie) : rollDie, hasSurvivor(readFeatures(sheet)) ? DEFY_DEATH : {});
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
          ? `${outcome.natural === 20 ? 'a 20' : `${outcome.natural} (Survivor counts it as a 20)`}: back up with 1 Hit Point`
          : outcome.result === 'dead'
            ? `${outcome.natural === 1 ? 'a 1, two failures' : 'failure'}: dead`
            : outcome.result === 'stable'
              ? 'success: Stable'
              : `${outcome.natural >= 10 ? 'success' : outcome.natural === 1 ? 'a 1, two failures' : 'failure'} (${outcome.saves.successes} successes, ${outcome.saves.failures} failures)`;
      const summary = `${token.name} death save${outcome.dice ? ` (Advantage: Survivor, ${outcome.dice.join(' and ')})` : ''}: ${verdict}`;
      await logRoll(
        io,
        socket,
        campaignId,
        {
          expression: outcome.dice ? '2d20kh1' : '1d20',
          total: outcome.natural,
          breakdown: {
            expression: outcome.dice ? '2d20kh1' : '1d20',
            rolls: [{ type: 'dice' as const, notation: outcome.dice ? '2d20kh1' : '1d20', count: outcome.dice ? 2 : 1, sides: 20, results: outcome.dice ?? [outcome.natural], kept: [outcome.natural], total: outcome.natural }],
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
