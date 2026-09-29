// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/admin/RequireAdmin", () => ({
  RequireAdmin: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AdminOutreach from "./outreach";

const researchItem = {
  placeId: "place-123",
  name: "Example Restaurant",
  city: "Springfield",
  website: "https://example.test",
  status: "no_business_email",
  reason: "No qualifying business email found on the website.",
  checkedAt: "2026-03-10T10:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("filters, rechecks without sending outreach, and refreshes the research list", async () => {
  let researchLoads = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/dashboard/outreach/research?")) {
      researchLoads += 1;
      return {
        ok: true,
        json: async () => ({
          success: true,
          page: 1,
          limit: 50,
          total: 1,
          summary: { noBusinessEmail: 1, extractionFailed: 0 },
          items: [researchItem],
        }),
      };
    }
    if (url === "/dashboard/outreach/research/place-123/recheck") {
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("include");
      expect(init?.body).toBeUndefined();
      return {
        ok: true,
        json: async () => ({ success: true, status: "no_business_email", emailFound: false }),
      };
    }
    if (url === "/dashboard/outreach?page=1&limit=50") {
      return { ok: true, json: async () => ({ success: true, items: [] }) };
    }
    if (url === "/dashboard/outreach/summary") {
      return { ok: true, json: async () => ({ success: true, totalEvents: 0, sent: 0, failed: 0 }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<AdminOutreach />);
  expect(await screen.findByTestId("row-research-place-123")).toBeTruthy();
  expect(screen.getByTestId("link-research-website-place-123").getAttribute("href")).toBe(
    "https://example.test/",
  );
  expect(screen.getByText(/does not immediately send outreach or trigger a paid import/)).toBeTruthy();

  fireEvent.change(screen.getByTestId("select-research-status"), {
    target: { value: "extraction_failed" },
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("status=extraction_failed"),
    expect.objectContaining({ credentials: "include" }),
  ));

  fireEvent.click(screen.getByTestId("button-recheck-place-123"));
  expect(await screen.findByTestId("status-recheck-place-123")).toHaveProperty(
    "textContent",
    "Recheck complete (no_business_email): no qualifying business email found.",
  );
  await waitFor(() => expect(researchLoads).toBeGreaterThanOrEqual(3));
});

it("captures all pages before sequential bulk rechecks and reports partial failures", async () => {
  const items = Array.from({ length: 50 }, (_, index) => ({
    ...researchItem,
    placeId: `place-${index + 1}`,
    name: `Restaurant ${index + 1}`,
  }));
  const lastItem = { ...researchItem, placeId: "place-51", name: "Restaurant 51" };
  const postOrder: string[] = [];
  let activePosts = 0;
  let maxActivePosts = 0;
  let releaseFirstPost: (() => void) | undefined;
  let markFirstPostStarted: (() => void) | undefined;
  const firstPostStarted = new Promise<void>((resolve) => {
    markFirstPostStarted = resolve;
  });
  const firstPostGate = new Promise<void>((resolve) => {
    releaseFirstPost = resolve;
  });
  const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/dashboard/outreach/research?")) {
      const query = new URL(url, "https://local.test").searchParams;
      const page = Number(query.get("page"));
      return {
        ok: true,
        json: async () => ({
          success: true,
          page,
          limit: 50,
          total: 51,
          summary: { noBusinessEmail: 51, extractionFailed: 0 },
          items: page === 1 ? items : [lastItem],
        }),
      };
    }
    if (url.startsWith("/dashboard/outreach/research/") && url.endsWith("/recheck")) {
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("include");
      const placeId = decodeURIComponent(url.split("/").at(-2) ?? "");
      postOrder.push(placeId);
      activePosts += 1;
      maxActivePosts = Math.max(maxActivePosts, activePosts);
      if (placeId === "place-1") {
        markFirstPostStarted?.();
        await firstPostGate;
      }
      activePosts -= 1;
      return {
        ok: placeId !== "place-7",
        json: async () => placeId === "place-7"
          ? { success: false, error: "Research failed for this restaurant." }
          : { success: true, status: "no_business_email", emailFound: false },
      };
    }
    if (url === "/dashboard/outreach?page=1&limit=50") {
      return { ok: true, json: async () => ({ success: true, items: [] }) };
    }
    if (url === "/dashboard/outreach/summary") {
      return { ok: true, json: async () => ({ success: true, totalEvents: 0, sent: 0, failed: 0 }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<AdminOutreach />);
  expect(await screen.findByTestId("row-research-place-1")).toBeTruthy();
  fireEvent.click(screen.getByTestId("button-recheck-all"));

  expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining(
    "eligible for the already-enabled outreach scheduler and may send later",
  ));
  expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("sends no immediate email"));
  await firstPostStarted;
  expect(screen.getByTestId("button-recheck-place-1")).toHaveProperty("disabled", true);
  expect(fetchMock.mock.calls.some(([input]) =>
    String(input).includes("page=2") && String(input).includes("status=all"),
  )).toBe(true);

  await act(async () => { releaseFirstPost?.(); });
  expect(await screen.findByText(
    "Finished rechecking 51 restaurants from the initial snapshot; 1 partial failures.",
  )).toBeTruthy();
  expect(postOrder).toEqual([
    ...items.map(({ placeId }) => placeId),
    lastItem.placeId,
  ]);
  expect(maxActivePosts).toBe(1);
  expect(fetchMock.mock.calls.filter(([input]) =>
    String(input).startsWith("/dashboard/outreach/research/") &&
    String(input).endsWith("/recheck"),
  )).toHaveLength(51);
});