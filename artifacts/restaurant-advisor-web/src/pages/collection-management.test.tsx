// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CollectionManagementPage from "./collection-management";

const { auth, clerk } = vi.hoisted(() => ({
  auth: { isLoaded: true, isSignedIn: false, getToken: async () => null },
  clerk: { openSignIn: () => {} },
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => auth,
  useClerk: () => clerk,
}));
vi.mock("react-router-dom", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) =>
    <a href={to} {...props}>{children}</a>,
}));

const original = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Original story", description: "Original description", city: "Paris",
  version: 1, updatedAt: "2026-09-28T10:00:00Z", curatorUserId: "curator",
  restaurants: [{ id: "place-1", name: "First restaurant", city: "Paris" }],
};
const latest = { ...original, version: 2, title: "Admin story", description: "Admin description" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps a stale draft through conflict refresh, then requires a deliberate choice before saving", async () => {
  const requests: Array<{ url: string; options: RequestInit }> = [];
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
    requests.push({ url, options });
    let status = 200;
    let payload: object = { success: true, data: [] };
    if (url === "/api/collections/manage") {
      payload = { success: true, data: [++reads === 1 ? original : latest] };
    } else if (url === "/api/cities") {
      payload = { success: true, data: [{ city: "Paris", slug: "paris", count: 1 }] };
    } else if (url.includes("/restaurants?")) {
      payload = { success: true, data: original.restaurants };
    } else if (options.method === "PATCH") {
      if (requests.filter((request) => request.options.method === "PATCH").length === 1) {
        status = 409;
        payload = { success: false, code: "COLLECTION_CONFLICT", error: "Changed" };
      } else {
        payload = { success: true, data: { ...latest, title: "My draft", description: "My words", version: 3 } };
      }
    }
    return { status, ok: status < 400, json: async () => payload };
  }));
  render(<CollectionManagementPage />);
  const title = await screen.findByTestId("input-collection-title") as HTMLInputElement;
  await waitFor(() => expect(title.value).toBe("Original story"));
  fireEvent.change(title, { target: { value: "My draft" } });
  fireEvent.change(screen.getByTestId("input-collection-description"), { target: { value: "My words" } });
  fireEvent.click(screen.getByTestId("button-save-collection"));
  await screen.findByTestId("status-collection-conflict");
  await waitFor(() => expect(reads).toBe(2));
  expect(title.value).toBe("My draft");
  expect((screen.getByTestId("input-collection-description") as HTMLTextAreaElement).value).toBe("My words");
  expect(screen.getByTestId("status-collection-conflict").textContent).toContain("Admin story");
  expect((screen.getByTestId("button-save-collection") as HTMLButtonElement).disabled).toBe(true);
  expect(JSON.parse(requests.find((request) => request.options.method === "PATCH")!.options.body as string).version).toBe(1);
  fireEvent.click(screen.getByTestId("button-keep-draft"));
  expect(title.value).toBe("My draft");
  fireEvent.click(screen.getByTestId("button-save-collection"));
  await waitFor(() => expect(requests.filter((request) => request.options.method === "PATCH")).toHaveLength(2));
  expect(JSON.parse(requests.filter((request) => request.options.method === "PATCH")[1].options.body as string).version).toBe(2);
});

it("cannot discard the draft using stale data while the conflict refresh is pending", async () => {
  let releaseRefresh: ((value: object) => void) | undefined;
  const pendingRefresh = new Promise<object>((resolve) => { releaseRefresh = resolve; });
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
    if (url === "/api/collections/manage") {
      if (++reads === 2) return pendingRefresh;
      return { status: 200, ok: true, json: async () => ({ success: true, data: [original] }) };
    }
    if (options.method === "PATCH") {
      return { status: 409, ok: false, json: async () => ({ success: false, error: "Changed" }) };
    }
    return { status: 200, ok: true, json: async () =>
      ({ success: true, data: url === "/api/cities" ? [{ city: "Paris", slug: "paris", count: 1 }] : original.restaurants }) };
  }));
  render(<CollectionManagementPage />);
  const title = await screen.findByTestId("input-collection-title") as HTMLInputElement;
  await waitFor(() => expect(title.value).toBe("Original story"));
  fireEvent.change(title, { target: { value: "My unfinished story" } });
  fireEvent.click(screen.getByTestId("button-save-collection"));
  await screen.findByTestId("status-collection-conflict");
  expect(reads).toBe(2);
  expect(screen.queryByTestId("button-use-latest")).toBeNull();
  expect(screen.queryByTestId("button-keep-draft")).toBeNull();
  expect(title.value).toBe("My unfinished story");
  releaseRefresh!({ status: 200, ok: true, json: async () => ({ success: true, data: [latest] }) });
  await screen.findByTestId("button-use-latest");
  expect(title.value).toBe("My unfinished story");
  fireEvent.click(screen.getByTestId("button-use-latest"));
  expect(title.value).toBe("Admin story");
});