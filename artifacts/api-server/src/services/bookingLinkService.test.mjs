import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "booking-link-"));
const output = path.join(tempDir, "booking-link.mjs");
await build({
  entryPoints: [path.resolve(import.meta.dirname, "bookingLinkService.ts")],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "network-mocks",
    setup(builder) {
      builder.onResolve({ filter: /^node:dns\/promises$/ }, () => ({ path: "dns", namespace: "mock" }));
      builder.onResolve({ filter: /^node:https$/ }, () => ({ path: "https", namespace: "mock" }));
      builder.onResolve({ filter: /\.\.\/lib\/public-url$/ }, () => ({ path: "public-url", namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
        contents: args.path === "dns"
          ? "export async function lookup(host){ const addresses=globalThis.__bookingDns[host]; if(!addresses) throw new Error('missing'); return addresses.map(address=>({address,family:address.includes(':')?6:4})); }"
          : args.path === "https"
            ? `export function request(url, options, callback) {
                const req = {
                  error: null,
                  on(name, handler) { if (name === "error") this.error = handler; return this; },
                  setTimeout() { return this; },
                  destroy(error) { this.error?.(error); },
                  end() {
                    options.lookup(url.hostname, {}, (error, address) => {
                      if (error) { this.error?.(error); return; }
                      globalThis.__bookingConnections.push({ hostname: url.hostname, address });
                      const item = globalThis.__bookingResponses.shift();
                      callback({
                        statusCode: item.status,
                        headers: item.location ? { location: item.location } : {},
                        destroy() {},
                      });
                    });
                  },
                };
                return req;
              }`
          : "export function isPrivateAddress(address){ return address.startsWith('127.') || address.startsWith('10.') || address === '::1'; }",
        loader: "js",
      }));
    },
  }],
});
const { verifyBookingLink } = await import(pathToFileURL(output).href);

function setupResponses(...responses) {
  globalThis.__bookingConnections = [];
  globalThis.__bookingResponses = responses;
}

test("booking verifier accepts bounded same-site redirects", async () => {
  globalThis.__bookingDns = {
    "example.com": ["203.0.113.10"],
    "secure.example.com": ["203.0.113.11"],
  };
  setupResponses(
    { status: 302, location: "https://secure.example.com/table" },
    { status: 200 },
  );
  assert.equal(
    await verifyBookingLink("https://example.com/start"),
    "https://secure.example.com/table",
  );
});

test("booking verifier rejects invalid, credential-bearing, and private hosts", async () => {
  globalThis.__bookingDns = { "private.example": ["127.0.0.1"] };
  for (const url of [
    "not a url",
    "http://book.example.com/table",
    "https://user:pass@book.example.com/table",
    "https://private.example/table",
  ]) {
    await assert.rejects(() => verifyBookingLink(url));
  }
});

test("booking verifier rejects unrelated redirects and redirect loops", async () => {
  globalThis.__bookingDns = {
    "book.example.com": ["203.0.113.10"],
    "unrelated.test": ["203.0.113.11"],
  };
  setupResponses({ status: 302, location: "https://unrelated.test/table" });
  await assert.rejects(
    () => verifyBookingLink("https://book.example.com/start"),
    /unrelated website/,
  );

  setupResponses(
    ...Array.from({ length: 5 }, () => ({ status: 302, location: "/again" })),
  );
  await assert.rejects(
    () => verifyBookingLink("https://book.example.com/start"),
    /too many redirects/,
  );
});

test("booking verifier pins the connection to the validated public address", async () => {
  globalThis.__bookingDns = { "rebind.example.com": ["198.41.0.4"] };
  globalThis.__bookingSystemDns = { "rebind.example.com": "127.0.0.1" };
  setupResponses({ status: 200 });

  await verifyBookingLink("https://rebind.example.com/table");

  assert.deepEqual(globalThis.__bookingConnections, [{
    hostname: "rebind.example.com",
    address: "198.41.0.4",
  }]);
  assert.notEqual(
    globalThis.__bookingConnections[0].address,
    globalThis.__bookingSystemDns["rebind.example.com"],
  );
});

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});