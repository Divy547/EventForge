import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { mediaState } from '@/test/setup';

// `motion` reads the preference once per module load, so this file sets it before importing.
mediaState.reducedMotion = true;
const { Explainer } = await import('./Explainer');

describe('Explainer (prefers-reduced-motion)', () => {
  it('shows a static diagram: no controls, no moving step, every caption and outcome visible', () => {
    vi.useFakeTimers();
    const { container } = render(<Explainer />);

    expect(screen.queryByRole('button', { name: /animation/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
    expect(container.querySelector('circle')).toBeNull();
    for (const text of ['200 OK', '503, then 200 OK', 'Dead letter']) {
      expect(screen.getByText(text)).toHaveAttribute('opacity', '1');
    }

    act(() => void vi.advanceTimersByTime(20_000));
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
    vi.useRealTimers();
  });
});
