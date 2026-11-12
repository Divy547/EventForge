import { useCallback, useEffect, useState } from 'react';
import {
  THEME_ORDER,
  applyTheme,
  loadThemePreference,
  saveThemePreference,
  watchSystemTheme,
  type ThemePreference,
} from '@/lib/theme';

/** The visitor's theme choice; "system" follows the OS, including while the page is open. */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() => loadThemePreference());

  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system') return;
    return watchSystemTheme(() => applyTheme('system'));
  }, [preference]);

  /** system -> light -> dark -> system */
  const cycle = useCallback(() => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length]!;
    saveThemePreference(next);
    setPreference(next);
  }, [preference]);

  return { preference, cycle };
}
