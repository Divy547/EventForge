import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
  watchSystemTheme,
} from './theme';

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

describe('theme preference', () => {
  it('defaults to system and ignores garbage in storage', () => {
    expect(loadThemePreference()).toBe('system');
    window.localStorage.setItem('eventforge.theme', 'purple');
    expect(loadThemePreference()).toBe('system');
  });

  it('round-trips light and dark, and "system" clears the stored value', () => {
    saveThemePreference('dark');
    expect(loadThemePreference()).toBe('dark');
    saveThemePreference('system');
    expect(window.localStorage.getItem('eventforge.theme')).toBeNull();
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadThemePreference()).toBe('system');
    expect(() => saveThemePreference('dark')).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('applying the theme', () => {
  it('resolves "system" from the OS setting and explicit choices as they are', () => {
    stubSystemDark(true);
    expect(resolveTheme('system')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    stubSystemDark(false);
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('toggles the dark class on <html>', () => {
    stubSystemDark(false);
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
