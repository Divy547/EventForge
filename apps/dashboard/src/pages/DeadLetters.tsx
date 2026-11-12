import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { RefreshCw, RotateCw } from 'lucide-react';
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
import {
  FAILURE_MESSAGES,
  fetchDeliveries,
  fetchSubscriptions,
  replayDeliveries,
  replayDelivery,
  type MutationResult,
} from '@/lib/api';
import { formatAgo, formatDateTime, shortId } from '@/lib/format';

interface DeadLettersProps {
  apiKey: string;
  onSignOut: () => void;
}

/** What the last replay did, shown until the visitor acts again. */
type Outcome = { kind: 'success' | 'error'; text: string; details?: string[] };

function pluralise(count: number): string {
  return count === 1 ? '1 delivery' : `${count} deliveries`;
}

/** Dead letters are deliveries that used up every attempt; replay gives them fresh ones. */
export function DeadLetters({ apiKey, onSignOut }: DeadLettersProps) {
  const [params, setParams] = useSearchParams();
  const requested = Number.parseInt(params.get('page') ?? '1', 10);
  const page = Number.isInteger(requested) && requested >= 1 ? requested : 1;

  const fetcher = useCallback(
    (signal: AbortSignal) => fetchDeliveries(apiKey, { page, status: 'DEAD_LETTER' }, signal),
    [apiKey, page],
  );
  const { data, failure, loading, reload } = useApiResource(fetcher, onSignOut);

  // Names are a nicety: the list carries subscription IDs only, so a failure here just shows IDs.
  const namesFetcher = useCallback(
    (signal: AbortSignal) => fetchSubscriptions(apiKey, signal),
    [apiKey],
  );
  const { data: subscriptions } = useApiResource(namesFetcher, onSignOut);
  const subscriptionNames = useMemo(
    () =>
      new Map((subscriptions ?? []).map((subscription) => [subscription.id, subscription.name])),
    [subscriptions],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const rows = data?.data ?? [];
  // Only rows still on screen count, so a stale selection never replays something unseen.
  const chosen = rows.filter((delivery) => selected.has(delivery.id)).map((d) => d.id);
  const allChosen = rows.length > 0 && chosen.length === rows.length;

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allChosen ? new Set() : new Set(rows.map((delivery) => delivery.id)));
  }

  function goToPage(target: number) {
    const next = new URLSearchParams(params);
    if (target <= 1) next.delete('page');
    else next.set('page', String(target));
    setSelected(new Set());
    setOutcome(null);
    setParams(next);
  }

  /** Shared tail of both replay paths: report, clear the selection, and refresh the list. */
  function finish<T>(result: MutationResult<T>, onOk: (data: T) => Outcome) {
    setBusy(false);
    if (!result.ok && result.reason === 'unauthorized') {
      onSignOut();
      return;
    }
    setSelected(new Set());
    if (result.ok) setOutcome(onOk(result.data));
    else if (result.reason === 'rejected') setOutcome({ kind: 'error', text: result.message });
    else setOutcome({ kind: 'error', text: FAILURE_MESSAGES[result.reason] });
    // Even a conflict or a miss means the list is out of date.
    reload();
  }

  async function replayOne(id: string) {
    setBusy(true);
    setOutcome(null);
    finish(await replayDelivery(apiKey, id), () => ({
      kind: 'success',
      text: `Replayed delivery ${shortId(id)}. It is queued to be sent again.`,
    }));
  }

  async function replaySelected() {
    setBusy(true);
    setOutcome(null);
    finish(await replayDeliveries(apiKey, chosen), (result) => {
      const failed = result.items.filter((item) => !item.success);
      const details = failed.map(
        (item) => `${shortId(item.deliveryId)}: ${item.error ?? 'failed'}`,
      );
      if (result.replayedCount === 0) {
        return { kind: 'error', text: 'No deliveries were replayed.', details };
      }
      return {
        kind: failed.length > 0 ? 'error' : 'success',
        text:
          failed.length > 0
            ? `Replayed ${pluralise(result.replayedCount)}; ${failed.length} could not be replayed.`
            : `Replayed ${pluralise(result.replayedCount)}. They are queued to be sent again.`,
        details,
      };
    });
  }

  return (
    <div className="min-h-screen">
      <AppHeader onSignOut={onSignOut} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8" aria-busy={loading}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-3xl font-bold">Dead letters</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={reload} aria-label="Refresh">
              <RefreshCw className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />
            </Button>
            <Button disabled={busy || chosen.length === 0} onClick={() => void replaySelected()}>
              <RotateCw aria-hidden />
              {chosen.length > 0 ? `Replay selected (${chosen.length})` : 'Replay selected'}
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          These deliveries used every attempt without succeeding. Replaying one resets it to pending
          with three more attempts.
        </p>

        {outcome && (
          <div
            role={outcome.kind === 'error' ? 'alert' : 'status'}
            className={
              outcome.kind === 'error'
                ? 'rounded-md border border-destructive/40 p-3 text-sm text-destructive'
                : 'rounded-md border p-3 text-sm'
            }
          >
            <p>{outcome.text}</p>
            {outcome.details && outcome.details.length > 0 && (
              <ul className="mt-2 list-disc pl-5 font-mono">
                {outcome.details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {outcome.kind === 'success' && (
              <p className="mt-2">
                <Link
                  to="/deliveries?status=PENDING"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  See pending deliveries
                </Link>
              </p>
            )}
          </div>
        )}

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
              {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No dead letters. Every delivery either succeeded or is still retrying.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <label className="inline-flex h-11 w-11 items-center justify-center">
                          <input
                            type="checkbox"
                            className="size-5"
                            checked={allChosen}
                            onChange={toggleAll}
                            aria-label="Select all on this page"
                          />
                        </label>
                      </TableHead>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Subscription</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Gave up</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((delivery) => (
                      <TableRow key={delivery.id}>
                        <TableCell>
                          <label className="inline-flex h-11 w-11 items-center justify-center">
                            <input
                              type="checkbox"
                              className="size-5"
                              checked={selected.has(delivery.id)}
                              onChange={() => toggle(delivery.id)}
                              aria-label={`Select delivery ${shortId(delivery.id)}`}
                            />
                          </label>
                        </TableCell>
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
                          {subscriptionNames.get(delivery.subscriptionId) ?? (
                            <span className="font-mono" title={delivery.subscriptionId}>
                              {shortId(delivery.subscriptionId)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {delivery.attemptsCount} of {delivery.maxAttempts}
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
                        <TableCell>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => void replayOne(delivery.id)}
                            aria-label={`Replay delivery ${shortId(delivery.id)}`}
                          >
                            Replay
                          </Button>
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
                noun={data.meta.total === 1 ? 'dead letter' : 'dead letters'}
                onPage={goToPage}
              />
            </CardContent>
          </Card>
        ) : (
          !failure && <p className="text-muted-foreground">Loading dead letters…</p>
        )}
      </main>
    </div>
  );
}
