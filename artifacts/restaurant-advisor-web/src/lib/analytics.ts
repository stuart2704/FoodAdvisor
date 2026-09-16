export function recordRestaurantClick(restaurantId: string): void {
  void fetch('/api/analytics/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ restaurantId, type: 'click' }),
    keepalive: true,
  });
}