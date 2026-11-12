import type { DeliveryStatus, Stats } from '@/lib/api';

export interface StatusRow {
  status: DeliveryStatus;
  label: string;
  color: string;
  count: number;
}

const ORDER: { status: DeliveryStatus; label: string; color: string }[] = [
  { status: 'COMPLETED', label: 'Completed', color: 'var(--chart-1)' },
  { status: 'PENDING', label: 'Pending', color: 'var(--chart-2)' },
  { status: 'IN_FLIGHT', label: 'In flight', color: 'var(--chart-5)' },
  { status: 'FAILED', label: 'Failed (retrying)', color: 'var(--chart-3)' },
  { status: 'DEAD_LETTER', label: 'Dead letter', color: 'var(--chart-4)' },
];

export function statusRows(stats: Stats): StatusRow[] {
  return ORDER.map((o) => ({ ...o, count: stats.deliveriesByStatus[o.status] }));
}
