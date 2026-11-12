import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { StatusRow } from './statusRows';

const config: ChartConfig = { count: { label: 'Deliveries' } };

/**
 * The only importer of Recharts: StatusChart loads this file lazily to keep the main bundle small.
 * Bar animation is off on purpose: it is decorative (so reduced motion is respected without
 * a check), and in a headless-Chrome check the bars stayed empty once the chart was lazy-loaded.
 */
export default function StatusBarChart({ rows }: { rows: StatusRow[] }) {
  return (
    <ChartContainer config={config} className="h-56 w-full" aria-hidden="true">
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="count" radius={4} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={r.status} fill={r.color} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
