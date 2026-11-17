// ============================================
// The acting combatant's turn, under the map
//
// What the rules give a creature on its turn and how much of it is spent:
// movement, an action, a bonus action and a reaction. The DM sees and
// changes it for whoever is acting; a player for a token they control, and
// a player can end their own turn. A player also keeps track here of the
// reaction of each of their tokens while others act.
//
// The server holds the counts and sends them to the whole table; nothing is
// enforced. Movement is counted for moves made in the tactical view.
// ============================================

import { useEffect, useState } from 'react';
import { Footprints, HeartPulse, SkipForward, Sparkles, Swords, Undo2 } from 'lucide-react';
import { useCampaign } from '@/contexts/CampaignContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCharacterHp, useCombatState, useTokenList } from '@/stores/gameStore';
import { useToast } from '@/contexts/ToastContext';
import type { CombatActionSummary, CombatFeatureName, CombatFeatureOption, CombatResource, LayOnHandsCure, Token } from '@/types';
import { controlsToken } from '@/utils/tokenOwnership';
import { tokenDisplayName } from '@/utils/tokenDisplayName';
import {
  actionChange,
  formatFeet,
  movementBudget,
  movementLeft,
  slowedSpeed,
  steadiedSpeed,
  STANDARD_ACTIONS,
} from '@/utils/turn';
import Button from '@/components/ui/Button';
import CheckRoller from './CheckRoller';
import LayOnHands from './LayOnHands';
import PreserveLife from './PreserveLife';
import ConcentrationControl from './ConcentrationControl';
import WildShapeControl from './WildShapeControl';
import WildShapeExtras from './WildShapeExtras';
import BardicInspiration from './BardicInspiration';
import SorceryControl from './SorceryControl';
import HeroicInspiration from './HeroicInspiration';
import TurnFeatures from './TurnFeatures';
import { isProne, movingSpeed, standUpCost } from './map/iso/tacticalStats';

/** The class features the server counts and the table applies: a button each, while uses are left. */
const COUNTED_FEATURES = [
  'Channel Divinity',
  'Focus Points',
  'Sorcery Points',
  'Favored Enemy',
  'Tireless',
  "Nature's Veil",
] as const satisfies readonly CombatFeatureName[];
type CountedFeature = (typeof COUNTED_FEATURES)[number];
const COUNTED_TITLES: Record<CountedFeature, string> = {
  'Channel Divinity': 'One use of Channel Divinity. One back on a Short Rest, all on a Long Rest.',
  'Focus Points': 'Spend one Focus Point. All back on a Short or Long Rest.',
  'Sorcery Points': 'Spend one Sorcery Point. All back on a Long Rest.',
  'Favored Enemy': "Cast Hunter's Mark without a spell slot. All back on a Long Rest.",
  Tireless: 'A Magic action: Temporary Hit Points of 1d8 plus your Wisdom modifier. All uses back on a Long Rest.',
  "Nature's Veil": 'A Bonus Action: you are Invisible until the end of your next turn. All uses back on a Long Rest.',
};

