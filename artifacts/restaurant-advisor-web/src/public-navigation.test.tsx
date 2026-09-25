// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "./App";

const publicPages = [
  { path: "/restaurants", label: "Restaurants", heading: "Restaurants" },
  { path: "/about", label: "About", heading: "Helping good restaurants get discovered" },
  { path: "/contact", label: "Contact", heading: "How can we help?" }
] as const;

const navigationTargets = {
  Restaurants: "/restaurants",
  Trending: "/trending",
  "City Food Guide": "/city-guide",
  Rewards: "/rewards",
  "Own a Restaurant? Start Here": "/owner/",
  About: "/about",
  Contact: "/contact"
};

beforeEach(() => {
  window.scrollTo = vi.fn();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve([])
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("public navigation", () => {
  for (const { path, label, heading } of publicPages) {
    it(`renders ${label} from a direct visit to ${path}`, () => {
      window.history.replaceState({}, "", path);
      render(<App />);
      expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy();
    });
  }

  it("offers valid destinations in the desktop navigation", () => {
    window.history.replaceState({}, "", "/about");
    render(<App />);
    const desktop = document.querySelector(".desktop-menu");
    expect(desktop).not.toBeNull();
    for (const [label, path] of Object.entries(navigationTargets)) {
      expect(within(desktop as HTMLElement).getByRole("link", { name: label }).getAttribute("href")).toBe(path);
    }
    fireEvent.click(within(desktop as HTMLElement).getByRole("link", { name: "Contact" }));
    expect(screen.getByRole("heading", { level: 1, name: "How can we help?" })).toBeTruthy();
  });

  it("offers valid destinations in the mobile menu and closes after navigation", () => {
    window.history.replaceState({}, "", "/about");
    render(<App />);
    // jsdom does not evaluate media queries, so the mobile-only toggle is CSS-hidden here.
    const toggle = document.querySelector<HTMLButtonElement>(".hamburger");
    expect(toggle?.getAttribute("aria-label")).toBe("Open navigation menu");
    fireEvent.click(toggle as HTMLButtonElement);
    const mobile = document.getElementById("mobile-navigation");
    expect(mobile).not.toBeNull();
    for (const [label, path] of Object.entries(navigationTargets)) {
      const link = [...(mobile as HTMLElement).querySelectorAll("a")].find((anchor) => anchor.textContent === label);
      expect(link?.getAttribute("href")).toBe(path);
    }
    fireEvent.click((mobile as HTMLElement).querySelector('a[href="/restaurants"]') as HTMLAnchorElement);
    expect(screen.getByRole("heading", { level: 1, name: "Restaurants" })).toBeTruthy();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("mobile-navigation")).toBeNull();
  });
});