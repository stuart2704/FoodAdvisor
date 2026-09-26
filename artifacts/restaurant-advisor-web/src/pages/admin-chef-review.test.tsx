// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../components/admin/RequireAdmin", () => ({
  RequireAdmin: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import AdminChefReviewPage from "./admin-chef-review";

const pending = {
  restaurantId: "place-1",
  restaurantName: "Example Bistro",
  name: "A Chef",
  bio: "A biography",
  philosophy: "A philosophy",
  awards: ["An award"],
  awardEvidenceUrls: ["https://example.test/award"],
  signatureDishes: ["A dish"],
  dishEvidenceUrls: ["https://example.test/dish"],
  photoObjectPath: "/objects/chef/00000000-0000-0000-0000-000000000001",
  photoMimeType: "image/png",
  photoSizeBytes: 12,
  moderationStatus: "pending",
  rejectionReason: null,
  updatedAt: "2026-09-25T10:00:00.000Z",
};

function response(body: object, ok = true) {
  return { ok, json: async () => body };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(["approve", "reject", "remove"] as const)(
  "renders the API pending-list shape and sends %s to the matching moderation route",
  async (action) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ success: true, profiles: [pending] }))
      .mockResolvedValueOnce(response({ success: true, profile: { ...pending, moderationStatus: action } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<AdminChefReviewPage />);
    expect(await screen.findByRole("heading", { name: "A Chef" })).toBeTruthy();
    expect(screen.getByText("Example Bistro")).toBeTruthy();
    expect(screen.getByText("A biography")).toBeTruthy();
    expect(screen.getByText(/A philosophy/)).toBeTruthy();
    expect(screen.getByText(/A dish/)).toBeTruthy();
    expect(screen.getByText(/An award/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Evidence" })).toHaveLength(2);
    expect(document.querySelector("img")?.getAttribute("src"))
      .toBe("/api/admin/chef-profiles/place-1/photo");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/chef-profiles/pending", {
      credentials: "include", cache: "no-store",
    });

    fireEvent.click(screen.getByRole("button", { name: action[0].toUpperCase() + action.slice(1) }));
    await waitFor(() => expect(screen.getByText("No pending chef profiles.")).toBeTruthy());
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe(`/api/admin/chef-profiles/place-1${action === "remove" ? "" : `/${action}`}`);
    expect(options.method).toBe(action === "remove" ? "DELETE" : "POST");
    expect(options.credentials).toBe("include");
    if (action === "reject") {
      expect(JSON.parse(options.body)).toEqual({ reason: "Evidence requires additional verification." });
    }
  },
);

it("keeps the submission visible and reports a failed moderation response", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(response({ success: true, profiles: [pending] }))
    .mockResolvedValueOnce(response({ success: false, error: "Review failed" }, false)));
  render(<AdminChefReviewPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Review failed");
  expect(screen.getByRole("heading", { name: "A Chef" })).toBeTruthy();
});