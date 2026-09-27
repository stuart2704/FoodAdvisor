// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import RestaurantCard from "./RestaurantCard";
import RestaurantDetail from "./RestaurantDetail";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("does not request an offscreen card photo until it enters view", async () => {
  let onIntersection: IntersectionObserverCallback = () => {};
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { onIntersection = callback; }
    observe() {}
    disconnect() {}
  });
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ url: "https://images.example/photo", attribution: [] }),
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MemoryRouter><RestaurantCard id="place-1" name="Cafe" city="London" cuisine="Cafe" /></MemoryRouter>);
  expect(fetchMock).not.toHaveBeenCalled();
  onIntersection([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock.mock.calls[0][0]).toBe("/api/photo/place-1");
});

it("loads only one detail photo until the diner opens the gallery", async () => {
  const fetchMock = vi.fn((url: string) => Promise.resolve({
    ok: true,
    json: async () => url.startsWith("/api/restaurant/")
      ? { id: "place-2", name: "Cafe", city: "London" }
      : url.startsWith("/api/photo/")
        ? { url: "https://images.example/photo", attribution: [{ displayName: "Author", uri: null }] }
        : url.startsWith("/api/photos/")
          ? { photos: [{ url: "https://images.example/photo", attribution: [] }] }
          : { reviews: [], hours: [] },
  }));
  vi.stubGlobal("fetch", fetchMock);
  render(<MemoryRouter initialEntries={["/restaurant/place-2"]}>
    <Routes><Route path="/restaurant/:id" element={<RestaurantDetail />} /></Routes>
  </MemoryRouter>);
  await screen.findByRole("button", { name: "View more photos" });
  expect(fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/photos/"))).toHaveLength(0);
  expect(screen.getByText("Photo:")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View more photos" }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/photos/"))).toHaveLength(1));
});