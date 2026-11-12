export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'eventforge.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export const THEME_ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * The theme choice is a harmless per-browser convenience, so it lives in localStorage (unlike the
 * API key). Storage can throw (private windows, blocked site data), so every access is guarded
 * and the default, "follow the system", still works without it.
 */
export function loadThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // The choice just applies to this page view.
  }
}

export function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return preference;
}

/** Puts the `dark` class (the shadcn convention) on <html>, and tells native controls which scheme. */
export function applyTheme(preference: ThemePreference): void {
  const dark = resolveTheme(preference) === 'dark';
  document.documentElement.classList.toggle('dark', dark);
}

/** Calls `onChange` when the OS theme flips; returns the unsubscribe function. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
