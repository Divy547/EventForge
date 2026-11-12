import type { DeliveryAttempt } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

function outcome(attempt: DeliveryAttempt): { label: string; ok: boolean } {
  const code = attempt.statusCode;
  if (code !== null && code >= 200 && code < 300) return { label: `HTTP ${code}`, ok: true };
  if (code !== null) return { label: `HTTP ${code}`, ok: false };
  return { label: 'No response', ok: false };
}

/** One entry per attempt, oldest first. Success or failure is always spelled out, not just coloured. */
export function AttemptTimeline({ attempts }: { attempts: DeliveryAttempt[] }) {
  if (attempts.length === 0) {
    return <p className="text-sm text-muted-foreground">No attempts have been made yet.</p>;
  }
  return (
    <ol aria-label="Delivery attempts" className="space-y-4">
      {attempts.map((attempt) => {
        const { label, ok } = outcome(attempt);
        return (
          <li key={attempt.id} className="rounded-md border p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="font-heading font-semibold">Attempt {attempt.attemptNumber}</h3>
              <span
                className={cn(
                  'rounded px-2 py-0.5 text-xs font-medium',
                  ok ? 'bg-chart-1/15 text-foreground' : 'bg-destructive/10 text-destructive',
                )}
              >
                {ok ? 'Succeeded' : 'Failed'} · {label}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {attempt.executionDurationMs} ms
              </span>
              <time dateTime={attempt.createdAt} className="ml-auto text-xs text-muted-foreground">
                {formatDateTime(attempt.createdAt)}
              </time>
            </div>
            {(attempt.errorCode || attempt.errorMessage) && (
              <p className="mt-2 text-sm break-words text-destructive">
                {[attempt.errorCode, attempt.errorMessage].filter(Boolean).join(': ')}
              </p>
            )}
            {attempt.responseBodySnippet && (
              <pre
                aria-label={`Response body of attempt ${attempt.attemptNumber}`}
                tabIndex={0}
                className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap"
              >
                {attempt.responseBodySnippet}
              </pre>
            )}
          </li>
        );
      })}
    </ol>
  );
}
