import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, initialTheme, loadStoredTheme, saveTheme, watchSystemTheme } from './theme';

function stubSystemDark(matches: boolean) {
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })),
  );
  return listeners;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('theme storage', () => {
  it('has no stored choice by default, and ignores garbage or an old "system" value', () => {
    expect(loadStoredTheme()).toBeNull();
    window.localStorage.setItem('eventforge.theme', 'purple');
    expect(loadStoredTheme()).toBeNull();
    window.localStorage.setItem('eventforge.theme', 'system');
    expect(loadStoredTheme()).toBeNull();
  });

  it('round-trips light and dark', () => {
    saveTheme('dark');
    expect(loadStoredTheme()).toBe('dark');
    saveTheme('light');
    expect(loadStoredTheme()).toBe('light');
  });

  it('survives storage that throws', () => {
    stubSystemDark(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadStoredTheme()).toBeNull();
    expect(initialTheme()).toBe('light');
    expect(() => saveTheme('dark')).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('applying the theme', () => {
  it('starts from the OS setting until a choice is saved, then from the saved choice', () => {
    stubSystemDark(true);
    expect(initialTheme()).toBe('dark');
    saveTheme('light');
    expect(initialTheme()).toBe('light');
    stubSystemDark(false);
    saveTheme('dark');
    expect(initialTheme()).toBe('dark');
  });

  it('toggles the dark class on <html>', () => {
    applyTheme('dark');
    expect(document.documentElement).toHaveClass('dark');
    applyTheme('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('notifies when the OS theme changes, and stops after unsubscribing', () => {
    const listeners = stubSystemDark(false);
    const onChange = vi.fn();
    const stop = watchSystemTheme(onChange);
    listeners.forEach((fn) => fn());
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners.size).toBe(0);
  });
});
