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
import { Footprints, HeartPulse, SkipForward, Sparkles } from 'lucide-react';
import { useCampaign } from '@/contexts/CampaignContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCharacterHp, useCombatState, useTokenList } from '@/stores/gameStore';
import { useToast } from '@/contexts/ToastContext';
import type { CombatFeatureOption, Token } from '@/types';
import { controlsToken } from '@/utils/tokenOwnership';
import { tokenDisplayName } from '@/utils/tokenDisplayName';
import {
  actionChange,
  formatFeet,
  movementBudget,
  movementLeft,
  STANDARD_ACTIONS,
} from '@/utils/turn';
import Button from '@/components/ui/Button';
import { tokenSpeed } from './map/iso/tacticalStats';

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
  } | null>(null);
  const [showFeatures, setShowFeatures] = useState(false);
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
            }
          : null
      );
    });
    return () => {
      current = false;
    };
  }, [socket, watching]);

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
  const spendFeature = (feature: CombatFeatureOption) => {
    if (feature.cost === 'bonusAction') socket.emitTurnUpdate({ bonusAction: true });
    else socket.emitTurnUpdate({ reaction: { tokenId: actingId, spent: true } });
    showToast(`${actingName} uses ${feature.name}`, 'info');
  };
  const spent = (feature: CombatFeatureOption) =>
    feature.cost === 'bonusAction' ? turn.bonusAction : combat.reactionsSpent.includes(actingId);

  const speed = acting ? (tokenSpeed(acting)?.feet ?? null) : null;
  const movement =
    speed === null
      ? `${formatFeet(turn.movementSpent)} ft moved`
      : `${formatFeet(movementLeft(speed, turn))} of ${formatFeet(movementBudget(speed, turn))} ft left`;

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 glass-panel px-3 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-parchment/95 backdrop-blur-xs text-sm text-ink max-w-[calc(100%-2rem)]"
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
