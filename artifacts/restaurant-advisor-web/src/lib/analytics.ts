type AnalyticsData = Record<string, string | number | boolean>;

type TrackerProperties = { website: string };

declare global {
  interface Window {
    umami?: {
      track(
        nameOrPayload: string | ((properties: TrackerProperties) => Record<string, unknown>),
        data?: AnalyticsData,
      ): void;
    };
  }
}

export function trackEvent(name: string, data?: AnalyticsData, safePath?: string): void {
  if (typeof window === "undefined") return;

  try {
    if (safePath) {
      // Owner URLs contain access tokens and public detail URLs contain restaurant IDs.
      // Retain only the tracker website ID; never send the current URL, title or referrer.
      window.umami?.track(({ website }) => ({
        website,
        url: safePath,
        title: "Booking",
        name,
        data,
      }));
    } else {
      window.umami?.track(name, data);
    }
  } catch {
    // Analytics must never break booking management or navigation.
  }
}