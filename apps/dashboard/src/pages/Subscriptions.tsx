import { useCallback, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { SecretNotice } from '@/components/subscriptions/SecretNotice';
import { SubscriptionForm } from '@/components/subscriptions/SubscriptionForm';
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
  fetchSubscriptions,
  updateSubscription,
  type Subscription,
} from '@/lib/api';
import { cn } from '@/lib/utils';

interface SubscriptionsProps {
  apiKey: string;
  onSignOut: () => void;
}

/** What the form area shows: nothing, a blank form, or the form for one existing subscription. */
type Editor = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; id: string };

export function Subscriptions({ apiKey, onSignOut }: SubscriptionsProps) {
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchSubscriptions(apiKey, signal),
    [apiKey],
  );
  const { data, failure, loading, reload } = useApiResource(fetcher, onSignOut);

  const [editor, setEditor] = useState<Editor>({ mode: 'closed' });
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  async function toggleActive(subscription: Subscription) {
    setTogglingId(subscription.id);
    setToggleError(null);
    const result = await updateSubscription(apiKey, subscription.id, {
      isActive: !subscription.isActive,
    });
    setTogglingId(null);
    if (result.ok) reload();
    else if (result.reason === 'unauthorized') onSignOut();
    else if (result.reason === 'rejected') setToggleError(result.message);
    else setToggleError(FAILURE_MESSAGES[result.reason]);
  }

  const editing =
    editor.mode === 'edit'
      ? data?.find((subscription) => subscription.id === editor.id)
      : undefined;

  return (
    <div className="min-h-screen">
      <AppHeader onSignOut={onSignOut} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8" aria-busy={loading}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-3xl font-bold">Subscriptions</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={reload} aria-label="Refresh">
              <RefreshCw className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />
            </Button>
            <Button
              onClick={() => setEditor({ mode: 'create' })}
              disabled={editor.mode === 'create'}
            >
              <Plus aria-hidden /> New subscription
            </Button>
          </div>
        </div>

        {secret && (
          <SecretNotice
            subscriptionName={secret.name}
            secret={secret.value}
            onDismiss={() => setSecret(null)}
          />
        )}

        {editor.mode === 'create' && (
          <Card>
            <CardContent>
              <SubscriptionForm
                apiKey={apiKey}
                onSignOut={onSignOut}
                onCancel={() => setEditor({ mode: 'closed' })}
                onSaved={(saved, created) => {
                  setEditor({ mode: 'closed' });
                  if (created) setSecret({ name: saved.name, value: created });
                  reload();
                }}
              />
            </CardContent>
          </Card>
        )}

        {editing && (
          <Card>
            <CardContent>
              <SubscriptionForm
                // Remount per subscription so one row's values never leak into another's form.
                key={editing.id}
                apiKey={apiKey}
                existing={editing}
                onSignOut={onSignOut}
                onCancel={() => setEditor({ mode: 'closed' })}
                onSaved={() => {
                  setEditor({ mode: 'closed' });
                  reload();
                }}
              />
            </CardContent>
          </Card>
        )}

        {failure && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
          >
            {FAILURE_MESSAGES[failure]}
          </p>
        )}
        {toggleError && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
          >
            {toggleError}
          </p>
        )}

        {data ? (
          <Card className="gap-4">
            <CardContent>
              {data.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No subscriptions yet. Create one to start receiving webhooks.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Target URL</TableHead>
                      <TableHead>Event types</TableHead>
                      <TableHead>Rate limit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((subscription) => (
                      <TableRow key={subscription.id}>
                        <TableCell className="font-medium">{subscription.name}</TableCell>
                        <TableCell className="max-w-64 font-mono break-all">
                          {subscription.targetUrl}
                        </TableCell>
                        <TableCell className="font-mono">
                          {subscription.eventTypes.join(', ')}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {subscription.rateLimitPerSecond
                            ? `${subscription.rateLimitPerSecond}/s`
                            : 'None'}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              'inline-block rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                              subscription.isActive
                                ? 'bg-chart-1/15 text-foreground'
                                : 'bg-muted text-foreground',
                            )}
                          >
                            {subscription.isActive ? 'Active' : 'Disabled'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() => setEditor({ mode: 'edit', id: subscription.id })}
                              aria-label={`Edit ${subscription.name}`}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              disabled={togglingId === subscription.id}
                              onClick={() => void toggleActive(subscription)}
                              aria-label={`${subscription.isActive ? 'Disable' : 'Enable'} ${subscription.name}`}
                            >
                              {subscription.isActive ? 'Disable' : 'Enable'}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : (
          !failure && <p className="text-muted-foreground">Loading subscriptions…</p>
        )}
      </main>
    </div>
  );
}
