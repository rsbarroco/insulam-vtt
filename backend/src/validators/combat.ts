// ============================================
// What a client may send to resolve combat
// ============================================

import { z } from 'zod';

const tokenId = z.string().uuid('A creature is named by its token id');

/** `combat.actions`: whose actions to list. */
export const CombatActionsSchema = z.object({ tokenId }).strict();

/** `combat.attack`: one attack from one token against another. */
export const CombatAttackSchema = z
  .object({
    attackerId: tokenId,
    targetId: tokenId,
    /** Which of the attacker's actions, by its place in the list `combat.actions` gave. */
    action: z.number().int().min(0).max(199),
    /** Advantage or Disadvantage the table grants beyond what the server can see. */
    mode: z.enum(['normal', 'advantage', 'disadvantage']).optional(),
    /** The level of the spell slot a spell is cast with; the spell's own when left out. */
    slotLevel: z.number().int().min(1).max(9).optional(),
    /** The Opportunity Attack the target's movement offered this attacker: its reaction, not its action. */
    opportunity: z.literal(true).optional(),
  })
  .strict()
  .refine((attack) => attack.attackerId !== attack.targetId, { message: 'A creature cannot attack itself' });

/** `combat.save`: an action that calls for a saving throw, against one or more tokens. */
export const CombatSaveSchema = z
  .object({
    sourceId: tokenId,
    targetIds: z.array(tokenId).min(1).max(30),
    /** Which of the creature's actions, by its place in the list `combat.actions` gave. */
    action: z.number().int().min(0).max(199),
    /** The level of the spell slot a spell is cast with; the spell's own when left out. */
    slotLevel: z.number().int().min(1).max(9).optional(),
  })
  .strict()
  .refine((save) => new Set(save.targetIds).size === save.targetIds.length, { message: 'A target is named twice' });

/** `combat.fall`: a token that has fallen, and how far in feet. */
export const CombatFallSchema = z.object({ tokenId, feet: z.number().int().min(10).max(5000) }).strict();

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const SKILLS = [
  'acrobatics', 'animalHandling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation',
  'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleightOfHand', 'stealth', 'survival',
] as const;

/**
 * `combat.check`: an ability check a token makes. One of a skill, a bare
 * ability, or the Hide action (a Dexterity (Stealth) check against DC 15).
 */
export const CombatCheckSchema = z
  .object({
    tokenId,
    skill: z.enum(SKILLS).optional(),
    ability: z.enum(ABILITIES).optional(),
    /** The Hide action: Stealth against DC 15, and the Invisible condition on a success. */
    hide: z.literal(true).optional(),
    /** The Difficulty Class, when the table set one. */
    dc: z.number().int().min(1).max(40).optional(),
    mode: z.enum(['normal', 'advantage', 'disadvantage']).optional(),
  })
  .strict()
  .refine((check) => [check.skill, check.ability, check.hide].filter((given) => given !== undefined).length === 1, {
    message: 'A check names one skill, one ability, or the Hide action',
  })
  .refine((check) => !(check.hide && check.dc !== undefined), { message: 'The Hide action has its own DC' });

/** `combat.rest`: a character rests. `short` spends one Hit Point Die, `shortFinish` ends a Short Rest; `long` is the DM's to give. */
export const CombatRestSchema = z
  .object({ characterId: z.string().uuid('A character is named by its id'), kind: z.enum(['short', 'shortFinish', 'long']) })
  .strict();

/** `combat.feature`: a token's character uses a class feature with a number of uses. */
export const CombatFeatureSchema = z
  .object({
    tokenId,
    feature: z.enum([
      'Second Wind',
      'Action Surge',
      'Rage',
      'End Rage',
      'Bardic Inspiration',
      'Channel Divinity',
      'Wild Shape',
      'Focus Points',
      'Sorcery Points',
      'Favored Enemy',
    ]),
    /** How many points of Focus Points or Sorcery Points; other features spend one use. */
    amount: z.number().int().min(1).max(20).optional(),
  })
  .strict();

/** `combat.stand`: the Prone token that gets up. */
export const CombatStandSchema = z.object({ tokenId }).strict();

/** `combat.deathSave`: the token whose character rolls a death saving throw. */
export const CombatDeathSaveSchema = z.object({ tokenId }).strict();
