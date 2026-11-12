import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme,
  initialTheme,
  loadStoredTheme,
  saveTheme,
  systemTheme,
  watchSystemTheme,
  type Theme,
} from '@/lib/theme';

/** Light or dark: the saved choice, or the OS setting (followed live) until the visitor picks one. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => initialTheme());
  const [chosen, setChosen] = useState<boolean>(() => loadStoredTheme() !== null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (chosen) return;
    return watchSystemTheme(() => setTheme(systemTheme()));
  }, [chosen]);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    setChosen(true);
    setTheme(next);
  }, [theme]);

  return { theme, toggle };
}
