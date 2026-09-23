import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Bundle the actual implementation, replacing only DNS. Never contact real
// websites or rely on the machine's DNS configuration in this suite.
const directory = await mkdtemp(path.join(tmpdir(), "enrichment-tests-"));
const outfile = path.join(directory, "enrichment.mjs");
await build({
  stdin: {
    contents: 'export * from "./extractWebsiteData"; export * from "./validateEmail";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "offline-dns",
    setup(builder) {
      builder.onResolve({ filter: /^node:dns\/promises$/ }, () => ({
        path: "dns", namespace: "test",
      }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
        contents: "export const lookup = (...args) => globalThis.__enrichmentLookup(...args);",
      }));
    },
  }],
});
const { extractWebsiteData, validateEmail } = await import(pathToFileURL(outfile).href);
const url = "https://restaurant.example/";
const publicAddresses = [{ address: "93.184.216.34", family: 4 }];
let fetchMock;
let lookupMock;
const html = (body = "<title>Restaurant</title>", headers = {}) =>
  new Response(body, { headers: { "content-type": "text/html", ...headers } });
const failure = (result, code) => {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
  assert.equal(typeof result.error.message, "string");
  assert.ok(result.error.message.length > 0);
  assert.equal("data" in result, false);
};
beforeEach(() => {
  mock.restoreAll();
  lookupMock = mock.fn(async () => publicAddresses);
  globalThis.__enrichmentLookup = lookupMock;
  // Unexpected requests fail closed, rather than falling through to real fetch.
  fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected test request");
  });
});
after(async () => {
  mock.restoreAll();
  delete globalThis.__enrichmentLookup;
  await rm(directory, { recursive: true, force: true });
});

