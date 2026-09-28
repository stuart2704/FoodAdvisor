import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEvent } from "./analytics";

afterEach(() => vi.unstubAllGlobals());

describe("booking analytics", () => {
  it("sends only safe booking metadata, not the private or public page URL", () => {
    const track = vi.fn((payload: (props: { website: string }) => Record<string, unknown>) =>
      payload({
        website: "site",
        url: "/portal/private-token",
        referrer: "/restaurant/123",
        title: "Private owner name",
      } as { website: string }));
    vi.stubGlobal("window", { umami: { track } });

    trackEvent("booking_link_published", { has_provider_label: true }, "/booking");

    expect(track).toHaveBeenCalledOnce();
    expect(track.mock.results[0].value).toEqual({
      website: "site",
      url: "/booking",
      title: "Booking",
      name: "booking_link_published",
      data: { has_provider_label: true },
    });
  });

  it("never interrupts an action when the tracker is missing or throws", () => {
    vi.stubGlobal("window", {});
    expect(() => trackEvent("booking_now_clicked", undefined, "/booking")).not.toThrow();
    vi.stubGlobal("window", { umami: { track: () => { throw new Error("unavailable"); } } });
    expect(() => trackEvent("booking_link_withdrawn", undefined, "/booking")).not.toThrow();
  });

  it("sends offer outcomes without tracker-inferred owner URLs or referrers", () => {
    const track = vi.fn((payload: (props: { website: string }) => Record<string, unknown>) =>
      payload({ website: "site", url: "/portal/private-token", referrer: "/portal/private-token" } as { website: string }));
    vi.stubGlobal("window", { umami: { track } });
    trackEvent("owner_offer_published", undefined, "/offers");
    expect(track.mock.results[0].value).toEqual({
      website: "site", url: "/offers", title: "Offers", name: "owner_offer_published", data: undefined,
    });
  });
});