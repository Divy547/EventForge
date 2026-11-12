import type { DeliveryStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  PENDING: 'Pending',
  IN_FLIGHT: 'In flight',
  COMPLETED: 'Completed',
  FAILED: 'Retrying',
  DEAD_LETTER: 'Dead letter',
};

const TONES: Record<DeliveryStatus, string> = {
  PENDING: 'bg-muted text-foreground',
  IN_FLIGHT: 'bg-chart-2/15 text-foreground',
  COMPLETED: 'bg-chart-1/15 text-foreground',
  FAILED: 'bg-chart-3/15 text-foreground',
  DEAD_LETTER: 'bg-destructive/10 text-destructive',
};

/** Colour is only a hint: the status is always spelled out. */
export function StatusBadge({ status }: { status: DeliveryStatus }) {
  return (
    <span
      className={cn(
        'inline-block rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