test("extracts metadata and the first approved role address, not personal mail", async () => {
  fetchMock.mock.mockImplementation(async () => html(`
    <title>  Dinner &amp; Drinks </title>
    <meta content="Fresh &amp; local" name="description">
    jane@restaurant.example noreply@restaurant.example
    bookings&commat;restaurant.example info@restaurant.example
  `));
  assert.deepEqual(await extractWebsiteData(url), {
    ok: true,
    data: {
      finalUrl: url, title: "Dinner & Drinks", description: "Fresh & local",
      roleEmail: "bookings@restaurant.example",
    },
  });
  const [target, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(target.href, url);
  assert.equal(options.redirect, "manual");
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(lookupMock.mock.calls[0].arguments,
    ["restaurant.example", { all: true, verbatim: true }]);
});

for (const [input, code] of [
  ["not a URL", "invalid_url"],
  ["file:///etc/passwd", "unsafe_url"],
  ["ftp://restaurant.example/", "unsafe_url"],
  ["https://user:pass@restaurant.example/", "unsafe_url"],
  ["http://restaurant.example:8080/", "unsafe_url"],
  ["https://restaurant.example:444/", "unsafe_url"],
  ["http://127.0.0.1/", "unsafe_url"],
  ["http://2130706433/", "unsafe_url"],
  ["http://0x7f000001/", "unsafe_url"],
  ["https://8.8.8.8/", "unsafe_url"],
]) {
  test(`rejects ${input} before DNS or fetch`, async () => {
    failure(await extractWebsiteData(input), code);
    assert.equal(lookupMock.mock.callCount(), 0);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
}

for (const address of [
  "0.0.0.0", "10.0.0.1", "127.0.0.1", "100.64.0.1", "169.254.169.254",
  "172.16.0.1", "172.31.255.255", "192.168.1.1", "192.0.0.1",
  "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1",
  "::", "::1", "fc00::1", "fd00::1", "fe80::1", "ff02::1",
  "2001:db8::1", "::ffff:127.0.0.1",
]) {
  test(`rejects DNS containing ${address}, even alongside a public address`, async () => {
    lookupMock.mock.mockImplementation(async () => [
      ...publicAddresses, { address, family: address.includes(":") ? 6 : 4 },
    ]);
    failure(await extractWebsiteData(url), "unsafe_url");
    assert.equal(fetchMock.mock.callCount(), 0);
  });
}

test("rejects empty DNS and reports failed DNS without fetching", async () => {
  lookupMock.mock.mockImplementation(async () => []);
  failure(await extractWebsiteData(url), "unsafe_url");
  lookupMock.mock.mockImplementation(async () => { throw new Error("ENOTFOUND"); });
  failure(await extractWebsiteData(url), "dns_failure");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("rechecks DNS immediately before fetching", async () => {
  lookupMock.mock.mockImplementationOnce(async () => publicAddresses);
  lookupMock.mock.mockImplementation(async () => [{ address: "10.0.0.1", family: 4 }]);
  failure(await extractWebsiteData(url), "unsafe_url");
  assert.equal(fetchMock.mock.callCount(), 0);
});

for (const status of [301, 302, 303, 307, 308]) {
  test(`follows relative ${status} redirects and cancels their body`, async () => {
    const redirect = new Response("redirect", { status, headers: { location: "/contact" } });
    const cancel = mock.method(redirect.body, "cancel");
    fetchMock.mock.mockImplementationOnce(async () => redirect);
    fetchMock.mock.mockImplementation(async () => html());
    const result = await extractWebsiteData(url);
    assert.equal(result.ok, true);
    assert.equal(result.data.finalUrl, `${url}contact`);
    assert.equal(cancel.mock.callCount(), 1);
    assert.equal(fetchMock.mock.callCount(), 2);
  });
}

test("never fetches a redirect target whose DNS is private", async () => {
  lookupMock.mock.mockImplementation(async (host) =>
    host === "internal.example" ? [{ address: "169.254.169.254", family: 4 }] : publicAddresses);
  fetchMock.mock.mockImplementation(async () =>
    new Response(null, { status: 302, headers: { location: "http://internal.example/" } }));
  failure(await extractWebsiteData(url), "unsafe_url");
  assert.equal(fetchMock.mock.callCount(), 1);
});

for (const target of ["http://127.0.0.1/", "file:///etc/passwd", "https://u:p@other.example/", "https://other.example:8443/"]) {
  test(`rejects unsafe redirect ${target}`, async () => {
    fetchMock.mock.mockImplementation(async () =>
      new Response(null, { status: 302, headers: { location: target } }));
    failure(await extractWebsiteData(url), "unsafe_url");
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

test("allows three redirects but stops a loop after the fourth response", async () => {
  fetchMock.mock.mockImplementation(async () =>
    new Response(null, { status: 302, headers: { location: "/loop" } }));
  failure(await extractWebsiteData(url), "redirect_failure");
  assert.equal(fetchMock.mock.callCount(), 4);
  fetchMock.mock.resetCalls();
  let requests = 0;
  fetchMock.mock.mockImplementation(async () => ++requests <= 3
    ? new Response(null, { status: 302, headers: { location: "/next" } }) : html());
  assert.equal((await extractWebsiteData(url)).ok, true);
  assert.equal(fetchMock.mock.callCount(), 4);
});

test("reports redirects without a Location", async () => {
  fetchMock.mock.mockImplementation(async () => new Response(null, { status: 302 }));
  failure(await extractWebsiteData(url), "redirect_failure");
  assert.equal(fetchMock.mock.callCount(), 1);
});

for (const type of ["text/html; charset=utf-8", "Application/XHTML+XML"]) {
  test(`accepts ${type}`, async () => {
    fetchMock.mock.mockImplementation(async () => html("", { "content-type": type }));
    assert.equal((await extractWebsiteData(url)).ok, true);
  });
}
for (const type of [null, "application/json", "image/png", "text/plain", "text/html-not-really"]) {
  test(`rejects content type ${type}`, async () => {
    fetchMock.mock.mockImplementation(async () => new Response(null, {
      headers: type ? { "content-type": type } : {},
    }));
    failure(await extractWebsiteData(url), "invalid_content_type");
  });
}

test("rejects oversized declared length before reading", async () => {
  const response = html("small", { "content-length": "512001" });
  const reader = mock.method(response.body, "getReader");
  fetchMock.mock.mockImplementation(async () => response);
  failure(await extractWebsiteData(url), "response_too_large");
  assert.equal(reader.mock.callCount(), 0);
});

for (const declared of [undefined, "1", "invalid"]) {
  test(`counts streamed bytes regardless of declared length ${declared}`, async () => {
    const cancel = mock.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(256_000));
        controller.enqueue(new Uint8Array(256_001));
      },
      cancel,
    });
    fetchMock.mock.mockImplementation(async () => html(stream,
      declared === undefined ? {} : { "content-length": declared }));
    failure(await extractWebsiteData(url), "response_too_large");
    assert.equal(cancel.mock.callCount(), 1);
  });
}

test("accepts exactly 512000 bytes and rejects multibyte HTML above the limit", async () => {
  fetchMock.mock.mockImplementation(async () => html(" ".repeat(512_000)));
  assert.equal((await extractWebsiteData(url)).ok, true);
  fetchMock.mock.mockImplementation(async () => html("é".repeat(256_001)));
  failure(await extractWebsiteData(url), "response_too_large");
});

test("uses a five-second abort signal and returns a structured timeout", async () => {
  const controller = new AbortController();
  const timeout = mock.method(AbortSignal, "timeout", () => controller.signal);
  fetchMock.mock.mockImplementation(async (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }));
  failure(await extractWebsiteData(url), "timeout");
  assert.deepEqual(timeout.mock.calls.map(({ arguments: args }) => args), [[5_000]]);
});

test("returns structured network and HTTP errors", async () => {
  fetchMock.mock.mockImplementation(async () => { throw new TypeError("connection failed"); });
  failure(await extractWebsiteData(url), "network_failure");
  fetchMock.mock.mockImplementation(async () => new Response(null, { status: 503 }));
  failure(await extractWebsiteData(url), "http_error");
});

test("a timeout while streaming fails closed without returning partial metadata", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<title>Partial</title>"));
    },
    pull(controller) {
      controller.error(new DOMException("Timed out", "TimeoutError"));
    },
  });
  fetchMock.mock.mockImplementation(async () => html(stream));
  // Current implementation classifies body-read errors as network_failure,
  // unlike timeouts before headers; preserve the no-partial-success invariant.
  failure(await extractWebsiteData(url), "network_failure");
});

