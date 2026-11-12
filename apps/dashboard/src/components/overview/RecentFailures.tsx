import { Link } from 'react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { RecentFailure } from '@/lib/api';
import { formatAgo } from '@/lib/format';

interface RecentFailuresProps {
  failures: RecentFailure[];
}

function reason(f: RecentFailure): string {
  if (f.lastError) return f.lastError;
  if (f.lastStatusCode !== null) return `Endpoint answered HTTP ${f.lastStatusCode}`;
  return 'No error recorded';
}

export function RecentFailures({ failures }: RecentFailuresProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">Recent failures</CardTitle>
        <CardDescription>The latest deliveries that failed or were dead-lettered.</CardDescription>
      </CardHeader>
      <CardContent>
        {failures.length === 0 ? (
          <p className="text-sm text-muted-foreground">No failures in this window.</p>
        ) : (
          <ul className="divide-y">
            {failures.map((f) => (
              <li key={f.deliveryId} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    to={`/deliveries/${f.deliveryId}`}
                    className="font-mono text-sm font-medium text-primary underline underline-offset-4 hover:no-underline"
                  >
                    {f.eventType}
                  </Link>
                  <span className="text-sm text-muted-foreground">→ {f.subscriptionName}</span>
                  <span
                    className={
                      f.status === 'DEAD_LETTER'
                        ? 'rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive'
                        : 'rounded bg-muted px-2 py-0.5 text-xs font-medium text-foreground'
                    }
                  >
                    {f.status === 'DEAD_LETTER' ? 'Dead letter' : 'Retrying'}
                  </span>
                  <time
                    dateTime={f.updatedAt}
                    title={new Date(f.updatedAt).toLocaleString()}
                    className="ml-auto text-xs text-muted-foreground"
                  >
                    {formatAgo(f.updatedAt)}
                  </time>
                </div>
                <p className="text-sm break-words text-muted-foreground">
                  {reason(f)} · {f.attemptsCount} {f.attemptsCount === 1 ? 'attempt' : 'attempts'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
