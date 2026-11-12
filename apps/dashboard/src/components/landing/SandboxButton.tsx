import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { startSandboxSession, type SandboxSession } from '@/lib/api';

const MESSAGES = {
  disabled: 'The sandbox is not available on this server.',
  'rate-limited': 'Too many sandbox sessions from your network. Try again later.',
  unreachable: 'Could not reach the API. Check your connection and try again.',
  unexpected: 'The API returned an unexpected error. Try again shortly.',
} as const;

interface SandboxButtonProps {
  onStarted: (session: SandboxSession) => void;
}

/** "Try the live sandbox": asks the API for a short-lived key to the shared demo project. */
export function SandboxButton({ onStarted }: SandboxButtonProps) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    const result = await startSandboxSession();
    setStarting(false);
    if (result.ok) onStarted(result.session);
    else setError(MESSAGES[result.reason]);
  }

  return (
    <div className="mt-6">
      <Button
        onClick={start}
        disabled={starting}
        className="bg-white text-navy hover:bg-white/90 focus-visible:ring-white/50"
      >
        {starting ? 'Starting…' : 'Try the live sandbox'}
      </Button>
      <p className="mt-2 text-sm text-white/70">
        No account needed: send test events to a built-in receiver and watch them being delivered.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-white">
          {error}
        </p>
      )}
    </div>
  );
}
