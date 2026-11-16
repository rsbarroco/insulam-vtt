// ============================================
// What a client may send to resolve combat
// ============================================

import { z } from 'zod';
import { CUNNING_EFFECTS } from '../rules/dnd/cunningStrike';

const tokenId = z.string().uuid('A creature is named by its token id');

/** The damage types Transmuted Spell changes a spell's damage to. */
const TRANSMUTED = z.enum(['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder']);

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
    /** An extra attack the weapon gives on the attacker's turn: Cleave after a hit, or the Light weapon's extra attack. `horde` is a Hunter's Horde Breaker. */
    extra: z.enum(['cleave', 'light', 'flurry', 'horde']).optional(),
    /** The attack the attacker readied against this target, made now with its reaction: `action` is then the readied one. */
    readied: z.literal(true).optional(),
    /** The stat block Legendary Action (by index) this attack is made for: it spends one use. */
    legendary: z.number().int().min(0).max(199).optional(),
    /** A Barbarian's Reckless Attack, decided with the first attack roll of its turn. */
    reckless: z.literal(true).optional(),
    /** Brutal Strike on a Reckless Attack turn: give up Advantage on this Strength attack for an extra die and this effect on a hit. */
    brutal: z.enum(['forceful', 'hamstring']).optional(),
    /** Cunning Strike: forgo Sneak Attack dice for this effect, or these two with Improved Cunning Strike, if Sneak Attack is dealt. */
    cunning: z.union([z.enum(CUNNING_EFFECTS), z.array(z.enum(CUNNING_EFFECTS)).min(1).max(2)]).optional(),
    /** A Sorcerer's Metamagic for a spell attack, chosen as it is cast. */
    metamagic: z.object({ option: z.enum(['distant', 'quickened', 'transmuted']), damageType: TRANSMUTED.optional() }).strict().optional(),
    /** A Paladin's Sacred Weapon, used as it takes the Attack action: a use of Channel Divinity imbues this Melee weapon for 10 minutes. */
    sacredWeapon: z.literal(true).optional(),
    /** With a Sacred Weapon: a hit deals Radiant damage instead of the weapon's own type. */
    radiant: z.literal(true).optional(),
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
    /** The empty square an area is aimed at: it must be within the action's range. */
    point: z.object({ x: z.number().int().min(0).max(1000), y: z.number().int().min(0).max(1000) }).strict().optional(),
    /** A Sorcerer's Metamagic, chosen as the spell is cast; `targetIds` are the creatures Careful or Heightened Spell picks. */
    metamagic: z
      .object({
        option: z.enum(['careful', 'distant', 'heightened', 'quickened', 'transmuted']),
        targetIds: z.array(tokenId).min(1).max(30).optional(),
        /** Transmuted Spell: the damage type the spell deals instead. */
        damageType: TRANSMUTED.optional(),
      })
      .strict()
      .optional(),
    /** Land's Aid: the creature in the area that regains Hit Points. */
    healId: tokenId.optional(),
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
    /** With `hide`: taken as a Bonus Action through Cunning Action. With `skill: 'sleightOfHand'`: a Thief's Fast Hands. */
    bonusAction: z.literal(true).optional(),
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
  .object({
    characterId: z.string().uuid('A character is named by its id'),
    kind: z.enum(['short', 'shortFinish', 'long']),
    /** With `shortFinish`: a Wizard's Arcane Recovery or a Land Druid's Natural Recovery, the levels of the slots it recovers (one entry per slot). */
    recover: z.array(z.number().int().min(1).max(9)).min(1).max(20).optional(),
    /** With `shortFinish`: a Sorcerer's Sorcerous Restoration, Sorcery Points regained. */
    restore: z.literal(true).optional(),
  })
  .strict()
  .refine((rest) => rest.recover === undefined || rest.kind === 'shortFinish', { message: 'Arcane Recovery is used as a Short Rest ends' })
  .refine((rest) => rest.restore === undefined || rest.kind === 'shortFinish', { message: 'Sorcerous Restoration is used as a Short Rest ends' });

const LAY_ON_HANDS_CURE = z.enum(['Poisoned', 'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Paralyzed', 'Stunned']);

