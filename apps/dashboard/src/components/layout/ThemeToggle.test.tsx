import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from './ThemeToggle';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('ThemeToggle', () => {
  it('flips between light and dark, names the theme it switches to, applies and stores it', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    // Tests run with no OS dark preference, so the page starts light.
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('eventforge.theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(window.localStorage.getItem('eventforge.theme')).toBe('light');
  });

  it('starts from the stored choice', () => {
    window.localStorage.setItem('eventforge.theme', 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
    expect(document.documentElement).toHaveClass('dark');
  });
});
