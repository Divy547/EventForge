import { useCallback, useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { SandboxRun } from '@/components/sandbox/SandboxRun';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { sendSandboxEvent, type SandboxScenario, type SandboxSend } from '@/lib/api';
import { SCENARIOS } from '@/lib/sandbox';

interface SandboxProps {
  apiKey: string;
  onSignOut: () => void;
}

/** How many sent events stay on screen; older ones remain under Events. */
const MAX_RUNS = 5;

function messageFor(reason: string): string {
  if (reason === 'rate-limited') {
    return 'Sandbox limit reached for your network. Try again in a while.';
  }
  if (reason === 'unreachable') return 'Could not reach the API. Check your connection.';
  if (reason === 'unexpected') {
    return 'The sandbox refused that. This key may not belong to the sandbox project.';
  }
  return 'The sandbox could not send that event.';
}

/** Send a test event to the built-in receiver, then watch the delivery work its way through. */
export function Sandbox({ apiKey, onSignOut }: SandboxProps) {
  const [runs, setRuns] = useState<SandboxSend[]>([]);
  const [sending, setSending] = useState<SandboxScenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stable identity: each run's polling effect depends on it.
  const unauthorized = useCallback(() => onSignOut(), [onSignOut]);

  async function send(scenario: SandboxScenario) {
    setSending(scenario);
    setError(null);
    const result = await sendSandboxEvent(apiKey, scenario);
    setSending(null);
    if (result.ok) {
      setRuns((previous) => [result.data, ...previous].slice(0, MAX_RUNS));
    } else if (result.reason === 'unauthorized') {
      onSignOut();
    } else {
      setError(messageFor(result.reason));
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader onSignOut={onSignOut} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <div>
          <h1 className="font-heading text-3xl font-bold">Sandbox</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Pick how the built-in receiver should behave, send a test event, and watch EventForge
            deliver it: first attempt, retries with backoff, and the dead-letter queue. Everyone
            using the sandbox shares this project, and your key stops working after an hour.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <ul className="grid gap-4 sm:grid-cols-2">
          {SCENARIOS.map((scenario) => (
            <li key={scenario.id}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="font-heading text-lg">{scenario.label}</CardTitle>
                  <CardDescription>{scenario.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  <Button
                    onClick={() => void send(scenario.id)}
                    disabled={sending !== null}
                    aria-label={`Send test event: ${scenario.label}`}
                  >
                    {sending === scenario.id ? 'Sending…' : 'Send test event'}
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>

        {runs.length > 0 && (
          <section aria-labelledby="sent-heading" className="space-y-3">
            <h2 id="sent-heading" className="font-heading text-xl font-semibold">
              Sent events
            </h2>
            <ul className="space-y-3">
              {runs.map((run) => (
                <SandboxRun
                  key={run.eventId}
                  apiKey={apiKey}
                  run={run}
                  onUnauthorized={unauthorized}
                />
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
