import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';
import { THEME_ORDER, type ThemePreference } from '@/lib/theme';

const LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/** One button that cycles System, Light, Dark. It sits on the navy chrome, so it is styled for it. */
export function ThemeToggle() {
  const { preference, cycle } = useTheme();
  const Icon = ICONS[preference];
  const next = THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length]!;
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={cycle}
      aria-label={`Theme: ${LABELS[preference]}. Switch to ${LABELS[next]}.`}
      title={`Theme: ${LABELS[preference]}`}
      className="border-white/30 bg-transparent text-navy-foreground hover:bg-white/10 hover:text-navy-foreground"
    >
      <Icon aria-hidden />
    </Button>
  );
}
