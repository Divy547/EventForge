import { useCallback, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { RecentFailures } from '@/components/overview/RecentFailures';
import { StatCards } from '@/components/overview/StatCards';
import { StatusChart } from '@/components/overview/StatusChart';
import { Button } from '@/components/ui/button';
import { useApiResource } from '@/hooks/useApiResource';
import { FAILURE_MESSAGES, fetchStats } from '@/lib/api';
import { formatWindow } from '@/lib/format';

const WINDOWS = [1, 24, 168, 720] as const;

interface OverviewProps {
  apiKey: string;
  onSignOut: () => void;
}

export function Overview({ apiKey, onSignOut }: OverviewProps) {
  const [windowHours, setWindowHours] = useState<number>(24);
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchStats(apiKey, windowHours, signal),
    [apiKey, windowHours],
  );
  const { data: stats, failure, loading, reload } = useApiResource(fetcher, onSignOut);
  const error = failure ? FAILURE_MESSAGES[failure] : null;

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
                  onClick={() => setWindowHours(hours)}
                  className="px-3"
                >
                  {formatWindow(hours)}
                </Button>
              ))}
            </div>
            <Button variant="outline" size="icon" onClick={reload} aria-label="Refresh">
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
