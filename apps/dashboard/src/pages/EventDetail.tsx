import { useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { DeliveriesTable } from '@/components/events/DeliveriesTable';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiResource } from '@/hooks/useApiResource';
import { FAILURE_MESSAGES, fetchEvent, type EventWithDeliveries } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface EventDetailProps {
  apiKey: string;
  onSignOut: () => void;
}

/** Remounted per event ID by the route, so one event's data never shows under another's URL. */
export function EventDetail({ apiKey, onSignOut }: EventDetailProps) {
  const { id = '' } = useParams();
  return <EventDetailBody key={id} id={id} apiKey={apiKey} onSignOut={onSignOut} />;
}

function Json({ value, label }: { value: Record<string, unknown>; label: string }) {
  return (
    <pre
      aria-label={label}
      tabIndex={0}
      className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Facts({ event }: { event: EventWithDeliveries }) {
  const facts: [string, string][] = [
    ['Event ID', event.id],
    ['Source', event.source],
    ['Received', formatDateTime(event.createdAt)],
    ['Idempotency key', event.idempotencyKey ?? '–'],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {facts.map(([term, description]) => (
        <div key={term}>
          <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
          <dd className="font-mono text-sm break-all">{description}</dd>
        </div>
      ))}
    </dl>
  );
}

function EventDetailBody({ id, apiKey, onSignOut }: EventDetailProps & { id: string }) {
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchEvent(apiKey, id, signal),
    [apiKey, id],
  );
  const { data: event, failure, loading, reload } = useApiResource(fetcher, onSignOut);

  return (
    <div className="min-h-screen">
      <AppHeader onSignOut={onSignOut} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8" aria-busy={loading}>
        <Link
          to="/events"
          className="inline-flex h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> All events
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-3xl font-bold break-all">
            {event ? event.eventType : 'Event'}
          </h1>
          <Button variant="outline" size="icon" onClick={reload} aria-label="Refresh">
            <RefreshCw className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />
          </Button>
        </div>

        {failure && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
          >
            {failure === 'not-found'
              ? 'No event with that ID exists in this project.'
              : FAILURE_MESSAGES[failure]}
          </p>
        )}

        {event ? (
          <>
            <Card>
              <CardContent>
                <Facts event={event} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-lg">Deliveries</CardTitle>
                <CardDescription>One row per subscription that matched this event.</CardDescription>
              </CardHeader>
              <CardContent>
                <DeliveriesTable deliveries={event.deliveries} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-lg">Payload</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Json value={event.payload} label="Event payload" />
                {Object.keys(event.metadata).length > 0 && (
                  <>
                    <h3 className="text-sm font-medium">Metadata</h3>
                    <Json value={event.metadata} label="Event metadata" />
                  </>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          !failure && <p className="text-muted-foreground">Loading event…</p>
        )}
      </main>
    </div>
  );
}
