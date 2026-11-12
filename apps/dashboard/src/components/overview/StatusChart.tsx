import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { DeliveryStatus, Stats } from '@/lib/api';
import { formatCount } from '@/lib/format';

const ORDER: { status: DeliveryStatus; label: string; color: string }[] = [
  { status: 'COMPLETED', label: 'Completed', color: 'var(--chart-1)' },
  { status: 'PENDING', label: 'Pending', color: 'var(--chart-2)' },
  { status: 'IN_FLIGHT', label: 'In flight', color: 'var(--chart-5)' },
  { status: 'FAILED', label: 'Failed (retrying)', color: 'var(--chart-3)' },
  { status: 'DEAD_LETTER', label: 'Dead letter', color: 'var(--chart-4)' },
];

const config: ChartConfig = { count: { label: 'Deliveries' } };

interface StatusChartProps {
  stats: Stats;
}

export function StatusChart({ stats }: StatusChartProps) {
  const rows = ORDER.map((o) => ({ ...o, count: stats.deliveriesByStatus[o.status] }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">Deliveries by status</CardTitle>
        <CardDescription>
          Where each delivery created in this window stands right now.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-[1fr_14rem] md:items-center">
        {/* The chart is decorative; the list beside it carries the same numbers as text. */}
        <ChartContainer config={config} className="h-56 w-full" aria-hidden="true">
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <Bar dataKey="count" radius={4}>
              {rows.map((r) => (
                <Cell key={r.status} fill={r.color} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
        <ul className="space-y-2 text-sm" aria-label="Deliveries by status">
          {rows.map((r) => (
            <li key={r.status} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span
                  className="size-3 rounded-sm"
                  style={{ backgroundColor: r.color }}
                  aria-hidden="true"
                />
                {r.label}
              </span>
              <span className="font-mono tabular-nums">{formatCount(r.count)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
