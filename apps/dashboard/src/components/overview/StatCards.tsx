import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Stats } from '@/lib/api';
import { formatCount, formatPercent } from '@/lib/format';

interface StatCardsProps {
  stats: Stats;
}

export function StatCards({ stats }: StatCardsProps) {
  const items = [
    { label: 'Events', value: formatCount(stats.eventsTotal), hint: 'ingested' },
    { label: 'Deliveries', value: formatCount(stats.deliveriesTotal), hint: 'created' },
    {
      label: 'Success rate',
      value: formatPercent(stats.successRate),
      hint:
        stats.successRate === null
          ? 'no delivery has finished yet'
          : 'completed of completed + dead-lettered',
    },
    {
      label: 'Dead-lettered',
      value: formatCount(stats.deliveriesByStatus.DEAD_LETTER),
      hint: 'gave up after all retries',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} className="gap-2 py-4">
          <CardHeader className="gap-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {item.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-bold tabular-nums">{item.value}</p>
            <CardDescription className="mt-1">{item.hint}</CardDescription>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