/** `combat.feature`: a token's character uses a class feature with a number of uses. */
export const CombatFeatureSchema = z
  .object({
    tokenId,
    feature: z.enum([
      'Second Wind',
      'Action Surge',
      'Rage',
      'End Rage',
      'Extend Rage',
      'Persistent Rage',
      'Bardic Inspiration',
      'Channel Divinity',
      'Wild Shape',
      'Focus Points',
      'Sorcery Points',
      'Favored Enemy',
      'Lay on Hands',
      'Cunning Action',
      'Flurry of Blows',
      'Patient Defense',
      'Step of the Wind',
      'End Wild Shape',
      'Wholeness of Body',
      'Steady Aim',
      'Wild Resurgence',
      'Wild Companion',
      'Tireless',
      "Nature's Veil",
      'Font of Magic',
      'Innate Sorcery',
      'Font of Inspiration',
    ]),
    /** Font of Magic: the level of the spell slot created from Sorcery Points (a Bonus Action). */
    create: z.number().int().min(1).max(5).optional(),
    /** Font of Magic: the level of the spell slot converted into Sorcery Points (no action). */
    convert: z.number().int().min(1).max(9).optional(),
    /** Cunning Action: the action it takes as a Bonus Action (Hide is `combat.check` with `bonusAction`). */
    as: z.enum(['Dash', 'Disengage']).optional(),
    /** Patient Defense, Step of the Wind: spend a Focus Point for the stronger use. */
    focus: z.literal(true).optional(),
    /** How many points of Focus Points, Sorcery Points or Lay on Hands; other features spend one use. */
    amount: z.number().int().min(1).max(100).optional(),
    /** Lay on Hands: the creature touched, the user itself when left out. Bardic Inspiration: the creature inspired. */
    targetId: tokenId.optional(),
    /** Wild Resurgence: the level of the spell slot expended for a use of Wild Shape (left out: a use for a level 1 slot). Wild Companion: the slot Find Familiar is cast with (left out: a use of Wild Shape). Font of Inspiration: the level of the spell slot expended to regain a use of Bardic Inspiration. */
    slotLevel: z.number().int().min(1).max(9).optional(),
    /** Wild Shape: the Beast whose form the Druid takes, by name. */
    form: z.string().trim().min(1).max(60).optional(),
    /** Lay on Hands: spend 5 points to end a condition, Poisoned or one of Restoring Touch's, or several at 5 points each; with `amount` it heals too. */
    cure: z.union([LAY_ON_HANDS_CURE, z.array(LAY_ON_HANDS_CURE).min(1).max(7)]).optional(),
  })
  .strict()
  .refine((use) => (use.feature === 'Font of Magic') === ((use.create === undefined) !== (use.convert === undefined)), {
    message: 'Font of Magic creates a spell slot or converts one',
  });

/** `combat.help`: the helper, and the enemy within 5 feet it distracts. */
export const CombatHelpSchema = z.object({ helperId: tokenId, targetId: tokenId }).strict();

/** `combat.ready`: the acting token readies one of its attacks against a creature, for a trigger it names. */
export const CombatReadySchema = z
  .object({
    tokenId,
    targetId: tokenId,
    action: z.number().int().min(0).max(199),
    trigger: z.string().trim().min(1).max(200),
  })
  .strict();

/** `combat.concentrate`: a token's caster starts concentrating on a spell it has, or ends its concentration. */
export const CombatConcentrateSchema = z
  .object({
    tokenId,
    spell: z.string().trim().min(1).max(100).optional(),
    end: z.literal(true).optional(),
    /** Hunter's Mark: the creature it marks. */
    targetId: tokenId.optional(),
  })
  .strict()
  .refine((value) => (value.spell === undefined) !== (value.end === undefined), { message: 'Give a spell to concentrate on, or end' });

/** `combat.heal`: a caster casts one of its healing spells on a creature, at a slot level; or, with `shares`, divides Preserve Life's Hit Points among creatures. */
export const CombatHealSchema = z
  .object({
    casterId: tokenId,
    targetId: tokenId.optional(),
    action: z.number().int().min(0).max(199),
    slotLevel: z.number().int().min(1).max(9).optional(),
    shares: z
      .array(z.object({ targetId: tokenId, amount: z.number().int().min(1).max(100) }).strict())
      .min(1)
      .max(20)
      .optional(),
  })
  .strict()
  .refine((data) => (data.targetId === undefined) !== (data.shares === undefined), 'Send the creature healed, or the shares of Preserve Life')
  .refine((data) => data.shares === undefined || data.slotLevel === undefined, 'Preserve Life takes no spell slot');

/** `combat.undo`: no payload; the last resolved combat action is undone. */
export const CombatUndoSchema = z.object({}).strict();

/** `combat.react`: the answer to a `combat.prompt`, the feature used or null for none. */
export const CombatReactSchema = z
  .object({
    promptId: z.string().uuid('A question is named by its id'),
    choice: z.string().min(1).max(60).nullable(),
  })
  .strict();

/** `combat.stand`: the Prone token that gets up. */
export const CombatStandSchema = z.object({ tokenId }).strict();

/** `combat.deathSave`: the token whose character rolls a death saving throw. */
export const CombatDeathSaveSchema = z.object({ tokenId }).strict();
