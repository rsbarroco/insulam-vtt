// ============================================
// ReactionPrompt — the server asks whether a creature takes a reaction
//
// Some features are chosen once a roll is known, as the rules have it: a
// Rogue's Uncanny Dodge after an attack hits it. The server stops the roll and
// asks whoever controls the creature; this shows the question with a button
// for each feature it may use and one to take none, and goes away once
// answered, when another member answers first, or when the time runs out.
// ============================================

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import type socketService from '@/services/socket';
import type { CombatPrompt } from '@/types';

interface ReactionPromptProps {
  socket: Pick<typeof socketService, 'onCombatPrompt' | 'onCombatPromptClosed' | 'react' | 'off'>;
}

export default function ReactionPrompt({ socket }: ReactionPromptProps) {
  const [prompts, setPrompts] = useState<CombatPrompt[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const asked = (prompt: CombatPrompt) =>
      setPrompts((open) => [...open.filter((p) => p.promptId !== prompt.promptId), prompt]);
    const closed = ({ promptId }: { promptId: string }) =>
      setPrompts((open) => open.filter((p) => p.promptId !== promptId));
    socket.onCombatPrompt(asked);
    socket.onCombatPromptClosed(closed);
    return () => {
      socket.off('combat.prompt', asked);
      socket.off('combat.promptClosed', closed);
    };
  }, [socket]);

  const prompt = prompts[0];
  // An answer the server refused (too late, say) is said once the question has gone.
  if (!prompt && problem) {
    return (
      <div
        role="alert"
        className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 card-cozy p-4 shadow-lg max-w-md w-[calc(100%-2rem)] flex items-center justify-between gap-3"
      >
        <p className="text-sm text-danger-ink">{problem}</p>
        <Button type="button" size="sm" variant="ghost" onClick={() => setProblem(null)}>
          Dismiss
        </Button>
      </div>
    );
  }
  if (!prompt) return null;

  const answer = async (choice: string | null) => {
    setPrompts((open) => open.filter((p) => p.promptId !== prompt.promptId));
    const result = await socket.react(prompt.promptId, choice);
    setProblem(result.ok ? null : result.error);
  };

  return (
    <div
      role="alertdialog"
      aria-label={`Reaction for ${prompt.tokenName}`}
      className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 card-cozy p-4 shadow-lg max-w-md w-[calc(100%-2rem)] space-y-3"
    >
      <p className="text-sm text-ink">{prompt.text}</p>
      <p className="text-sm text-ink font-semibold">Does {prompt.tokenName} take a reaction?</p>
      <div className="flex flex-wrap gap-2">
        {prompt.options.map((option) => (
          <Button key={option} type="button" size="sm" onClick={() => void answer(option)}>
            {option}
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={() => void answer(null)}>
          No reaction
        </Button>
      </div>
      {problem && <p className="text-xs text-danger-ink">{problem}</p>}
    </div>
  );
}
