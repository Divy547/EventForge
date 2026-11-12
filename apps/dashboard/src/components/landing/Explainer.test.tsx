import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { Explainer } from './Explainer';

const currentStep = () => document.querySelector('[aria-current="step"]')?.textContent ?? '';

describe('Explainer (motion allowed)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays, moves through the five steps and loops', () => {
    render(<Explainer />);
    expect(currentStep()).toContain('202 Accepted');

    act(() => void vi.advanceTimersByTime(3200));
    expect(currentStep()).toContain('one database transaction');

    act(() => void vi.advanceTimersByTime(3200 * 3));
    expect(currentStep()).toContain('dead-letter queue');

    act(() => void vi.advanceTimersByTime(3200));
    expect(currentStep()).toContain('202 Accepted');
  });

  it('can be paused and resumed', () => {
    render(<Explainer />);

    fireEvent.click(screen.getByRole('button', { name: 'Pause animation' }));
    const paused = currentStep();
    act(() => void vi.advanceTimersByTime(3200 * 4));
    expect(currentStep()).toBe(paused);

    fireEvent.click(screen.getByRole('button', { name: 'Play animation' }));
    act(() => void vi.advanceTimersByTime(3200));
    expect(currentStep()).not.toBe(paused);
  });

  it('shows all five captions at all times', () => {
    render(<Explainer />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });
});
