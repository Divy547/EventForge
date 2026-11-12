import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { StatusBadge } from '@/components/events/StatusBadge';
import { fetchEvent, type EventDelivery, type SandboxSend } from '@/lib/api';
import { shortId } from '@/lib/format';
import { SCENARIOS } from '@/lib/sandbox';

const POLL_MS = 1500;
/** Past this, stop polling: the slow scenario needs the longest (5 timeouts plus backoff). */
const GIVE_UP_MS = 5 * 60 * 1000;

function isFinished(deliveries: EventDelivery[]): boolean {
  return (
    deliveries.length > 0 &&
    deliveries.every((d) => d.status === 'COMPLETED' || d.status === 'DEAD_LETTER')
  );
}

interface SandboxRunProps {
  apiKey: string;
  run: SandboxSend;
  onUnauthorized: () => void;
}

/** One sent event, refreshed until its delivery reaches a final state. */
export function SandboxRun({ apiKey, run, onUnauthorized }: SandboxRunProps) {
  const [deliveries, setDeliveries] = useState<EventDelivery[]>([]);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      const result = await fetchEvent(apiKey, run.eventId, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok && result.reason === 'unauthorized') {
        onUnauthorized();
        return;
      }
      const latest = result.ok ? result.data.deliveries : null;
      if (latest) setDeliveries(latest);
      const done = latest !== null && isFinished(latest);
      if (done || Date.now() - started > GIVE_UP_MS) {
        setStopped(!done);
        return;
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [apiKey, run.eventId, onUnauthorized]);

  const label = SCENARIOS.find((s) => s.id === run.scenario)?.label ?? run.scenario;
  const finished = isFinished(deliveries);
  const delivery = deliveries[0];

  return (
    <li className="rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{label}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {run.eventType} · {shortId(run.eventId)}
          </p>
        </div>
        <div className="flex items-center gap-3" aria-live="polite">
          {delivery ? (
            <>
              <StatusBadge status={delivery.status} />
              <span className="text-sm text-muted-foreground tabular-nums">
                {delivery.attemptsCount} of {delivery.maxAttempts} attempts
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Waiting for the worker…</span>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 text-sm">
        <Link
          to={`/events/${run.eventId}`}
          className="inline-flex h-11 items-center text-primary underline-offset-4 hover:underline"
        >
          View event
        </Link>
        {delivery && (
          <Link
            to={`/deliveries/${delivery.id}`}
            className="inline-flex h-11 items-center text-primary underline-offset-4 hover:underline"
          >
            View delivery and attempts
          </Link>
        )}
        {delivery?.status === 'DEAD_LETTER' && (
          <Link
            to="/dead-letters"
            className="inline-flex h-11 items-center text-primary underline-offset-4 hover:underline"
          >
            Replay it from the dead-letter queue
          </Link>
        )}
      </div>
      {stopped && !finished && (
        <p className="text-sm text-muted-foreground">
          Stopped refreshing. Open the event to see where it got to.
        </p>
      )}
    </li>
  );
}
