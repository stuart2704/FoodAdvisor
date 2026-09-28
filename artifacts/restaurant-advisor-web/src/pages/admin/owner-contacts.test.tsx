// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import AdminOwnerContacts from "./owner-contacts";

const id = "00000000-0000-4000-8000-000000000001";
const summary = {
  id, placeId: "place-1", firstName: "Jane", lastName: "Owner",
  company: "Example Bistro", status: "polling", createdAt: "2026-09-28T12:00:00Z",
};
const budget = {
  enabled: true, period: "2026-09", configuredCap: 1, effectiveCap: 1,
  reservedCredits: 0, consumedCredits: 0, availableCredits: 1,
};
const review = (status: string) => ({
  job: { ...summary, status, companyDomain: "example.test",
    personSource: "Reviewed business filing", budgetPeriod: "2026-09",
    reservedCredits: 1, contextHash: "a".repeat(64),
    providerRequestId: null, lastError: null },
  privateReviewContact: status === "completed" ? {
    email: "jane@example.test", providerEmailStatus: "deliverable",
    reviewOnly: true, outreachEligible: false,
  } : null,
});
const json = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data }) });
function page() {
  return render(<MemoryRouter><AdminOwnerContacts /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("does not load private data or show the reservation form to an unauthenticated visitor", async () => {
  const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ authenticated: false }) }));
  vi.stubGlobal("fetch", fetchMock);
  page();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock.mock.calls[0][0]).toBe("/auth/session");
  expect(screen.queryByRole("heading", { name: "Owner contacts" })).toBeNull();
  expect(screen.queryByTestId("button-request-contact")).toBeNull();
});

it("shows the one-credit budget and revisits pending then completed private reviews after reload", async () => {
  let status = "polling";
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/auth/session") return { ok: true, json: async () => ({ authenticated: true }) };
    if (url === "/api/private-contact-enrichments/budget") return json(budget);
    if (url === "/api/private-contact-enrichments") return json([{ ...summary, status }]);
    if (url === `/api/private-contact-enrichments/${id}`) return json(review(status));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const first = page();
  expect(await screen.findByTestId("text-contact-budget")).toHaveProperty(
    "textContent",
    "2026-09 · Configured cap: 1 · Effective cap: 1 · Reserved: 0 · Consumed: 0 · Available: 1",
  );
  expect(screen.getByTestId("button-request-contact")).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByTestId(`button-review-contact-${id}`));
  expect(await screen.findByTestId("status-contact-job")).toHaveProperty(
    "textContent", "Status: Waiting for provider",
  );
  first.unmount();

  // New mount represents a page reload: the recent-job list, not local state,
  // allows the admin to open an already-created request.
  let poll: (() => void) | undefined;
  const originalInterval = window.setInterval;
  vi.spyOn(window, "setInterval").mockImplementation((handler, timeout, ...args) => {
    if (timeout === 10_000) {
      poll = handler as () => void;
      return originalInterval(handler, 60_000, ...args) as unknown as NodeJS.Timeout;
    }
    return originalInterval(handler, timeout, ...args) as unknown as NodeJS.Timeout;
  });
  const second = page();
  fireEvent.click(await screen.findByTestId(`button-review-contact-${id}`));
  expect(await screen.findByTestId("status-contact-job")).toHaveProperty(
    "textContent", "Status: Waiting for provider",
  );

  status = "completed";
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(poll).toBeDefined();
  await act(async () => { poll?.(); });
  expect(screen.getByTestId("status-contact-job")).toHaveProperty("textContent", "Status: Completed");
  expect(screen.getByTestId("status-contact-deliverability")).toHaveProperty(
    "textContent", "Provider-verified deliverability: deliverable",
  );
  expect(screen.getByText(/Ownership:/).parentElement).toHaveProperty(
    "textContent", "Ownership: Not verified. Deliverability and a name match do not establish that this person owns the restaurant.",
  );
  expect(screen.getByText(/Review only · Not eligible for automatic outreach/)).toBeTruthy();
  const detailCalls = () => fetchMock.mock.calls.filter(([url]) =>
    url === `/api/private-contact-enrichments/${id}`).length;
  const completedCount = detailCalls();
  await act(async () => { poll?.(); poll?.(); });
  expect(detailCalls()).toBe(completedCount);
  second.unmount();

  const third = page();
  fireEvent.click(await screen.findByTestId(`button-review-contact-${id}`));
  expect(await screen.findByTestId("status-contact-job")).toHaveProperty("textContent", "Status: Completed");
  const reloadCount = detailCalls();
  await act(async () => { poll?.(); poll?.(); });
  expect(detailCalls()).toBe(reloadCount);
  third.unmount();
});

it("requires an audit note and explicit confirmation before correcting an attached provider ID", async () => {
  let providerRequestId = "wrong-1";
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/auth/session") return { ok: true, json: async () => ({ authenticated: true }) };
    if (url === "/api/private-contact-enrichments/budget") return json(budget);
    if (url === "/api/private-contact-enrichments") return json([{ ...summary, status: "timed_out" }]);
    if (url === `/api/private-contact-enrichments/${id}`)
      return json({ ...review("timed_out"), job: { ...review("timed_out").job, providerRequestId } });
    if (url === `/api/private-contact-enrichments/${id}/correct-request-id`) {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        oldProviderRequestId: "wrong-1", newProviderRequestId: "right-2",
        evidenceNote: "Reviewed both terminated identity records.",
        confirmedCorrection: true,
      });
      providerRequestId = "right-2";
      return json({ id, status: "polling", providerRequestId });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  page();
  fireEvent.click(await screen.findByTestId(`button-review-contact-${id}`));
  const button = await screen.findByRole("button", { name: "Verify evidence and correct ID" });
  expect(button).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Replacement provider request ID"), { target: { value: "right-2" } });
  fireEvent.change(screen.getByLabelText("Why the old ID is wrong and how the new ID was verified (audit note)"),
    { target: { value: "Reviewed both terminated identity records." } });
  expect(button).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByLabelText(/I reviewed both provider records/));
  expect(button).toHaveProperty("disabled", false);
  fireEvent.click(button);
  expect(await screen.findByText(/Provider evidence confirmed the correction/)).toBeTruthy();
  expect(screen.getAllByText("right-2")).toHaveLength(2);
  expect(fetchMock.mock.calls.filter(([url]) => url === `/api/private-contact-enrichments/${id}/correct-request-id`)).toHaveLength(1);
});