test("does not extract personal or unapproved mailboxes", async () => {
  fetchMock.mock.mockImplementation(async () => html("jane@restaurant.example sales@restaurant.example"));
  assert.equal((await extractWebsiteData(url)).data.roleEmail, null);
});

test("recognises obfuscated role email and handles missing metadata", async () => {
  fetchMock.mock.mockImplementation(async () => html("reservations [at] restaurant [dot] example"));
  assert.deepEqual((await extractWebsiteData(url)).data, {
    finalUrl: url, title: null, description: null, roleEmail: "reservations@restaurant.example",
  });
});

for (const role of ["bookings", "catering", "contact", "enquiries", "events", "hello",
  "info", "office", "reservations", "restaurant", "support", "team"]) {
  test(`accepts exact role ${role} and normalises mailto`, () => {
    assert.deepEqual(validateEmail(` MAILTO:${role.toUpperCase()}@Restaurant.Example?subject=Hello `), {
      status: "valid", email: `${role}@restaurant.example`, reason: "local_checks_passed",
    });
  });
}
for (const [email, reason] of [
  ["", "empty"], ["   ", "empty"], ["mailto:", "empty"],
  ["not-an-email", "invalid_syntax"], ["info@@restaurant.example", "invalid_syntax"],
  ["info @restaurant.example", "invalid_syntax"], ["x".repeat(255), "invalid_syntax"],
  ["info@localhost", "invalid_domain"], ["info@-bad.example", "invalid_domain"],
  ["info@bad-.example", "invalid_domain"], ["info@bad..example", "invalid_domain"],
  ["info@restaurant.123", "invalid_domain"], ["info@" + "a".repeat(64) + ".example", "invalid_domain"],
  [".info@restaurant.example", "invalid_domain"], ["info.@restaurant.example", "invalid_domain"],
  ["in..fo@restaurant.example", "invalid_domain"], ["a".repeat(65) + "@restaurant.example", "invalid_domain"],
  ["jane@restaurant.example", "not_role_mailbox"], ["sales@restaurant.example", "not_role_mailbox"],
  ["info+tracking@restaurant.example", "not_role_mailbox"], ["info.jane@restaurant.example", "not_role_mailbox"],
]) {
  test(`rejects email ${email} with ${reason}`, () => {
    assert.deepEqual(validateEmail(email), { status: "invalid", email: null, reason });
  });
}