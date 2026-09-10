import type { DashboardStatusCounts } from '@workspace/api-client-react';
import { getStatus } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isStatusCounts(value: unknown): value is DashboardStatusCounts {
  return Array.isArray(value) && value.every((row) => row && typeof row.status === 'string'
    && Number.isSafeInteger(row.count) && row.count >= 0);
}

export default function StatusPanel() {
  const state = useDashboardResource(getStatus, isStatusCounts);
  return (
    <DashboardPanel title="Status Counts" description="Current restaurant workflow totals from the database." {...state}>
      {!state.data?.length ? <p className="text-sm text-muted-foreground">No records found.</p> : (
        <ul className="space-y-2">
          {state.data.map((row) => (
            <li key={row.status} className="flex items-center justify-between gap-4 border-b py-2 text-sm">
              <span className="break-words">{row.status.replaceAll('_', ' ')}</span>
              <span className="font-semibold tabular-nums">{row.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}