import Button from '@/components/ui/Button';
import type { CombatFeatureAck, CombatFeatureName } from '@/types';

type TurnOptions = { as?: 'Dash' | 'Disengage'; focus?: true };

interface TurnFeaturesProps {
  /** The names of the acting character's features with a Bonus Action. */
  features: string[];
  bonusActionSpent: boolean;
  use: (feature: CombatFeatureName, options?: TurnOptions) => Promise<CombatFeatureAck>;
  hide: () => Promise<{ ok: true; summary: string } | { ok: false; error: string }>;
  /** A Thief's Fast Hands: a Dexterity (Sleight of Hand) check as a Bonus Action. */
  sleight?: () => Promise<{ ok: true; summary: string } | { ok: false; error: string }>;
  /** Whether the creature has moved this turn: Steady Aim needs it not to have. */
  moved?: boolean;
  onResult: (message: string, ok: boolean) => void;
}

/**
 * The Bonus Action class features that change the turn, on the turn bar: a
 * Rogue's Cunning Action (Dash, Disengage, Hide) and a Monk's Focus (Flurry
 * of Blows, Patient Defense, Step of the Wind), a Rogue's Steady Aim and a
 * Thief's Fast Hands (Sleight of Hand). The server checks the class,
 * spends the Focus Point and applies what each does.
 */
export default function TurnFeatures({
  features,
  bonusActionSpent,
  use,
  hide,
  sleight,
  moved = false,
  onResult,
}: TurnFeaturesProps) {
  // A sheet writes "Monk’s Focus" with a curly apostrophe or a straight one.
  const plain = (name: string) => name.toLowerCase().replace(/[’']/g, "'");
  const has = (name: string) => features.some((feature) => plain(feature) === plain(name));
  const send = async (
    answer: Promise<{ ok: true; summary: string } | { ok: false; error: string }>
  ) => {
    const result = await answer;
    onResult(result.ok ? result.summary : result.error, result.ok);
  };
  const button = (label: string, title: string, action: () => void, unavailable = false) => (
    <Button
      key={label}
      variant="secondary"
      size="sm"
      disabled={bonusActionSpent || unavailable}
      title={title}
      onClick={action}
    >
      {label}
    </Button>
  );
  const rogue = has('Cunning Action');
  const monk = has("Monk's Focus");
  const steady = has('Steady Aim');
  const fastHands = has('Fast Hands') && sleight !== undefined;
  if (!rogue && !monk && !steady && !fastHands) return null;
  return (
    <span
      className="flex flex-wrap items-center gap-1"
      role="group"
      aria-label="Bonus Action features"
    >
      {rogue && [
        button(
          'Cunning: Dash',
          'Cunning Action: the Dash action as a Bonus Action',
          () => void send(use('Cunning Action', { as: 'Dash' }))
        ),
        button(
          'Cunning: Disengage',
          'Cunning Action: the Disengage action as a Bonus Action',
          () => void send(use('Cunning Action', { as: 'Disengage' }))
        ),
        button(
          'Cunning: Hide',
          'Cunning Action: the Hide action as a Bonus Action (Stealth against DC 15)',
          () => void send(hide())
        ),
      ]}
      {steady &&
        button(
          'Steady Aim',
          'Steady Aim: Advantage on your next attack roll this turn, if you have not moved; your Speed is 0 until the turn ends',
          () => void send(use('Steady Aim')),
          moved
        )}
      {fastHands &&
        button(
          'Fast Hands: Sleight of Hand',
          'Fast Hands: a Dexterity (Sleight of Hand) check as a Bonus Action. Utilize or a magic item is the table’s: tick the Bonus Action.',
          () => void send(sleight!())
        )}
      {monk && [
        button(
          'Flurry of Blows',
          '1 Focus Point: two Unarmed Strikes, made from the attack menu',
          () => void send(use('Flurry of Blows'))
        ),
        button(
          'Patient Defense',
          'Disengage as a Bonus Action; with a Focus Point, Disengage and Dodge',
          () => void send(use('Patient Defense'))
        ),
        button(
          'Patient Defense +1',
          '1 Focus Point: Disengage and Dodge as a Bonus Action',
          () => void send(use('Patient Defense', { focus: true }))
        ),
        button(
          'Step of the Wind',
          'Dash as a Bonus Action; with a Focus Point, Dash and Disengage',
          () => void send(use('Step of the Wind'))
        ),
        button(
          'Step of the Wind +1',
          '1 Focus Point: Dash and Disengage as a Bonus Action',
          () => void send(use('Step of the Wind', { focus: true }))
        ),
      ]}
    </span>
  );
}
