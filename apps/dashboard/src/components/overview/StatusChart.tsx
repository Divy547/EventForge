import { lazy, Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Stats } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { statusRows } from './statusRows';

// Recharts is the heaviest dependency; the numbers below render at once and the bars follow.
const StatusBarChart = lazy(() => import('./StatusBarChart'));

interface StatusChartProps {
  stats: Stats;
}

export function StatusChart({ stats }: StatusChartProps) {
  const rows = statusRows(stats);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">Deliveries by status</CardTitle>
        <CardDescription>
          Where each delivery created in this window stands right now.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_14rem] md:items-center">
        {/* The chart is decorative; the list beside it carries the same numbers as text. */}
        <Suspense fallback={<div className="h-56 w-full" aria-hidden="true" />}>
          <StatusBarChart rows={rows} />
        </Suspense>
        <ul className="space-y-2 text-sm" aria-label="Deliveries by status">
          {rows.map((r) => (
            <li key={r.status} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span
                  className="size-3 rounded-sm"
                  style={{ backgroundColor: r.color }}
                  aria-hidden="true"
                />
                {r.label}
              </span>
              <span className="font-mono tabular-nums">{formatCount(r.count)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
