const STORAGE_KEY = 'eventforge.apiKey';
const SANDBOX_KEY = 'eventforge.sandbox';

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

/** Remembers that the stored key came from "Try the live sandbox", so the sandbox page is offered. */
export function saveSandboxFlag(isSandbox: boolean): void {
  try {
    if (isSandbox) window.sessionStorage.setItem(SANDBOX_KEY, '1');
    else window.sessionStorage.removeItem(SANDBOX_KEY);
  } catch {
    // The sandbox link just will not show after a reload.
  }
}

export function isSandboxSession(): boolean {
  try {
    return window.sessionStorage.getItem(SANDBOX_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearApiKey(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(SANDBOX_KEY);
  } catch {
    // Nothing to clear.
  }
}
