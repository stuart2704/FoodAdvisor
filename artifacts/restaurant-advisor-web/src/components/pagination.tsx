import { Link } from 'wouter';
import { Button } from '@/components/ui/button';

export default function Pagination({
  current,
  total,
  baseUrl,
}: {
  current: number;
  total: number;
  baseUrl: string;
}) {
  return (
    <nav
      className="pagination flex items-center justify-between border-t border-border pt-6"
      aria-label="Pagination"
    >
      {current > 1 ? (
        <Button variant="outline" asChild>
          <Link href={`${baseUrl}?page=${current - 1}`}>Previous</Link>
        </Button>
      ) : (
        <span />
      )}
      <span className="text-sm text-muted-foreground">
        Page {current} of {Math.max(1, total)}
      </span>
      {current < total ? (
        <Button variant="outline" asChild>
          <Link href={`${baseUrl}?page=${current + 1}`}>Next</Link>
        </Button>
      ) : (
        <span />
      )}
    </nav>
  );
}