import { Crown } from 'lucide-react';
import { getPremiumClients, type PremiumClientsResponse } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isPremiumClients(value: unknown): value is PremiumClientsResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<PremiumClientsResponse>;
  return response.success === true && Array.isArray(response.items);
}

export function PremiumClients() {
  const state = useDashboardResource(getPremiumClients, isPremiumClients);
  return (
    <DashboardPanel
      title="Premium Clients"
      description="Restaurants with an active Stripe-backed Premium subscription."
      {...state}
    >
      {state.data?.items.length ? (
        <div className="divide-y divide-border">
          {state.data.items.map((item) => (
            <div key={item.placeId} className="flex items-center justify-between gap-4 py-3">
              <div>
                <div className="flex items-center gap-2 font-semibold">
                  <Crown className="h-4 w-4 text-primary" />
                  {item.name}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.city}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Since {new Date(item.premiumSince).toLocaleDateString('en-GB')}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No active Premium clients yet.</p>
      )}
    </DashboardPanel>
  );
}