import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createSubscription,
  FAILURE_MESSAGES,
  updateSubscription,
  type CreatedSubscription,
  type Subscription,
  type SubscriptionPatch,
} from '@/lib/api';

interface SubscriptionFormProps {
  apiKey: string;
  /** Present when editing; absent when creating. */
  existing?: Subscription;
  /** `secret` is set only after a creation, the one time the API reveals it. */
  onSaved: (saved: Subscription, secret?: string) => void;
  onCancel: () => void;
  onSignOut: () => void;
}

/** "order.created, payment.*" or one per line -> ["order.created", "payment.*"]. */
export function parseEventTypes(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function SubscriptionForm({
  apiKey,
  existing,
  onSaved,
  onCancel,
  onSignOut,
}: SubscriptionFormProps) {
  const id = useId();
  const [name, setName] = useState(existing?.name ?? '');
  const [targetUrl, setTargetUrl] = useState(existing?.targetUrl ?? '');
  const [eventTypes, setEventTypes] = useState(existing?.eventTypes.join(', ') ?? '');
  const [rate, setRate] = useState(existing?.rateLimitPerSecond?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedUrl = targetUrl.trim();
    const types = parseEventTypes(eventTypes);
    const rateText = rate.trim();
    const rateValue = rateText === '' ? undefined : Number(rateText);

    if (!trimmedName) return setError('Give the subscription a name.');
    if (!trimmedUrl) return setError('Enter the URL that should receive the webhooks.');
    if (types.length === 0) {
      return setError('List at least one event type, or * to receive every event.');
    }
    if (rateValue !== undefined && (!Number.isInteger(rateValue) || rateValue < 1)) {
      return setError('The rate limit must be a whole number of at least 1, or left empty.');
    }

    setSaving(true);
    setError(null);
    let result;
    if (existing) {
      // Send only what changed. An empty rate limit means "leave it": the API cannot clear one.
      const patch: SubscriptionPatch = {};
      if (trimmedName !== existing.name) patch.name = trimmedName;
      if (trimmedUrl !== existing.targetUrl) patch.targetUrl = trimmedUrl;
      if (!sameList(types, existing.eventTypes)) patch.eventTypes = types;
      if (rateValue !== undefined && rateValue !== existing.rateLimitPerSecond) {
        patch.rateLimitPerSecond = rateValue;
      }
      if (Object.keys(patch).length === 0) {
        setSaving(false);
        onCancel();
        return;
      }
      result = await updateSubscription(apiKey, existing.id, patch);
    } else {
      result = await createSubscription(apiKey, {
        name: trimmedName,
        targetUrl: trimmedUrl,
        eventTypes: types,
        ...(rateValue !== undefined ? { rateLimitPerSecond: rateValue } : {}),
      });
    }
    setSaving(false);

    if (result.ok) {
      const { signingSecret, ...saved } = result.data as CreatedSubscription;
      onSaved(saved, signingSecret);
    } else if (result.reason === 'unauthorized') {
      onSignOut();
    } else if (result.reason === 'rejected') {
      setError(result.message);
    } else {
      setError(FAILURE_MESSAGES[result.reason]);
    }
  }

  const errorId = `${id}-error`;
  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={existing ? 'Edit subscription' : 'New subscription'}
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={255}
          placeholder="Billing webhook"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-url`}>Target URL</Label>
        <Input
          id={`${id}-url`}
          type="url"
          value={targetUrl}
          onChange={(event) => setTargetUrl(event.target.value)}
          placeholder="https://api.example.com/webhooks"
          className="font-mono"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-types`}>Event types</Label>
        <Input
          id={`${id}-types`}
          value={eventTypes}
          onChange={(event) => setEventTypes(event.target.value)}
          placeholder="order.created, payment.succeeded"
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Separate with commas. Use * for every event.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-rate`}>Rate limit (per second)</Label>
        <Input
          id={`${id}-rate`}
          inputMode="numeric"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          placeholder="No limit"
        />
        <p className="text-xs text-muted-foreground">
          {existing?.rateLimitPerSecond
            ? 'A limit, once set, can be changed but not removed.'
            : 'Optional. Extra deliveries are delayed, not dropped.'}
        </p>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-destructive sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Create subscription'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
