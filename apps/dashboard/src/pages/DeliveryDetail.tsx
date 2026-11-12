import { useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { AttemptTimeline } from '@/components/deliveries/AttemptTimeline';
import { StatusBadge } from '@/components/events/StatusBadge';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiResource } from '@/hooks/useApiResource';
import { FAILURE_MESSAGES, fetchDelivery, type DeliveryDetail as Delivery } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface DeliveryDetailProps {
  apiKey: string;
  onSignOut: () => void;
}

/** Remounted per delivery ID by the route, so one delivery's data never shows under another's URL. */
export function DeliveryDetail({ apiKey, onSignOut }: DeliveryDetailProps) {
  const { id = '' } = useParams();
  return <DeliveryDetailBody key={id} id={id} apiKey={apiKey} onSignOut={onSignOut} />;
}

function when(iso: string | null): string {
  return iso ? formatDateTime(iso) : '–';
}

function Facts({ delivery }: { delivery: Delivery }) {
  const { event, subscription } = delivery;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      <Fact term="Delivery ID">{delivery.id}</Fact>
      <Fact term="Status">
        <StatusBadge status={delivery.status} />
      </Fact>
      <Fact term="Event">
        <Link
          to={`/events/${delivery.eventId}`}
          className="text-primary underline underline-offset-4 hover:no-underline"
        >
          {event ? `${event.eventType} (from ${event.source})` : delivery.eventId}
        </Link>
      </Fact>
      <Fact term="Subscription">
        {subscription
          ? `${subscription.name}${subscription.isActive ? '' : ' (disabled)'}`
          : 'Deleted subscription'}
      </Fact>
      <Fact term="Target URL">{subscription?.targetUrl ?? '–'}</Fact>
      <Fact term="Attempts">
        {delivery.attemptsCount} of {delivery.maxAttempts}
      </Fact>
      <Fact term="Created">{formatDateTime(delivery.createdAt)}</Fact>
      <Fact term="Next retry">{when(delivery.nextRetryAt)}</Fact>
      <Fact term="Completed">{when(delivery.completedAt)}</Fact>
    </dl>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
      <dd className="font-mono text-sm break-all">{children}</dd>
    </div>
  );
}

function DeliveryDetailBody({ id, apiKey, onSignOut }: DeliveryDetailProps & { id: string }) {
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchDelivery(apiKey, id, signal),
    [apiKey, id],
  );
  const { data: delivery, failure, loading, reload } = useApiResource(fetcher, onSignOut);

  return (
    <div className="min-h-screen">
      <AppHeader onSignOut={onSignOut} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8" aria-busy={loading}>
        <Link
          to="/deliveries"
          className="inline-flex h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> All deliveries
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-3xl font-bold">Delivery</h1>
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
              ? 'No delivery with that ID exists in this project.'
              : FAILURE_MESSAGES[failure]}
          </p>
        )}

        {delivery ? (
          <>
            <Card>
              <CardContent>
                <Facts delivery={delivery} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-lg">Attempts</CardTitle>
                <CardDescription>Every try to reach the endpoint, oldest first.</CardDescription>
              </CardHeader>
              <CardContent>
                <AttemptTimeline attempts={delivery.attempts} />
              </CardContent>
            </Card>
          </>
        ) : (
          !failure && <p className="text-muted-foreground">Loading delivery…</p>
        )}
      </main>
    </div>
  );
}
