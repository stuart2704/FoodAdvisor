import type {
  DashboardHealth,
  DashboardStatusCounts,
  GetDashboardErrors200,
  GetDashboardEvents200Item,
  GetDashboardSummary200,
} from '@workspace/api-client-react';

export interface DashboardRequestOptions {
  signal?: AbortSignal;
  /** Optional caller-supplied credential; never stored or bundled by this helper. */
  token?: string;
}

export type DashboardStats = GetDashboardSummary200 & {
  totalRestaurants: number;
  outreachSent: number;
  claims: number;
};

export interface PremiumClientsResponse {
  success: boolean;
  items: Array<{
    placeId: string;
    name: string;
    city: string;
    premiumSince: string;
    stripeSubscriptionId: string | null;
  }>;
}

export interface SearchMetricsResponse {
  success: boolean;
  periodDays: number;
  searches: number;
  searchesToday: number;
  zeroResultSearches: number;
  zeroResultRate: number;
  aiSearches: number;
  aiScoredRestaurants: number;
  averageResults: number;
  averageDurationMs: number;
  generatedAt: string;
}

export interface RankingMetricsResponse {
  success: boolean;
  count: number;
  rankedRestaurants: number;
  averagePremiumScore: number;
  averageBasicScore: number;
  lastUpdate: string | null;
  lastUpdated: string | null;
  premiumBoostActive: boolean;
  topRestaurants: Array<{
    placeId: string;
    name: string;
    city: string;
    cuisine: string | null;
    premium: boolean;
    rankingScore: number;
  }>;
}

export interface HomepageMetricsResponse {
  success: boolean;
  periodDays: number;
  loads: number;
  loadsToday: number;
  averageFeatured: number;
  averageTrending: number;
  averagePremium: number;
  averageDiscovery: number;
  generatedAt: string;
}

export class DashboardApiError extends Error {
  constructor(message: string, public readonly status: number | null) {
    super(message);
    this.name = 'DashboardApiError';
  }
}

async function request<T>(endpoint: string, options: DashboardRequestOptions = {}): Promise<{ data: T; status: number }> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10000);
  try {
    const headers = new Headers({ Accept: 'application/json' });
    if (options.token !== undefined) {
      if (!options.token || /[\r\n]/.test(options.token)) {
        throw new DashboardApiError('Invalid dashboard credential.', 401);
      }
      headers.set('Authorization', `Bearer ${options.token}`);
    }
    // These exact cross-artifact paths are routed to the shared API server.
    const response = await fetch(`/dashboard/${endpoint}`, {
      headers, signal: controller.signal, cache: 'no-store', credentials: 'include',
    });
    if (response.status === 401 || response.status === 403) {
      window.location.assign('/admin/login');
      throw new DashboardApiError('Dashboard access requires authorised admin credentials. Browser access has not been configured.', response.status);
    }
    if (!response.ok) throw new DashboardApiError('The dashboard service is temporarily unavailable.', response.status);
    let data: T;
    try { data = await response.json() as T; }
    catch { throw new DashboardApiError('The dashboard returned an unreadable response.', response.status); }
    return { data, status: response.status };
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Dashboard request cancelled.', 'AbortError');
    if (timedOut) throw new DashboardApiError('The dashboard request timed out.', null);
    if (error instanceof DashboardApiError) throw error;
    throw new DashboardApiError('Could not reach the dashboard service.', null);
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

// Keep the supplied panels' `response.data` convention without adding Axios.
export const getEvents = (options?: DashboardRequestOptions) => request<GetDashboardEvents200Item[]>('events', options);
export const getHealth = (options?: DashboardRequestOptions) => request<DashboardHealth>('health', options);
export const getStatus = (options?: DashboardRequestOptions) => request<DashboardStatusCounts>('status', options);
export const getErrors = (options?: DashboardRequestOptions) => request<GetDashboardErrors200>('errors', options);
export const getSummary = (options?: DashboardRequestOptions) => request<DashboardStats>('stats', options);
export const getPremiumClients = (options?: DashboardRequestOptions) =>
  request<PremiumClientsResponse>('premium', options);
export const getSearchMetrics = (options?: DashboardRequestOptions) =>
  request<SearchMetricsResponse>('search-metrics', options);
export const getRankingMetrics = (options?: DashboardRequestOptions) =>
  request<RankingMetricsResponse>('ranking', options);
export const getHomepageMetrics = (options?: DashboardRequestOptions) =>
  request<HomepageMetricsResponse>('homepage-metrics', options);