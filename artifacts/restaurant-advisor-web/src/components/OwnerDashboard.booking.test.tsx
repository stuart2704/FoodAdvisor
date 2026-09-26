// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import OwnerDashboard from "./OwnerDashboard";
import { trackEvent } from "../lib/analytics";

vi.mock("../lib/analytics", () => ({ trackEvent: vi.fn() }));

const published = { url: "https://bookings.example/table", provider: "Table service" };
type MockResponse = { ok: boolean; json: () => Promise<unknown> };

function setup(booking = published) {
  const fetchMock = vi.fn(async (input: string, options?: RequestInit): Promise<MockResponse> => {
    if (input.endsWith("/booking")) {
      if (options?.method === "PUT" || options?.method === "DELETE") {
        return { ok: true, json: async () => ({ booking: published }) };
      }
      return { ok: true, json: async () => ({ booking }) };
    }
    if (input.endsWith("/offers")) return { ok: true, json: async () => ({ offers: [] }) };
    if (input.endsWith("/events")) return { ok: true, json: async () => ({ events: [] }) };
    return { ok: true, json: async () => ({ chef: {} }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<OwnerDashboard token="private-token" restaurantName="The Bistro" verified />);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(trackEvent).mockClear();
});

it("counts only successful owner publications", async () => {
  const fetchMock = setup({ url: "", provider: "" });
  const input = await screen.findByLabelText("Booking URL");
  fireEvent.change(input, { target: { value: published.url } });
  fireEvent.change(screen.getByLabelText("Provider (optional)"), { target: { value: published.provider } });
  fireEvent.click(screen.getByRole("button", { name: "Check and publish" }));
  await waitFor(() => expect(trackEvent).toHaveBeenCalledExactlyOnceWith(
    "booking_link_published", { has_provider_label: true }, "/booking",
  ));

  fetchMock.mockImplementation(async (input: string, options?: RequestInit) => {
    if (input.endsWith("/booking") && options?.method === "PUT") {
      return { ok: false, json: async () => ({ error: "Not approved." }) };
    }
    return { ok: true, json: async () => ({ booking: published }) };
  });
  fireEvent.click(screen.getByRole("button", { name: "Check and publish" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Not approved.");
  expect(trackEvent).toHaveBeenCalledTimes(1);
});

it("counts only successful owner withdrawals", async () => {
  const fetchMock = setup();
  await screen.findByRole("button", { name: "Remove booking link" });
  fireEvent.click(screen.getByRole("button", { name: "Remove booking link" }));
  await waitFor(() => expect(trackEvent).toHaveBeenCalledExactlyOnceWith(
    "booking_link_withdrawn", undefined, "/booking",
  ));

  cleanup();
  vi.mocked(trackEvent).mockClear();
  fetchMock.mockImplementation(async (input: string, options?: RequestInit) => {
    if (input.endsWith("/booking") && options?.method === "DELETE") {
      return { ok: false, json: async () => ({ error: "Could not remove." }) };
    }
    if (input.endsWith("/booking")) return { ok: true, json: async () => ({ booking: published }) };
    if (input.endsWith("/offers")) return { ok: true, json: async () => ({ offers: [] }) };
    if (input.endsWith("/events")) return { ok: true, json: async () => ({ events: [] }) };
    return { ok: true, json: async () => ({ chef: {} }) };
  });
  render(<OwnerDashboard token="private-token" restaurantName="The Bistro" verified />);
  await screen.findByRole("button", { name: "Remove booking link" });
  fireEvent.click(screen.getByRole("button", { name: "Remove booking link" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Could not remove.");
  expect(trackEvent).not.toHaveBeenCalled();
});