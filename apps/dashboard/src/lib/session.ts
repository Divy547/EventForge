const STORAGE_KEY = 'eventforge.apiKey';

/**
 * The API key lives in sessionStorage only: it is gone when the tab closes and is never written
 * to localStorage or a cookie. Storage can throw (private windows, blocked site data), so every
 * access is guarded and the app still works for the current page view without it.
 */
export function loadApiKey(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveApiKey(key: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Keep going: the key stays in memory for this page view.
  }
}

export function clearApiKey(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
