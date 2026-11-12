import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { checkApiKey, type KeyCheck } from '@/lib/api';

const MESSAGES: Record<Exclude<KeyCheck, { ok: true }>['reason'], string> = {
  invalid: 'That API key was not accepted. Check it and try again.',
  'rate-limited': 'Too many attempts. Wait a moment and try again.',
  unreachable: 'Could not reach the API. Check your connection and try again.',
  unexpected: 'The API returned an unexpected error. Try again shortly.',
};

interface LoginFormProps {
  /** Called with the trimmed key once the API has accepted it. */
  onSignedIn: (apiKey: string) => void;
}

export function LoginForm({ onSignedIn }: LoginFormProps) {
  const inputId = useId();
  const errorId = useId();
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = apiKey.trim();
    if (!key) {
      setError('Paste your project API key to continue.');
      return;
    }
    setChecking(true);
    setError(null);
    const result = await checkApiKey(key);
    setChecking(false);
    if (result.ok) {
      onSignedIn(key);
    } else {
      setError(MESSAGES[result.reason]);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      <Label htmlFor={inputId}>Project API key</Label>
      <Input
        id={inputId}
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="Paste your key"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="font-mono"
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={checking}>
        {checking ? 'Checking…' : 'Sign in'}
      </Button>
      <p className="text-xs text-muted-foreground">
        Kept in this tab only and cleared when you close it.
      </p>
    </form>
  );
}