export default function TurnBar() {
  const { userRole } = useCampaign();
  const { socket } = useWebSocket();
  const { user } = useAuth();
  const combat = useCombatState();
  const tokens = useTokenList();
  const characterHp = useCharacterHp();
  const { showToast } = useToast();
  const isDM = userRole === 'DM';

  // What the acting character's features give its turn: how many attacks the
  // Attack action makes, and what it can do with a Bonus Action or a Reaction.
  // The server answers only for a token the viewer may act for.
  const [abilities, setAbilities] = useState<{
    tokenId: string;
    attacksPerAction: number | null;
    features: CombatFeatureOption[];
    passivePerception: number | null;
    resources: CombatResource[];
    concentrationSpells: string[];
    wildShapeForms: string[];
    wildShape: string | null;
    fontOfInspiration: number[];
    preserveLife: { index: number; pool: number } | null;
    cures: LayOnHandsCure[];
    fontOfMagic: { create: Array<{ level: number; cost: number }>; convert: number[] } | null;
    fiendishVigor: boolean;
    heroicInspiration: boolean | null;
  } | null>(null);
  // Asked again after a feature is used, so its uses left are the sheet's.
  const [listed, setListed] = useState(0);
  const [showFeatures, setShowFeatures] = useState(false);
  // The melee attacks to choose between for an Opportunity Attack, once asked.
  const [weapons, setWeapons] = useState<{
    attackerId: string;
    targetId: string;
    actions: CombatActionSummary[];
  } | null>(null);
  const watching = combat.active ? combat.currentTokenId : null;
  useEffect(() => {
    setShowFeatures(false);
    if (!watching) {
      setAbilities(null);
      return;
    }
    let current = true;
    void socket.listCombatActions(watching).then((answer) => {
      if (!current) return;
      setAbilities(
        answer.ok
          ? {
              tokenId: watching,
              attacksPerAction: answer.attacksPerAction,
              features: answer.features,
              passivePerception: answer.passivePerception ?? null,
              resources: answer.resources ?? [],
              concentrationSpells: answer.concentrationSpells ?? [],
              wildShapeForms: answer.wildShapeForms ?? [],
              wildShape: answer.wildShape ?? null,
              fontOfInspiration: answer.fontOfInspiration ?? [],
              fiendishVigor: answer.warlock?.fiendishVigor === true,
              preserveLife: (() => {
                const found = answer.actions.find((action) => action.divide);
                return found?.divide ? { index: found.index, pool: found.divide.pool } : null;
              })(),
              cures: answer.cures ?? ['Poisoned'],
              fontOfMagic: answer.fontOfMagic ?? null,
              heroicInspiration: answer.heroicInspiration ?? null,
            }
          : null
      );
    });
    return () => {
      current = false;
    };
  }, [socket, watching, listed]);

  // The acting character's sheet changed (Heroic Inspiration gained or expended, a use spent): ask again.
  const watchedCharacterId = tokens.find((token) => token.id === watching)?.characterId ?? null;
  useEffect(() => {
    if (!watchedCharacterId) return;
    const relist = (data: { characterId?: string }) => {
      if (data?.characterId === watchedCharacterId) setListed((count) => count + 1);
    };
    socket.on('character.updated', relist);
    return () => {
      socket.off('character.updated', relist);
    };
  }, [socket, watchedCharacterId]);

  if (!combat.active || !combat.turn || !combat.currentTokenId) return null;
  const turn = combat.turn;
  const actingId = combat.currentTokenId;
  const acting = tokens.find((token) => token.id === actingId) ?? null;
  const entry = combat.combatants.find((combatant) => combatant.tokenId === actingId);
  const actingName = acting ? tokenDisplayName(acting) : (entry?.name ?? 'Someone');
  const mine = (token: Token) => isDM || controlsToken(token, user?.id, userRole);
  const canAct = acting !== null && mine(acting);

  // The tokens whose reaction this viewer keeps: the acting one if it is
  // theirs, and for a player each of their own combatants waiting its turn.
  const inOrder = new Set(combat.combatants.map((combatant) => combatant.tokenId));
  const reactionTokens = tokens.filter(
    (token) =>
      inOrder.has(token.id) &&
      (token.id === actingId ? canAct : !isDM && controlsToken(token, user?.id, userRole))
  );

  // A character at 0 Hit Points spends its turn on a death saving throw.
  const actingHp = acting?.characterId ? characterHp[acting.characterId] : undefined;
  const dying = canAct && actingHp !== undefined && actingHp.current <= 0;
  const rollDeathSave = async () => {
    const answer = await socket.rollDeathSave(actingId);
    if (answer.ok) showToast(answer.summary, answer.result === 'dead' ? 'error' : 'info');
    else showToast(answer.error, 'error');
  };

  const known = abilities?.tokenId === actingId ? abilities : null;
  const features = canAct ? (known?.features ?? []) : [];
  const attacksAllowed = known?.attacksPerAction ?? null;
  const resources = canAct ? (known?.resources ?? []) : [];
  const resource = (name: string) => resources.find((entry) => entry.name === name) ?? null;
  /** A feature the server applies: it spends the use, and Second Wind its Bonus Action. */
  const applyOnServer = async (feature: CombatFeatureName) => {
    const answer = await socket.useFeature(actingId, feature);
    showToast(answer.ok ? answer.summary : answer.error, answer.ok ? 'success' : 'error');
    if (answer.ok) setListed((count) => count + 1);
  };
  const spendFeature = (feature: CombatFeatureOption) => {
    if (feature.name === 'Lay on Hands' && resource('Lay on Hands')) {
      return showToast('Choose the creature and the Hit Points with the Lay on Hands button', 'info');
    }
    if (feature.name === 'Bardic Inspiration' && resource('Bardic Inspiration')) {
      return showToast('Choose the creature with the Bardic Inspiration button', 'info');
    }
    // Steady Aim is the server's to apply: Advantage on the next attack roll, Speed 0.
    if (feature.name === 'Steady Aim') return void applyOnServer('Steady Aim');
    if (feature.name === 'Innate Sorcery' && resource('Innate Sorcery')) return void applyOnServer('Innate Sorcery');
    const counted = COUNTED_FEATURES.find((name) => name === feature.name);
    const healing = feature.name === 'Second Wind' || feature.name === 'Wholeness of Body';
    if ((healing || counted) && resource(feature.name)) return void applyOnServer(feature.name as CombatFeatureName);
    if (feature.cost === 'bonusAction') socket.emitTurnUpdate({ bonusAction: true });
    else socket.emitTurnUpdate({ reaction: { tokenId: actingId, spent: true } });
    showToast(`${actingName} uses ${feature.name}`, 'info');
  };
  const spent = (feature: CombatFeatureOption) => {
    const counted = resource(feature.name);
    if (counted && counted.used >= counted.max) return true;
    return feature.cost === 'bonusAction' ? turn.bonusAction : combat.reactionsSpent.includes(actingId);
  };
  const surge = resource('Action Surge');
  const counted = COUNTED_FEATURES.flatMap((name) => {
    const found = resource(name);
    return found ? [{ ...found, name }] : [];
  });
  const rage = resource('Rage');
  const persistentRage = resource('Persistent Rage');
  const layOnHands = resource('Lay on Hands');
  const inspiration = resource('Bardic Inspiration');
  const preserveLife = canAct ? (known?.preserveLife ?? null) : null;
  const touchTargets = [
    ...(acting ? [{ id: acting.id, name: actingName }] : []),
    ...combat.combatants
      .filter((combatant) => combatant.tokenId !== actingId)
      .flatMap((combatant) => {
        const token = tokens.find((entry) => entry.id === combatant.tokenId);
        return token && (isDM || token.visible !== false) ? [{ id: token.id, name: tokenDisplayName(token) }] : [];
      }),
  ];
  const raging = combat.marks.some((mark) => mark.kind === 'rage' && mark.attackerId === actingId);

  // The Opportunity Attacks this viewer may take: the attacker is theirs.
  const offers = combat.opportunities.flatMap((offer) => {
    const attacker = tokens.find((token) => token.id === offer.attackerId);
    const target = tokens.find((token) => token.id === offer.targetId);
    return attacker && target && mine(attacker) ? [{ attacker, target, reason: offer.reason }] : [];
  });
  // The attacks this viewer's creatures have readied: made with the reaction when the trigger comes.
  const readied = combat.marks.flatMap((mark) => {
    if (mark.kind !== 'ready') return [];
    const attacker = tokens.find((token) => token.id === mark.attackerId);
    const target = tokens.find((token) => token.id === mark.targetId);
    return attacker && target && mine(attacker) ? [{ attacker, target }] : [];
  });
  const release = async (attackerId: string, targetId: string) => {
    const answer = await socket.resolveAttack({ attackerId, targetId, action: 0, readied: true });
    if (answer.ok) showToast(answer.summary, answer.hit ? 'success' : 'info');
    else showToast(answer.error, 'error');
  };
  const strike = async (attackerId: string, targetId: string, action: number) => {
    setWeapons(null);
    const answer = await socket.resolveAttack({ attackerId, targetId, action, opportunity: true });
    if (answer.ok) showToast(answer.summary, answer.hit ? 'success' : 'info');
    else showToast(answer.error, 'error');
  };
  /** One melee weapon makes the attack at once; with several, the bar asks which. */
  const takeOpportunity = async (attackerId: string, targetId: string) => {
    const answer = await socket.listCombatActions(attackerId);
    if (!answer.ok) return showToast(answer.error, 'error');
    const melee = answer.actions.filter((action) => action.attack?.kind === 'melee' && !action.spell);
    if (melee.length === 0) return showToast('It has no melee attack to make', 'error');
    if (melee.length === 1) return strike(attackerId, targetId, melee[0].index);
    setWeapons({ attackerId, targetId, actions: melee });
  };

  const baseSpeed = acting ? movingSpeed(acting) : null;
  const speed = baseSpeed === null ? null : steadiedSpeed(slowedSpeed(baseSpeed, combat.marks, actingId), turn);
  // Prone: it crawls, or gets up for half its Speed.
  const prone = acting !== null && isProne(acting);
  const standCost = speed === null ? 0 : standUpCost(speed);
  // A token with no speed set counts no movement, so standing costs it none.
  const canStand = speed === null || (speed > 0 && movementLeft(speed, turn) >= standCost);
  const standUp = async () => {
    const answer = await socket.standUp(actingId);
    if (!answer.ok) return showToast(answer.error, 'error');
    if (speed !== null) socket.emitTurnUpdate({ movementSpent: turn.movementSpent + standCost });
  };
  const movement =
    speed === null
      ? `${formatFeet(turn.movementSpent)} ft moved`
      : `${formatFeet(movementLeft(speed, turn))} of ${formatFeet(movementBudget(speed, turn))} ft left`;

  return (
    <div
      className="absolute bottom-4 inset-x-4 mx-auto w-fit z-20 glass-panel px-3 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-parchment/95 backdrop-blur-xs text-sm text-ink max-w-[calc(100%-2rem)]"
      role="group"
      aria-label={`Turn of ${actingName}`}
    >
      <span className="font-medium truncate max-w-40">{actingName}</span>

      <span className="flex items-center gap-1" title="Movement this turn">
        <Footprints className="w-4 h-4" aria-hidden="true" />
        {movement}
      </span>

      {canAct ? (
        <>
          <label className="flex items-center gap-1">
            Action
            <select
              className="input-cozy text-sm py-1 w-32"
              value={turn.action ?? ''}
              onChange={(event) =>
                socket.emitTurnUpdate(actionChange(turn, event.target.value || null))
              }
            >
              <option value="">Not taken</option>
              {STANDARD_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
              {turn.action && !(STANDARD_ACTIONS as readonly string[]).includes(turn.action) && (
                <option value={turn.action}>{turn.action}</option>
              )}
            </select>
          </label>
          {prone && (
            <Button
              variant="secondary"
              size="sm"
              disabled={!canStand}
              title={
                canStand
                  ? 'Prone: every foot crawled costs a foot more. Standing up costs half its Speed.'
                  : 'Standing up costs half its Speed, which it does not have left'
              }
              onClick={() => void standUp()}
            >
              {speed === null ? 'Stand up' : `Stand up (${standCost} ft)`}
            </Button>
          )}
          {combat.dodging.includes(actingId) && (
            <span title="Until its next turn starts, unless it is Incapacitated or its Speed is 0">
              Dodging: attacks against it have Disadvantage
            </span>
          )}
          {turn.action === 'Attack' && turn.attacks > 0 && (
            <span title="Attacks made with the Attack action this turn">
              {attacksAllowed !== null
                ? `Attack ${turn.attacks} of ${attacksAllowed}`
                : `${turn.attacks} ${turn.attacks === 1 ? 'attack' : 'attacks'} made`}
            </span>
          )}
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={turn.bonusAction}
              onChange={(event) => socket.emitTurnUpdate({ bonusAction: event.target.checked })}
            />
            Bonus action used
          </label>
        </>
      ) : (
        <span className="text-ink-muted">
          {turn.action ? `Action: ${turn.action}` : 'Action not taken'}
          {turn.bonusAction ? ' · bonus action used' : ''}
        </span>
      )}

      {reactionTokens.map((token) => (
        <label key={token.id} className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={combat.reactionsSpent.includes(token.id)}
            onChange={(event) =>
              socket.emitTurnUpdate({
                reaction: { tokenId: token.id, spent: event.target.checked },
              })
            }
          />
          {token.id === actingId ? 'Reaction used' : `${tokenDisplayName(token)}: reaction used`}
        </label>
      ))}

      {readied.map(({ attacker, target }) => (
        <Button
          key={`ready:${attacker.id}`}
          variant="secondary"
          size="sm"
          icon={Swords}
          title="The trigger came: make the readied attack, with the attacker's reaction"
          onClick={() => void release(attacker.id, target.id)}
        >
          Readied: {tokenDisplayName(attacker)} on {tokenDisplayName(target)}
        </Button>
      ))}

      {offers.map(({ attacker, target, reason }) => {
        const choosing = weapons?.attackerId === attacker.id && weapons.targetId === target.id ? weapons.actions : null;
        const names = `${tokenDisplayName(attacker)} on ${tokenDisplayName(target)}`;
        const offered = reason ?? 'Opportunity Attack';
        return (
          <span
            key={`${attacker.id}:${target.id}`}
            className="flex items-center gap-1"
            role="group"
            aria-label={`${offered}: ${names}`}
          >
            {choosing ? (
              <>
                <span>With:</span>
                {choosing.map((action) => (
                  <Button
                    key={action.index}
                    variant="secondary"
                    size="sm"
                    onClick={() => void strike(attacker.id, target.id, action.index)}
                  >
                    {action.name}
                  </Button>
                ))}
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                icon={Swords}
                title={
                  reason === 'Retaliation'
                    ? "It damaged the attacker from within 5 feet: one melee attack, with the attacker's reaction"
                    : "It left the attacker's reach: one melee attack, with the attacker's reaction"
                }
                onClick={() => void takeOpportunity(attacker.id, target.id)}
              >
                {offered}: {names}
              </Button>
            )}
          </span>
        );
      })}

      {canAct && (
        <TurnFeatures
          features={features.filter((feature) => feature.cost === 'bonusAction').map((feature) => feature.name)}
          bonusActionSpent={turn.bonusAction}
          use={async (feature, options) => {
            const answer = await socket.useFeature(actingId, feature, undefined, undefined, options);
            if (answer.ok) setListed((count) => count + 1);
            return answer;
          }}
          hide={() => socket.resolveCheck({ tokenId: actingId, hide: true, bonusAction: true })}
          sleight={() => socket.resolveCheck({ tokenId: actingId, skill: 'sleightOfHand', bonusAction: true })}
          moved={turn.movementSpent > 0}
          onResult={(message, ok) => showToast(message, ok ? 'success' : 'error')}
        />
      )}


      {canAct && known && (known.wildShapeForms.length > 0 || known.wildShape) && (
        <WildShapeControl
          key={`${actingId}:${known.wildShape ?? ''}`}
          forms={known.wildShapeForms}
          current={known.wildShape}
          uses={resource('Wild Shape')}
          bonusActionSpent={turn.bonusAction}
          change={async (form) => {
            const answer = form
              ? await socket.useFeature(actingId, 'Wild Shape', undefined, undefined, { form })
              : await socket.useFeature(actingId, 'End Wild Shape');
            if (answer.ok) setListed((count) => count + 1);
            return answer;
          }}
          onResult={(message, ok) => showToast(message, ok ? 'success' : 'error')}
        />
      )}

      {canAct && resource('Wild Shape') && (
        <WildShapeExtras
          resurgence={resource('Wild Resurgence')}
          spend={async (feature, slotLevel) => {
            const answer = await socket.useFeature(
              actingId,
              feature,
              undefined,
              undefined,
              slotLevel === undefined ? undefined : { slotLevel }
            );
            if (answer.ok) setListed((count) => count + 1);
            return answer;
          }}
          onResult={(message, ok) => showToast(message, ok ? 'success' : 'error')}
        />
      )}

      {canAct && (
        <ConcentrationControl
          key={actingId}
          concentrating={combat.marks.find((mark) => mark.kind === 'concentration' && mark.attackerId === actingId)?.action ?? null}
          spells={known?.concentrationSpells ?? []}
          concentrate={(change) => socket.concentrate(actingId, change)}
          onResult={(message, ok) => showToast(message, ok ? 'success' : 'error')}
        />
      )}

      {canAct && (
        <CheckRoller
          tokenId={actingId}
          name={actingName}
          passivePerception={known?.passivePerception ?? null}
          resolve={(check) => socket.resolveCheck(check)}
          onResult={showToast}
        />
      )}

      {rage &&
        (raging ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={turn.bonusAction}
              title="A Bonus Action: the Rage lasts to the end of your next turn. An attack roll against an enemy, or a save you force on one, extends it too."
              onClick={() => void applyOnServer('Extend Rage')}
            >
              Extend Rage
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void applyOnServer('End Rage')}>
              End Rage
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={rage.used >= rage.max || turn.bonusAction}
            title="A Bonus Action: Resistance to Bludgeoning, Piercing and Slashing damage, Rage Damage on Strength attacks, Advantage on Strength checks and saves. No spells."
            onClick={() => void applyOnServer('Rage')}
          >
            Rage ({rage.max - rage.used}/{rage.max})
          </Button>
        ))}

      {rage && persistentRage && persistentRage.used < persistentRage.max && rage.used > 0 && (
        <Button
          variant="secondary"
          size="sm"
          title="Persistent Rage: when you roll Initiative, regain every use of Rage. Once until a Long Rest."
          onClick={() => void applyOnServer('Persistent Rage')}
        >
          Regain Rages
        </Button>
      )}

      {layOnHands && (
        <LayOnHands
          pool={layOnHands}
          targets={touchTargets}
          bonusActionSpent={turn.bonusAction}
          cures={known?.cures ?? ['Poisoned']}
          touch={async (targetId, amount, cure) => {
            const answer = await socket.useFeature(actingId, 'Lay on Hands', amount, { targetId, ...(cure ? { cure } : {}) });
            if (answer.ok) setListed((count) => count + 1);
            return answer;
          }}
          onResult={(message, ok) => showToast(message, ok ? 'success' : 'error')}
        />
      )}

      {preserveLife && (
        <PreserveLife
          pool={preserveLife.pool}
          targets={touchTargets}
          actionSpent={turn.action !== null}
          divide={async (shares) => {
            const answer = await socket.heal({ casterId: actingId, action: preserveLife.index, shares });
            if (answer.ok) setListed((count) => count + 1);
            return answer;
          }}
          onResult={(message, ok) => showToast(message, ok ? 'success' : 'error')}
        />
      )}

      {inspiration && (
        <BardicInspiration
          uses={inspiration}
          targets={touchTargets.filter((target) => target.id !== actingId)}
          bonusActionSpent={turn.bonusAction}
          inspire={async (targetId) => {
            const answer = await socket.useFeature(actingId, 'Bardic Inspiration', undefined, { targetId });
            if (answer.ok) setListed((count) => count + 1);
            return answer;
          }}
          onResult={(message, ok) => showToast(message, ok ? 'success' : 'error')}
          fontSlots={known?.fontOfInspiration ?? []}
          regain={async (slotLevel) => {
            const answer = await socket.useFeature(actingId, 'Font of Inspiration', undefined, undefined, { slotLevel });
            if (answer.ok) setListed((count) => count + 1);
            return answer;
          }}
        />
      )}

      {canAct && known && (known.fontOfMagic || resource('Innate Sorcery')) && (
        <SorceryControl
          points={resource('Sorcery Points')}
          innate={resource('Innate Sorcery')}
          innateActive={combat.marks.some((mark) => mark.kind === 'innate' && mark.attackerId === actingId)}
          font={known.fontOfMagic}
          bonusActionSpent={turn.bonusAction}
          use={async (feature, options) => {
            const answer = await socket.useFeature(actingId, feature, undefined, undefined, options);
            if (answer.ok) setListed((count) => count + 1);
            return answer;
          }}
          onResult={(message, ok) => showToast(message, ok ? 'success' : 'error')}
        />
      )}

      {canAct && known && known.heroicInspiration !== null && (
        <HeroicInspiration
          name={actingName}
          held={known.heroicInspiration}
          isDM={isDM}
          give={() => void applyOnServer('Heroic Inspiration')}
          spend={() => void applyOnServer('Spend Heroic Inspiration')}
        />
      )}

      {counted.map((entry) => (
        <Button
          key={entry.name}
          variant="secondary"
          size="sm"
          disabled={entry.used >= entry.max}
          title={COUNTED_TITLES[entry.name]}
          onClick={() => void applyOnServer(entry.name)}
        >
          {entry.name} ({entry.max - entry.used}/{entry.max})
        </Button>
      ))}

      {canAct && known?.fiendishVigor && (
        <Button
          variant="secondary"
          size="sm"
          disabled={turn.action !== null}
          title="Fiendish Vigor: cast False Life on yourself without a spell slot, a Magic action, for 12 Temporary Hit Points."
          onClick={() => void applyOnServer('Fiendish Vigor')}
        >
          Fiendish Vigor
        </Button>
      )}

      {surge && (
        <Button
          variant="secondary"
          size="sm"
          disabled={surge.used >= surge.max}
          title="One more action this turn, not the Magic action. Back on a Short or Long Rest."
          onClick={() => void applyOnServer('Action Surge')}
        >
          Action Surge ({surge.max - surge.used}/{surge.max})
        </Button>
      )}

      {features.length > 0 && (
        <span className="relative">
          <Button
            variant="ghost"
            size="sm"
            icon={Sparkles}
            aria-expanded={showFeatures}
            onClick={() => setShowFeatures((open) => !open)}
          >
            Features
          </Button>
          {showFeatures && (
            <ul
              aria-label={`Features of ${actingName}`}
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 max-h-80 overflow-y-auto glass-panel bg-parchment/95 backdrop-blur-xs p-2 space-y-2 text-left shadow-lg"
            >
              {features.map((feature) => (
                <li key={`${feature.name}:${feature.cost}`} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {feature.name}{' '}
                      <span className="text-xs font-normal text-ink-muted">
                        {feature.cost === 'bonusAction' ? 'Bonus Action' : 'Reaction'}
                        {resource(feature.name) &&
                          ` · ${resource(feature.name)!.max - resource(feature.name)!.used}/${resource(feature.name)!.max} left`}
                      </span>
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={spent(feature)}
                      aria-label={`Use ${feature.name} as a ${feature.cost === 'bonusAction' ? 'Bonus Action' : 'Reaction'}`}
                      onClick={() => spendFeature(feature)}
                    >
                      {spent(feature) ? 'Spent' : 'Use'}
                    </Button>
                  </div>
                  <p className="text-xs text-ink-muted whitespace-pre-line">{feature.text}</p>
                </li>
              ))}
            </ul>
          )}
        </span>
      )}

      {dying && (
        <Button
          variant="secondary"
          size="sm"
          icon={HeartPulse}
          onClick={() => void rollDeathSave()}
        >
          Death save
        </Button>
      )}

      {isDM && (
        <Button
          variant="ghost"
          size="sm"
          icon={Undo2}
          title="Undo the last attack, save, heal, fall or feature the server resolved: Hit Points, conditions, sheets and the turn go back"
          onClick={() =>
            void socket.undoCombat().then((answer) => showToast(answer.ok ? answer.summary : answer.error, answer.ok ? 'info' : 'error'))
          }
        >
          Undo
        </Button>
      )}

      {canAct && (
        <Button
          variant="primary"
          size="sm"
          icon={SkipForward}
          onClick={() => socket.emitTurnEnd(actingId)}
        >
          End turn
        </Button>
      )}
    </div>
  );
}
