export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'eventforge.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/**
 * The theme choice is a harmless per-browser convenience, so it lives in localStorage (unlike the
 * API key). Storage can throw (private windows, blocked site data), so every access is guarded;
 * without it the page just follows the OS setting. An old stored "system" value counts as no choice.
 */
export function loadStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function saveTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The choice just applies to this page view.
  }
}

export function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/** The visitor's saved choice, or the OS setting until they make one. */
export function initialTheme(): Theme {
  return loadStoredTheme() ?? systemTheme();
}

/** Puts the `dark` class (the shadcn convention) on <html>. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/** Calls `onChange` when the OS theme flips; returns the unsubscribe function. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
