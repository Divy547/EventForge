import { StatusBadge } from '@/components/events/StatusBadge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { EventDelivery } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

function when(iso: string | null): string {
  return iso ? formatDateTime(iso) : '–';
}

export function DeliveriesTable({ deliveries }: { deliveries: EventDelivery[] }) {
  if (deliveries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No deliveries: no active subscription matched this event.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Subscription</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Attempts</TableHead>
          <TableHead>Next retry</TableHead>
          <TableHead>Completed</TableHead>
          <TableHead>Last update</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deliveries.map((d) => (
          <TableRow key={d.id}>
            <TableCell className="font-medium">{d.subscriptionName}</TableCell>
            <TableCell>
              <StatusBadge status={d.status} />
            </TableCell>
            <TableCell className="tabular-nums">
              {d.attemptsCount} of {d.maxAttempts}
            </TableCell>
            <TableCell className="whitespace-nowrap">{when(d.nextRetryAt)}</TableCell>
            <TableCell className="whitespace-nowrap">{when(d.completedAt)}</TableCell>
            <TableCell className="whitespace-nowrap">{formatDateTime(d.updatedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
