import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { StatusFilter } from '@/components/deliveries/StatusFilter';
import { Pagination } from '@/components/events/Pagination';
import { StatusBadge, STATUS_LABELS } from '@/components/events/StatusBadge';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApiResource } from '@/hooks/useApiResource';
import {
  DEFAULT_DELIVERY_STATUS,
  DELIVERY_STATUSES,
  FAILURE_MESSAGES,
  fetchDeliveries,
  type DeliveryStatus,
} from '@/lib/api';
import { formatAgo, formatDateTime, shortId } from '@/lib/format';

interface DeliveriesProps {
  apiKey: string;
  onSignOut: () => void;
}

/** An unknown or missing `status` falls back to the API's own default instead of erroring. */
function readStatus(value: string | null): DeliveryStatus {
  return DELIVERY_STATUSES.find((status) => status === value) ?? DEFAULT_DELIVERY_STATUS;
}

/** Status and page live in the URL so the back button, reloads and shared links keep them. */
export function Deliveries({ apiKey, onSignOut }: DeliveriesProps) {
  const [params, setParams] = useSearchParams();
  const status = readStatus(params.get('status'));
  const requested = Number.parseInt(params.get('page') ?? '1', 10);
  const page = Number.isInteger(requested) && requested >= 1 ? requested : 1;

  const fetcher = useCallback(
    (signal: AbortSignal) => fetchDeliveries(apiKey, { page, status }, signal),
    [apiKey, page, status],
  );
  const { data, failure, loading, reload } = useApiResource(fetcher, onSignOut);

  const goToPage = (target: number) => {
    const next = new URLSearchParams(params);
    if (target <= 1) next.delete('page');
    else next.set('page', String(target));
    setParams(next);
  };

  return (
    <div className="min-h-screen">
      <AppHeader onSignOut={onSignOut} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8" aria-busy={loading}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-3xl font-bold">Deliveries</h1>
          <Button variant="outline" size="icon" onClick={reload} aria-label="Refresh">
            <RefreshCw className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />
          </Button>
        </div>

        <StatusFilter active={status} hrefFor={(target) => `/deliveries?status=${target}`} />

        {failure && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
          >
            {FAILURE_MESSAGES[failure]}
          </p>
        )}

        {data ? (
          <Card className="gap-4">
            <CardContent className="space-y-4">
              {data.data.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No {STATUS_LABELS[status].toLowerCase()} deliveries.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Last update</TableHead>
                      <TableHead>Event</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((delivery) => (
                      <TableRow key={delivery.id}>
                        <TableCell className="font-mono">
                          <Link
                            to={`/deliveries/${delivery.id}`}
                            title={delivery.id}
                            className="font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {shortId(delivery.id)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={delivery.status} />
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {delivery.attemptsCount} of {delivery.maxAttempts}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <time
                            dateTime={delivery.createdAt}
                            title={formatDateTime(delivery.createdAt)}
                          >
                            {formatAgo(delivery.createdAt)}
                          </time>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <time
                            dateTime={delivery.updatedAt}
                            title={formatDateTime(delivery.updatedAt)}
                          >
                            {formatAgo(delivery.updatedAt)}
                          </time>
                        </TableCell>
                        <TableCell className="font-mono">
                          <Link
                            to={`/events/${delivery.eventId}`}
                            title={delivery.eventId}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {shortId(delivery.eventId)}
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Pagination
                page={data.meta.page}
                totalPages={data.meta.totalPages}
                total={data.meta.total}
                noun={data.meta.total === 1 ? 'delivery' : 'deliveries'}
                onPage={goToPage}
              />
            </CardContent>
          </Card>
        ) : (
          !failure && <p className="text-muted-foreground">Loading deliveries…</p>
        )}
      </main>
    </div>
  );
}
