// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BookingLinkManager, type Booking } from "./BookingLinkManager";
import { trackEvent } from "../../lib/analytics";

vi.mock("../../lib/analytics", () => ({ trackEvent: vi.fn() }));

const existing: Booking = { url: "https://old.example/table", provider: "Old provider", status: "approved" };
const empty: Booking = { url: null, provider: null, status: null };

function setup(booking = existing) {
  const onChange = vi.fn();
  render(<BookingLinkManager restaurantId="place/1" restaurantName="The Bistro" booking={booking} onChange={onChange} />);
  return onChange;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(trackEvent).mockClear();
});

it("shows the current booking and publishes a verified replacement through the admin endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ success: true, booking: { url: "https://new.example/table", provider: "New provider", status: "approved" } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const onChange = setup();
  expect(screen.getByText(/Provider: Old provider · Approval: approved/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Booking URL"), { target: { value: "https://new.example/table" } });
  fireEvent.change(screen.getByLabelText("Provider (optional)"), { target: { value: "New provider" } });
  fireEvent.click(screen.getByRole("button", { name: "Check and publish" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ url: "https://new.example/table", provider: "New provider", status: "approved" }));
  expect(fetchMock).toHaveBeenCalledWith("/api/admin/restaurants/place%2F1/booking", expect.objectContaining({
    method: "PUT", credentials: "include", body: JSON.stringify({ url: "https://new.example/table", provider: "New provider" }),
  }));
  expect(screen.getByRole("status").textContent).toMatch(/published/);
  expect(trackEvent).toHaveBeenCalledExactlyOnceWith("booking_link_published", { has_provider_label: true }, "/booking");
});

it("rejects invalid input without calling the server and reports server validation errors", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ success: false, error: "Booking page unavailable." }) });
  vi.stubGlobal("fetch", fetchMock);
  setup(empty);
  fireEvent.change(screen.getByLabelText("Booking URL"), { target: { value: "http://example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Check and publish" }));
  expect(screen.getByRole("alert").textContent).toMatch(/HTTPS/);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Booking URL"), { target: { value: "https://example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Check and publish" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Booking page unavailable.");
  expect(trackEvent).not.toHaveBeenCalled();
});

it("requires confirmation before withdrawing and reports success", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", confirm);
  const onChange = setup();
  fireEvent.click(screen.getByRole("button", { name: "Withdraw link" }));
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Withdraw link" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(empty));
  expect(fetchMock).toHaveBeenCalledWith("/api/admin/restaurants/place%2F1/booking", {
    method: "DELETE", credentials: "include",
  });
  expect(screen.getByRole("status").textContent).toMatch(/withdrawn/);
  expect(trackEvent).toHaveBeenCalledExactlyOnceWith("booking_link_withdrawn", undefined, "/booking");
});

it("does not count failed withdrawals", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Could not withdraw." }) }));
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Withdraw link" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Could not withdraw.");
  expect(trackEvent).not.toHaveBeenCalled();
});