// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CollectionManagementPage from "./collection-management";

const { auth, openSignIn } = vi.hoisted(() => ({
  auth: { isLoaded: true, isSignedIn: true, getToken: vi.fn(async () => "curator-token") },
  openSignIn: vi.fn(),
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => auth,
  useClerk: () => ({ openSignIn }),
}));
vi.mock("react-router-dom", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) =>
    <a href={to} {...props}>{children}</a>,
}));

const mine = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Paris evenings", description: "A Paris story", city: "Paris",
  version: 1, updatedAt: "2026-09-28T10:00:00Z", curatorUserId: "curator",
  restaurants: [
    { id: "place-1", name: "First restaurant", city: "Paris" },
    { id: "place-2", name: "Second restaurant", city: "Paris" },
  ],
};
const another = {
  ...mine, id: "22222222-2222-4222-8222-222222222222",
  title: "Berlin mornings", description: "A Berlin story", city: "Berlin",
  curatorUserId: "another-curator",
  restaurants: [{ id: "place-3", name: "Third restaurant", city: "Berlin" }],
};
const cities = [
  { city: "Paris", slug: "paris", count: 2 },
  { city: "Berlin", slug: "berlin", count: 1 },
];
const berlinRestaurants = [{ id: "place-3", name: "Third restaurant", city: "Berlin" }];
const reply = (data: unknown, status = 200) => ({
  ok: status < 400, status, json: async () => ({ success: status < 400, data, error: status < 400 ? undefined : data }),
});

