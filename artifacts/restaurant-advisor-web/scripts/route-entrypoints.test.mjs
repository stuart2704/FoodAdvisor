import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

test("the production build emits direct-route HTML entry files", async () => {
  const dist = resolve(import.meta.dirname, "../dist");
  const root = await readFile(resolve(dist, "index.html"), "utf8");
  assert.match(root, /<div id="root"><\/div>/);
  assert.match(root, /<script[^>]+src="\/assets\/[^"]+\.js"/);

  for (const route of ["restaurants", "about", "contact", "owner"]) {
    const entry = await readFile(resolve(dist, route, "index.html"), "utf8");
    assert.equal(entry, root, `/${route}/ must load the built app`);
  }

  const asset = root.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(asset, "built JS asset must be referenced");
  assert.ok((await stat(resolve(dist, asset.slice(1)))).isFile());
});