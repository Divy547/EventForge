import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface EventFilterValues {
  eventType: string;
  source: string;
  from: string;
  to: string;
}

interface EventFiltersProps {
  values: EventFilterValues;
  onApply: (values: EventFilterValues) => void;
}

const FIELDS = [
  { name: 'eventType', label: 'Event type', placeholder: 'order.created', type: 'text' },
  { name: 'source', label: 'Source', placeholder: 'billing-service', type: 'text' },
  { name: 'from', label: 'From', placeholder: '', type: 'date' },
  { name: 'to', label: 'To', placeholder: '', type: 'date' },
] as const;

/** Uncontrolled on purpose: filters apply on submit, not per keystroke. Remount it to reset. */
export function EventFilters({ values, onApply }: EventFiltersProps) {
  return (
    <form
      aria-label="Filter events"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const read = (name: keyof EventFilterValues) => String(data.get(name) ?? '').trim();
        onApply({
          eventType: read('eventType'),
          source: read('source'),
          from: read('from'),
          to: read('to'),
        });
      }}
    >
      {FIELDS.map((field) => (
        <div key={field.name} className="space-y-1.5">
          <Label htmlFor={`filter-${field.name}`}>{field.label}</Label>
          <Input
            id={`filter-${field.name}`}
            name={field.name}
            type={field.type}
            placeholder={field.placeholder}
            defaultValue={values[field.name]}
            autoComplete="off"
          />
        </div>
      ))}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit">Apply filters</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onApply({ eventType: '', source: '', from: '', to: '' })}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}
