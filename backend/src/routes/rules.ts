// ============================================
// The D&D rules a campaign builds its characters by
//
// What the reference document offers (species, backgrounds, feats, classes)
// with the campaign's own switches, and the sheet a set of choices makes.
// Mounted under /api/campaigns. Building stores nothing: the sheet that
// comes back is saved through POST /api/characters like any other.
//
// The rules of play themselves, as the document words them, are read here
// too: the text the table looks a rule up in.
// ============================================

import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/rbac';
import { campaignMember } from '../middleware/compose';
import { prisma } from '../config/database';
import logger from '../utils/logger';
import { readCharacterRules } from '../utils/characterRules';
import { CharacterChoicesSchema } from '../validators/characterBuild';
import { CLASSES, improvements, type Tracks } from '../rules/dnd/advancement';
import { allClasses } from '../rules/dnd/classes';
import { allBackgrounds, allFeats, allSpecies } from '../rules/dnd/origins';
import { buildCharacter, classSkillChoices, featPointsRule } from '../rules/dnd/buildCharacter';
import { allRules, RULES_SOURCE } from '../rules/dnd/rulesText';

const router = Router();

/**
 * The campaign's switches, or null for a campaign that is not set to D&D 5e.
 * A campaign with no system takes no D&D 5e characters (POST /api/characters
 * holds a character to its campaign's system), so it builds none.
 */
async function rulesOf(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { gameSystem: true, characterRules: true } });
  if (campaign?.gameSystem !== 'DND_5E') return null;
  return readCharacterRules(campaign.characterRules);
}

const NOT_DND = { error: 'Not Found', message: 'This campaign is not set to D&D 5e' };

/**
 * GET /api/campaigns/:campaignId/rules/dnd
 * Everything character creation chooses from, with the campaign's switches.
 * Requires: Campaign membership (any role)
 */
router.get('/:campaignId/rules/dnd', campaignMember, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rules = await rulesOf(req.params.campaignId);
    if (!rules) return res.status(404).json(NOT_DND);
    return res.status(200).json({
      source: 'System Reference Document 5.2.1',
      characterRules: rules,
      species: allSpecies(),
      backgrounds: allBackgrounds(),
      feats: allFeats().map((feat) => ({ ...feat, abilityPoints: featPointsRule(feat, rules) })),
      classes: allClasses().map((entry) => ({
        id: entry.id,
        name: entry.name,
        coreTraits: entry.coreTraits,
        hitDie: CLASSES[entry.name].hitDie,
        savingThrows: CLASSES[entry.name].saves,
        caster: CLASSES[entry.name].caster,
        skillChoices: classSkillChoices(entry.name),
        featuresByLevel: entry.featuresByLevel,
        subclass: entry.subclass.name,
        // The levels that give a feat or ability score points to a character of this class alone.
        improvements: improvements([entry.name] as Tracks, 20, rules),
      })),
    });
  } catch (error) {
    logger.error('Error reading the D&D rules', { err: error });
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to read the rules' });
  }
});

/**
 * GET /api/campaigns/:campaignId/rules/dnd/reference
 * The rules of play, in the reference document's own words: every heading of
 * "Playing the Game" and of the "Rules Glossary" with what stands under it.
 * For a campaign set to D&D 5e or to no system, the ones the VTT resolves
 * combat for.
 * Requires: Campaign membership (any role)
 */
router.get('/:campaignId/rules/dnd/reference', campaignMember, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const campaign = await prisma.campaign.findUnique({ where: { id: req.params.campaignId }, select: { gameSystem: true } });
    if (!campaign || (campaign.gameSystem !== null && campaign.gameSystem !== 'DND_5E')) return res.status(404).json(NOT_DND);
    return res.status(200).json({ source: RULES_SOURCE, license: 'CC-BY-4.0', sections: allRules() });
  } catch (error) {
    logger.error('Error reading the rules of play', { err: error });
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to read the rules' });
  }
});

/**
 * POST /api/campaigns/:campaignId/rules/dnd/build
 * The D&D 5e sheet a set of choices makes under the campaign's rules, or
 * everything wrong with the choices. Stores nothing.
 * Requires: Campaign membership (any role)
 */
router.post('/:campaignId/rules/dnd/build', campaignMember, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rules = await rulesOf(req.params.campaignId);
    if (!rules) return res.status(404).json(NOT_DND);
    const parsed = CharacterChoicesSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue ? `${issue.path.join('.') || 'choices'}: ${issue.message}` : 'Invalid choices';
      return res.status(400).json({ error: 'Validation Error', message, errors: [message] });
    }
    const built = buildCharacter(parsed.data, rules);
    if (!built.ok) return res.status(400).json({ error: 'Validation Error', message: built.errors[0], errors: built.errors });
    return res.status(200).json({ sheet: built.sheet, summary: built.summary });
  } catch (error) {
    logger.error('Error building a character', { err: error });
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to build the character' });
  }
});

export default router;
