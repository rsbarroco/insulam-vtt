// ============================================
// The choices a character is built from, as a client sends them
// ============================================

import { z } from 'zod';
import { CLASS_NAMES } from '../rules/dnd/advancement';
import { SKILLS } from '../rules/dnd/buildCharacter';

const ability = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const name = z.string().trim().min(1).max(200);
const points = z.partialRecord(ability, z.number().int().min(0).max(2));
const scores = z.object(Object.fromEntries(ability.options.map((key) => [key, z.number().int().min(1).max(30)])) as Record<
  (typeof ability.options)[number],
  z.ZodNumber
>);

export const CharacterChoicesSchema = z
  .object({
    name,
    species: name,
    background: name,
    classes: z.array(z.enum(CLASS_NAMES)).min(1).max(2),
    level: z.number().int().min(1).max(20),
    abilityScores: scores,
    backgroundIncreases: points,
    originFeat: name,
    skills: z.array(z.enum(Object.keys(SKILLS) as [keyof typeof SKILLS, ...Array<keyof typeof SKILLS>])).max(18),
    improvements: z
      .array(z.object({ level: z.number().int().min(1).max(20), feat: name, featPoints: points.optional(), abilityPoints: points.optional() }).strict())
      .max(40),
  })
  .strict();
