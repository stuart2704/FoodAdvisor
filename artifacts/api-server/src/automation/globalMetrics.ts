import {
  getCurrentGlobalMetrics,
  type GlobalMetricsSnapshot,
} from "./globalMetricsEngine";
import updateGlobalMetricsSnapshot from "./globalMetricsEngine";

export interface GlobalMetrics {
  totalRestaurants: number;
  totalClients: number;
  totalPremiumClients: number;
  totalVisits: number;
  totalClicks: number;
  updatedAt: string;
}

export async function getGlobalMetrics(): Promise<GlobalMetrics> {
  const metrics = await getCurrentGlobalMetrics();
  return {
    totalRestaurants: metrics.totalRestaurants,
    totalClients: metrics.totalClaimed,
    totalPremiumClients: metrics.totalPremium,
    totalVisits: metrics.totalVisits,
    totalClicks: metrics.totalClicks,
    updatedAt: metrics.updatedAt,
  };
}

export default async function updateGlobalMetrics(): Promise<GlobalMetrics> {
  const metrics: GlobalMetricsSnapshot = await updateGlobalMetricsSnapshot();
  return {
    totalRestaurants: metrics.totalRestaurants,
    totalClients: metrics.totalClaimed,
    totalPremiumClients: metrics.totalPremium,
    totalVisits: metrics.totalVisits,
    totalClicks: metrics.totalClicks,
    updatedAt: metrics.updatedAt,
  };
}