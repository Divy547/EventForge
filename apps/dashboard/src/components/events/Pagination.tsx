import { Button } from '@/components/ui/button';
import { formatCount } from '@/lib/format';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
}

export function Pagination({ page, totalPages, total, noun, onPage }: PaginationProps) {
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Page {formatCount(page)} of {formatCount(Math.max(totalPages, 1))} · {formatCount(total)}{' '}
        {noun}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}