function stubEditor(
  manage: (read: number) => object[] = () => [mine],
  mutation?: (url: string, options: RequestInit) => object,
) {
  let reads = 0;
  const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
    if (url === "/api/collections/manage") return reply(manage(++reads));
    if (url === "/api/cities") return reply(cities);
    if (url === "/api/collections/manage/restaurants?city=Paris") return reply(mine.restaurants);
    if (url === "/api/collections/manage/restaurants?city=Berlin") return reply(berlinRestaurants);
    if (mutation) return mutation(url, options);
    throw new Error(`Unexpected request: ${options.method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  auth.isSignedIn = true;
  auth.getToken.mockClear();
  openSignIn.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([
  { role: "curator", visible: [mine], hidden: another, signedIn: true },
  { role: "administrator", visible: [mine, another], hidden: null, signedIn: false },
])("shows the server-scoped $role management list", async ({ visible, hidden, signedIn }) => {
  auth.isSignedIn = signedIn;
  const fetchMock = stubEditor(() => visible);
  render(<CollectionManagementPage />);
  expect(await screen.findByTestId(`text-collection-title-${mine.id}`)).toHaveProperty("textContent", mine.title);
  if (hidden) expect(screen.queryByTestId(`button-select-collection-${hidden.id}`)).toBeNull();
  else {
    fireEvent.click(screen.getByTestId(`button-select-collection-${another.id}`));
    expect(screen.getByTestId("input-collection-title")).toHaveProperty("value", another.title);
  }
  expect(fetchMock).toHaveBeenCalledWith("/api/collections/manage", expect.objectContaining({
    credentials: "include", cache: "no-store",
    headers: expect.any(Headers),
  }));
  const headers = fetchMock.mock.calls.find(([url]) => url === "/api/collections/manage")![1].headers as Headers;
  expect(headers.get("Authorization")).toBe(signedIn ? "Bearer curator-token" : null);
});

it.each([401, 403])("denies access on %i without exposing the editor and offers recovery", async (status) => {
  auth.isSignedIn = false;
  let reads = 0;
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/cities") return reply(cities);
    if (url === "/api/collections/manage") return ++reads === 1 ? reply("Access denied", status) : reply([mine]);
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<CollectionManagementPage />);
  expect(await screen.findByRole("heading", { name: "This desk is for curators." })).toBeTruthy();
  expect(screen.queryByTestId("input-collection-title")).toBeNull();
  expect(screen.queryByTestId(`button-select-collection-${mine.id}`)).toBeNull();
  expect(screen.getByTestId("link-admin-login").getAttribute("href")).toBe("/admin/login");
  fireEvent.click(screen.getByTestId("button-curator-sign-in"));
  expect(openSignIn).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByTestId("button-retry-access"));
  expect(await screen.findByTestId(`text-collection-title-${mine.id}`)).toBeTruthy();
  expect(reads).toBe(2);
});

it("clears the old city lineup, fetches new choices, and saves the new city with its lineup", async () => {
  const fetchMock = stubEditor(undefined, (url, options) => {
    expect(url).toBe(`/api/collections/${mine.id}`);
    expect(options.method).toBe("PATCH");
    return reply({ ...mine, city: "Berlin", version: 2, restaurants: berlinRestaurants });
  });
  render(<CollectionManagementPage />);
  await screen.findByTestId("row-selected-restaurant-place-1");
  fireEvent.change(screen.getByTestId("select-collection-city"), { target: { value: "Berlin" } });
  expect(screen.getByTestId("status-city-change").textContent).toContain("clears");
  expect(screen.queryByTestId("row-selected-restaurant-place-1")).toBeNull();
  expect(screen.queryByTestId("row-selected-restaurant-place-2")).toBeNull();
  expect((screen.getByTestId("button-save-lineup") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(await screen.findByTestId("button-add-restaurant-place-3"));
  fireEvent.click(screen.getByTestId("button-save-collection"));
  await waitFor(() => expect(screen.getByTestId("status-collection-feedback").textContent).toContain("City and its new restaurant lineup saved"));
  const patch = fetchMock.mock.calls.find(([, options]) => options.method === "PATCH")!;
  expect(JSON.parse(patch[1].body as string)).toEqual({
    title: mine.title, description: mine.description, city: "Berlin", version: 1, restaurantIds: ["place-3"],
  });
  expect(screen.getByTestId("row-selected-restaurant-place-3")).toBeTruthy();
});

it("reports failed order saves, then shows saved order and refreshes server changes", async () => {
  let attempts = 0;
  const reordered = { ...mine, version: 2, restaurants: [...mine.restaurants].reverse() };
  const refreshed = { ...reordered, version: 3, title: "Updated elsewhere" };
  const fetchMock = stubEditor((read) => read === 1 ? [mine] : [refreshed], (url, options) => {
    expect(url).toBe(`/api/collections/${mine.id}/restaurants`);
    expect(options.method).toBe("PUT");
    return ++attempts === 1 ? reply("Order could not be saved", 503) : reply(reordered);
  });
  render(<CollectionManagementPage />);
  await screen.findByTestId("row-selected-restaurant-place-2");
  fireEvent.click(screen.getByTestId("button-move-up-place-2"));
  const selectedNames = () => within(screen.getByText("Selected places").closest(".cm-lineup-box")!)
    .getAllByRole("listitem").map((row) => row.querySelector("strong")?.textContent);
  expect(selectedNames()).toEqual(["Second restaurant", "First restaurant"]);
  fireEvent.click(screen.getByTestId("button-save-lineup"));
  expect((await screen.findByTestId("status-lineup-feedback")).textContent).toContain("Order could not be saved");
  expect((screen.getByTestId("button-save-lineup") as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByTestId("button-save-lineup"));
  await waitFor(() => expect(screen.getByTestId("status-lineup-feedback").textContent).toContain("Restaurant selection and order saved"));
  expect((screen.getByTestId("button-save-lineup") as HTMLButtonElement).disabled).toBe(true);
  const puts = fetchMock.mock.calls.filter(([, options]) => options.method === "PUT");
  expect(puts).toHaveLength(2);
  expect(JSON.parse(puts[1][1].body as string)).toEqual({ restaurantIds: ["place-2", "place-1"], version: 1 });
  fireEvent.click(screen.getByTestId("button-refresh-collections"));
  await waitFor(() => expect(screen.getByTestId("input-collection-title")).toHaveProperty("value", refreshed.title));
  expect(selectedNames()).toEqual(["Second restaurant", "First restaurant"]);
  expect(screen.queryByTestId("status-lineup-feedback")).toBeNull();
});

it("requires deletion confirmation, then removes only the chosen collection and selects the remaining one", async () => {
  const fetchMock = stubEditor(() => [mine, another], (url, options) => {
    expect(url).toBe(`/api/collections/${mine.id}`);
    expect(options.method).toBe("DELETE");
    return { ok: true, status: 204, json: async () => { throw new Error("204 has no body"); } };
  });
  render(<CollectionManagementPage />);
  await screen.findByTestId(`button-select-collection-${another.id}`);
  fireEvent.click(screen.getByTestId("button-delete-collection"));
  expect(screen.getByRole("alertdialog").textContent).toContain(mine.title);
  expect(fetchMock.mock.calls.filter(([, options]) => options.method === "DELETE")).toHaveLength(0);
  fireEvent.click(screen.getByTestId("button-cancel-delete"));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByTestId("button-delete-collection"));
  fireEvent.click(screen.getByTestId("button-confirm-delete"));
  await waitFor(() => expect(screen.queryByTestId(`button-select-collection-${mine.id}`)).toBeNull());
  expect(screen.getByTestId("input-collection-title")).toHaveProperty("value", another.title);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  const deletes = fetchMock.mock.calls.filter(([, options]) => options.method === "DELETE");
  expect(deletes).toHaveLength(1);
  expect(JSON.parse(deletes[0][1].body as string)).toEqual({ version: 1 });
});