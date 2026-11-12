import { act, render, screen } from '@testing-library/react';
import { MotionConfig } from 'motion/react';
import * as m from 'motion/react-m';
import { Dialog } from 'radix-ui';
import { mediaState } from './setup';

describe('jsdom environment for Radix, Recharts and motion', () => {
  it('opens a Radix dialog (pointer-capture and ResizeObserver polyfills)', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    render(
      <Dialog.Root>
        <Dialog.Trigger>Open</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Content>
            <Dialog.Title>Hello</Dialog.Title>
            <Dialog.Description>Body</Dialog.Description>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('exposes prefers-reduced-motion to code under test', () => {
    mediaState.reducedMotion = true;
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
    mediaState.reducedMotion = false;
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false);
  });

  it('renders motion components inside MotionConfig reducedMotion="user"', () => {
    act(() => {
      render(
        <MotionConfig reducedMotion="user">
          <m.div data-testid="box" animate={{ x: 10 }} />
        </MotionConfig>,
      );
    });
    expect(screen.getByTestId('box')).toBeInTheDocument();
  });
});
