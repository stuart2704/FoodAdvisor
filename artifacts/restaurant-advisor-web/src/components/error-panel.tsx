import { getErrors } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isErrorCounts(value: unknown): value is Record<string, number> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([category, count]) =>
      /^[a-z][a-z0-9_-]{0,63}$/i.test(category)
      && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0);
}

export default function ErrorPanel() {
  const state = useDashboardResource(getErrors, isErrorCounts);
  const categories = Object.entries(state.data ?? {})
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b));
  return (
    <DashboardPanel title="Error Categories" description="Counts from the latest 200 events. Resets on server restart." {...state}>
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">No errors recorded.</p>
      ) : (
        <ul className="space-y-2">
          {categories.map(([category, count]) => (
            <li key={category} className="flex items-center justify-between gap-4 border-b py-2 text-sm">
              <span className="break-words">{category.replaceAll('_', ' ')}</span>
              <span className="font-semibold tabular-nums">{count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}