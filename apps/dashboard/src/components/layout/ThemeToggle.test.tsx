import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from './ThemeToggle';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('ThemeToggle', () => {
  it('cycles System, Light, Dark, System; names the current and next theme; applies and stores it', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: 'Theme: System. Switch to Light.' }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(window.localStorage.getItem('eventforge.theme')).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Theme: Light. Switch to Dark.' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('eventforge.theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Theme: Dark. Switch to System.' }));
    expect(window.localStorage.getItem('eventforge.theme')).toBeNull();
    expect(screen.getByRole('button', { name: 'Theme: System. Switch to Light.' })).toBeVisible();
  });

  it('starts from the stored choice', () => {
    window.localStorage.setItem('eventforge.theme', 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Theme: Dark. Switch to System.' })).toBeVisible();
    expect(document.documentElement).toHaveClass('dark');
  });
});
