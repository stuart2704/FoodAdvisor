// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PostQueue } from "./PostQueue";
import { fetchSocial } from "./api";

vi.mock("./api", () => ({ fetchSocial: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.mocked(fetchSocial).mockReset();
});

it("shows the message box immediately and saves exact text without publishing", async () => {
  const message = "Welcome to The Food Advisor please check our new website at www.thefoodadvisor.co.uk coming soon the Food Advisor app we will keep you updated";
  const calls: Array<{ path: string; options?: RequestInit }> = [];
  let saved = false;
  vi.mocked(fetchSocial).mockImplementation(async (path, options) => {
    calls.push({ path, options });
    if (path === "/accounts") return { accounts: [{
      id: "11111111-1111-4111-8111-111111111111",
      restaurantId: null, platform: "facebook", status: "connected", displayName: "The Food Advisor",
    }] } as never;
    if (path === "/posts/draft") {
      saved = true;
      return { post: { id: "post-1" } } as never;
    }
    if (path === "/posts") return { posts: saved ? [{
      id: "post-1", restaurantId: null, platform: "facebook", content: message, status: "draft",
    }] : [] } as never;
    throw new Error(`Unexpected request: ${path}`);
  });

  render(<PostQueue />);
  const textBox = screen.getByLabelText("Your message");
  expect(textBox).toBeTruthy();
  expect(screen.getByText("Write a Facebook post")).toBeTruthy();
  await screen.findByText("The Food Advisor");
  fireEvent.change(textBox, { target: { value: message } });
  fireEvent.click(screen.getByRole("button", { name: "Save Draft (does not publish)" }));

  await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
  expect(calls.find(call => call.path === "/posts/draft")?.options?.body).toBe(JSON.stringify({
    accountId: "11111111-1111-4111-8111-111111111111", content: message,
  }));
  expect(calls.some(call => call.path === "/posts/publish")).toBe(false);
});