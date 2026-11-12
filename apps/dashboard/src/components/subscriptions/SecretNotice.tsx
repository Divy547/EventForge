import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SecretNoticeProps {
  subscriptionName: string;
  secret: string;
  onDismiss: () => void;
}

/** The API never returns the signing secret again, so this is the visitor's only chance to copy it. */
export function SecretNotice({ subscriptionName, secret, onDismiss }: SecretNoticeProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      // Clipboard access can be blocked; the secret stays selectable on screen.
      setCopyFailed(true);
    }
  }

  return (
    <section
      aria-label="Signing secret"
      className="space-y-3 rounded-md border border-chart-3/60 bg-chart-3/10 p-4"
    >
      <h2 className="font-heading text-lg font-semibold">
        Copy the signing secret for “{subscriptionName}”
      </h2>
      <p className="text-sm">
        This is the only time it is shown. EventForge signs each webhook with it so your endpoint
        can verify the sender; it cannot be retrieved later. If you lose it, create a new
        subscription.
      </p>
      <code className="block rounded bg-background px-3 py-2 font-mono text-sm break-all select-all">
        {secret}
      </code>
      {copyFailed && (
        <p role="alert" className="text-sm text-destructive">
          Could not copy automatically. Select the secret above and copy it by hand.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? 'Copied' : 'Copy secret'}
        </Button>
        <Button onClick={onDismiss}>I have saved it</Button>
      </div>
    </section>
  );
}
