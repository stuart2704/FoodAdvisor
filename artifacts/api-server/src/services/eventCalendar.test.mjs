import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const directory = await mkdtemp(path.join(os.tmpdir(), "event-calendar-"));
const output = path.join(directory, "calendar.mjs");
await build({
  entryPoints: [path.resolve(import.meta.dirname, "eventCalendar.ts")],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
});
const { eventCalendar } = await import(pathToFileURL(output).href);
test.after(async () => rm(directory, { recursive: true, force: true }));

test("calendar contains the public event and restaurant fields with a floating local start", () => {
  const calendar = eventCalendar(
    { id: "place/123", name: "Café, London" },
    { id: 17, title: "Jazz; Night", description: "Music\nDoors open, 7pm", date: "2026-10-15", time: "19:30", price: "£20" },
    "https://example.com/restaurant/place%2F123",
    new Date("2026-09-25T12:00:00Z"),
  );
  const unfolded = calendar.replace(/\r\n /g, "");
  assert.match(calendar, /^BEGIN:VCALENDAR\r\nVERSION:2.0\r\n/);
  assert.match(calendar, /\r\nDTSTART:20261015T193000\r\n/);
  assert.match(calendar, /\r\nDTSTAMP:20260925T120000Z\r\n/);
  assert.match(calendar, /SUMMARY:Jazz\\; Night — Café\\, London\r\n/);
  assert.match(unfolded, /DESCRIPTION:Music\\nDoors open\\, 7pm\\nRestaurant: Café\\, London\\nPrice: £20\\nProfile: https:\/\/example.com\/restaurant\/place%2F123/);
  assert.match(calendar, /URL:https:\/\/example.com\/restaurant\/place%2F123\r\n/);
  assert.match(calendar, /UID:17-[a-f0-9]+@food-advisor\r\n/);
  assert.match(calendar, /\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n$/);
  assert.equal(calendar.includes("DTEND:"), false);
});

test("calendar folds long Unicode lines without splitting UTF-8 characters or allowing injected properties", () => {
  const calendar = eventCalendar(
    { id: "one", name: "Bistro" },
    { id: 2, title: "Music", description: "é".repeat(100) + "\r\nBEGIN:VTODO", date: "2026-10-15", time: "09:00", price: "Free" },
    "https://example.com/restaurant/one",
  );
  assert.ok(calendar.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
  assert.match(calendar.replace(/\r\n /g, ""), /é{100}\\nBEGIN:VTODO/);
  assert.equal(calendar.includes("\r\nBEGIN:VTODO"), false);
});

test("invalid date and time cannot create a broken calendar entry", () => {
  assert.throws(() => eventCalendar(
    { id: "one", name: "Bistro" },
    { id: 2, title: "Music", description: "", date: "2026-10-15", time: "TBA", price: "Free" },
    "https://example.com/restaurant/one",
  ), /invalid/);
});