import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { RecentFailures } from '@/components/overview/RecentFailures';
import { StatCards } from '@/components/overview/StatCards';
import { StatusChart } from '@/components/overview/StatusChart';
import { Button } from '@/components/ui/button';
import { fetchStats, type Stats, type StatsResult } from '@/lib/api';
import { formatWindow } from '@/lib/format';

const WINDOWS = [1, 24, 168, 720] as const;

const ERRORS: Record<Exclude<StatsResult, { ok: true }>['reason'], string> = {
  unauthorized: 'Your API key was not accepted. Sign in again.',
  'rate-limited': 'Too many requests. Wait a moment and refresh.',
  unreachable: 'Could not reach the API. Check your connection and refresh.',
  unexpected: 'The API returned an unexpected response. Try again shortly.',
};

interface OverviewProps {
  apiKey: string;
  onSignOut: () => void;
}

export function Overview({ apiKey, onSignOut }: OverviewProps) {
  const [windowHours, setWindowHours] = useState<number>(24);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetchStats(apiKey, windowHours, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      if (result.ok) {
        setStats(result.stats);
        setError(null);
      } else if (result.reason === 'unauthorized') {
        // The key was revoked since sign-in: drop it rather than show stale data.
        onSignOut();
      } else {
        setError(ERRORS[result.reason]);
      }
    });
    return () => controller.abort();
  }, [apiKey, windowHours, reloads, onSignOut]);

  // Loading starts true and is switched on here, in the handlers, rather than inside the effect.
  const refresh = useCallback(() => {
    setLoading(true);
    setReloads((n) => n + 1);
  }, []);
  const selectWindow = (hours: number) => {
    if (hours === windowHours) return;
    setLoading(true);
    setWindowHours(hours);
  };

  return (
    <div className="min-h-screen">
      <AppHeader onSignOut={onSignOut} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8" aria-busy={loading}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-3xl font-bold">Overview</h1>
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Time window" className="flex gap-1">
              {WINDOWS.map((hours) => (
                <Button
                  key={hours}
                  size="default"
                  variant={hours === windowHours ? 'default' : 'outline'}
                  aria-pressed={hours === windowHours}
                  onClick={() => selectWindow(hours)}
                  className="px-3"
                >
                  {formatWindow(hours)}
                </Button>
              ))}
            </div>
            <Button variant="outline" size="icon" onClick={refresh} aria-label="Refresh">
              <RefreshCw className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />
            </Button>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        {stats ? (
          <>
            <StatCards stats={stats} />
            <StatusChart stats={stats} />
            <RecentFailures failures={stats.recentFailures} />
          </>
        ) : (
          !error && <p className="text-muted-foreground">Loading your project…</p>
        )}
      </main>
    </div>
  );
}
