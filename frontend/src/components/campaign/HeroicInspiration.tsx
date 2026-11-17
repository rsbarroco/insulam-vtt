import { Sparkles } from 'lucide-react';
import Button from '@/components/ui/Button';

interface HeroicInspirationProps {
  name: string;
  /** Whether the acting character holds Heroic Inspiration. */
  held: boolean;
  isDM: boolean;
  /** The DM gives it. */
  give: () => void;
  /** The DM takes it away, or its player expends it for a reroll made by hand. */
  spend: () => void;
}

/**
 * Heroic Inspiration, from the turn bar: a marker while the acting character
 * holds it. The server asks its player after a missed attack roll, a failed
 * save or a failed check whether to roll the d20 again; any other reroll is
 * made by hand and expended here. The DM gives it, and can take it away.
 */
export default function HeroicInspiration({
  name,
  held,
  isDM,
  give,
  spend,
}: HeroicInspirationProps) {
  if (!held && !isDM) return null;
  if (!held) {
    return (
      <Button
        variant="ghost"
        size="sm"
        icon={Sparkles}
        aria-label={`Give ${name} Heroic Inspiration`}
        title="Give Heroic Inspiration: its player may roll one die again right after rolling it, and must use the new roll."
        onClick={give}
      >
        Inspire
      </Button>
    );
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={Sparkles}
      aria-pressed
      aria-label={`${name} has Heroic Inspiration: expend it`}
      title="Has Heroic Inspiration. You are asked after a missed attack roll, a failed save or a failed check. Click to expend it for any other reroll, made by hand."
      onClick={spend}
    >
      Heroic Inspiration
    </Button>
  );
}
