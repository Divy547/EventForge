import { Link } from 'react-router';
import { DELIVERY_STATUSES, type DeliveryStatus } from '@/lib/api';
import { STATUS_LABELS } from '@/components/events/StatusBadge';
import { cn } from '@/lib/utils';

interface StatusFilterProps {
  active: DeliveryStatus;
  /** The link target for a status, so the choice lives in the URL. */
  hrefFor: (status: DeliveryStatus) => string;
}

/** Plain links rather than a form: each status is a shareable URL and works without scripting. */
export function StatusFilter({ active, hrefFor }: StatusFilterProps) {
  return (
    <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
      {DELIVERY_STATUSES.map((status) => (
        <Link
          key={status}
          to={hrefFor(status)}
          aria-current={status === active ? 'true' : undefined}
          className={cn(
            'inline-flex h-11 items-center rounded-md border px-4 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            status === active
              ? 'border-primary bg-primary text-primary-foreground'
              : 'hover:bg-muted',
          )}
        >
          {STATUS_LABELS[status]}
        </Link>
      ))}
    </nav>
  );
}
