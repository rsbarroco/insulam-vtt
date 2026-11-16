import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import HeroicInspiration from '../HeroicInspiration';

describe('HeroicInspiration', () => {
  it('shows a player nothing while the character has none', () => {
    const { container } = render(
      <HeroicInspiration name="Hero" held={false} isDM={false} give={vi.fn()} spend={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lets the DM give it', () => {
    const give = vi.fn();
    render(<HeroicInspiration name="Hero" held={false} isDM give={give} spend={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Give Hero Heroic Inspiration' }));
    expect(give).toHaveBeenCalledTimes(1);
  });

  it('marks a character that holds it, and expends it on a click', () => {
    const spend = vi.fn();
    render(<HeroicInspiration name="Hero" held isDM={false} give={vi.fn()} spend={spend} />);
    const marker = screen.getByRole('button', { name: 'Hero has Heroic Inspiration: expend it' });
    expect(marker).toHaveTextContent('Heroic Inspiration');
    fireEvent.click(marker);
    expect(spend).toHaveBeenCalledTimes(1);
  });
});
