import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { EventFilters, type EventFilterValues } from '@/components/events/EventFilters';
import { Pagination } from '@/components/events/Pagination';
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
import { FAILURE_MESSAGES, fetchEvents } from '@/lib/api';
import { endOfDayIso, formatAgo, formatDateTime, shortId, startOfDayIso } from '@/lib/format';

interface EventsProps {
  apiKey: string;
  onSignOut: () => void;
}

/** Filters live in the URL so the back button, reloads and shared links all keep them. */
export function Events({ apiKey, onSignOut }: EventsProps) {
  const [params, setParams] = useSearchParams();
  const filters: EventFilterValues = {
    eventType: params.get('eventType') ?? '',
    source: params.get('source') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
  const requested = Number.parseInt(params.get('page') ?? '1', 10);
  const page = Number.isInteger(requested) && requested >= 1 ? requested : 1;

  const { eventType, source, from, to } = filters;
  const fetcher = useCallback(
    (signal: AbortSignal) => {
      const query = { page, eventType, source, from: startOfDayIso(from), to: endOfDayIso(to) };
      return fetchEvents(apiKey, query, signal);
    },
    [apiKey, page, eventType, source, from, to],
  );
  const { data, failure, loading, reload } = useApiResource(fetcher, onSignOut);

  const apply = (values: EventFilterValues) => {
    const next = new URLSearchParams();
    for (const [name, value] of Object.entries(values)) if (value) next.set(name, value);
    setParams(next);
  };
  const goToPage = (target: number) => {
    const next = new URLSearchParams(params);
    if (target <= 1) next.delete('page');
    else next.set('page', String(target));
    setParams(next);
  };

  const filtered = Boolean(eventType || source || from || to);

  return (
    <div className="min-h-screen">
      <AppHeader onSignOut={onSignOut} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8" aria-busy={loading}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-3xl font-bold">Events</h1>
          <Button variant="outline" size="icon" onClick={reload} aria-label="Refresh">
            <RefreshCw className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />
          </Button>
        </div>

        <Card>
          <CardContent>
            {/* Remounted when the URL filters change so the inputs always show what is applied. */}
            <EventFilters key={params.toString()} values={filters} onApply={apply} />
          </CardContent>
        </Card>

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
                  {filtered ? 'No events match these filters.' : 'No events yet.'}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Received</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="whitespace-nowrap">
                          <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
                            {formatAgo(event.createdAt)}
                          </time>
                        </TableCell>
                        <TableCell className="font-mono">
                          <Link
                            to={`/events/${event.id}`}
                            className="font-medium text-primary underline underline-offset-4 hover:no-underline"
                          >
                            {event.eventType}
                          </Link>
                        </TableCell>
                        <TableCell>{event.source}</TableCell>
                        <TableCell className="font-mono text-muted-foreground" title={event.id}>
                          {shortId(event.id)}
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
                noun={data.meta.total === 1 ? 'event' : 'events'}
                onPage={goToPage}
              />
            </CardContent>
          </Card>
        ) : (
          !failure && <p className="text-muted-foreground">Loading events…</p>
        )}
      </main>
    </div>
  );
}
