// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import RestaurantDetail from "./RestaurantDetail";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("tracks a calendar click without changing the download when analytics is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
    ok: true,
    json: async () => url.startsWith("/api/restaurant/")
      ? {
          id: "place-1", name: "Cafe", city: "London",
          events: [{ id: 12, title: "Live music", description: "", date: "2026-10-01", time: "19:00", price: "Free" }],
        }
      : { reviews: [], hours: [] },
  })));
  const track = vi.fn(() => { throw new Error("tracker unavailable"); });
  Object.defineProperty(window, "umami", { configurable: true, value: { track } });
  render(
    <MemoryRouter initialEntries={["/restaurant/place-1"]}>
      <Routes><Route path="/restaurant/:id" element={<RestaurantDetail />} /></Routes>
    </MemoryRouter>,
  );
  const link = await screen.findByRole("link", { name: "Add Live music to calendar" });
  expect(link.getAttribute("href")).toBe("/api/restaurant/place-1/events/12/calendar");
  expect(link.hasAttribute("download")).toBe(true);
  expect(() => fireEvent.click(link)).not.toThrow();
  expect(track).toHaveBeenCalledOnce();
  expect(link.getAttribute("href")).toBe("/api/restaurant/place-1/events/12/calendar");
});