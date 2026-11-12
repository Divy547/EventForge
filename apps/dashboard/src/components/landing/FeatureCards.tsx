import { Layers, RefreshCw, ShieldCheck, Inbox } from 'lucide-react';
import type { ComponentType } from 'react';
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card';

const FEATURES: { title: string; text: string; icon: ComponentType<{ className?: string }> }[] = [
  {
    title: 'Saved before it is acknowledged',
    text: 'Each event is saved together with its deliveries in one database transaction before the API answers.',
    icon: Layers,
  },
  {
    title: 'Retries with backoff',
    text: 'Failed deliveries are retried with exponential backoff and jitter, and only when a retry can help.',
    icon: RefreshCw,
  },
  {
    title: 'Dead-letter queue',
    text: 'Deliveries that run out of retries wait in the queue so you can inspect them and replay them.',
    icon: Inbox,
  },
  {
    title: 'Signed and safe',
    text: 'Every webhook carries an HMAC signature, and private addresses are blocked to stop SSRF.',
    icon: ShieldCheck,
  },
];

export function FeatureCards() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {FEATURES.map(({ title, text, icon: Icon }) => (
        <li key={title}>
          <Card className="h-full gap-3">
            <CardHeader>
              <Icon aria-hidden className="size-5 text-primary" />
              <h3 className="font-heading text-base leading-none font-semibold">{title}</h3>
              <CardDescription>{text}</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        </li>
      ))}
    </ul>
  );
}
