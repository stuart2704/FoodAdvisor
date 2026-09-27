import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const dir = await mkdtemp(path.join(os.tmpdir(), "social-facts-"));
const dbMock = `
export const restaurantChefProfilesTable = new Proxy({}, { get: (_, name) => name });
export const socialPostsTable = new Proxy({}, { get: (_, name) => name });
export const db = {
  select() {
    return { from(table) { this.table = table; return this; }, where() { return this; },
      limit() { return Promise.resolve(this.table === socialPostsTable
        ? (globalThis.__socialPost ? [globalThis.__socialPost] : [])
        : (globalThis.__socialProfile ? [globalThis.__socialProfile] : [])); },
    };
  },
};
`;
async function fixture(entry, name) {
  const outfile = path.join(dir, `${name}.mjs`);
  await build({
    entryPoints: [path.resolve(import.meta.dirname, entry)],
    outfile, bundle: true, platform: "node", format: "esm",
    plugins: [{
      name: "social-mocks",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$|^drizzle-orm$|^express$|chefObjectStorage$|public-url$/ }, (args) => ({
          path: args.path, namespace: "social-mocks",
        }));
        builder.onLoad({ filter: /.*/, namespace: "social-mocks" }, (args) => ({
          contents: args.path === "@workspace/db" ? dbMock
            : args.path === "drizzle-orm" ? "export const eq=()=>true; export const and=()=>true;"
            : args.path === "express" ? 'export const Router=()=>({get(route,handler){globalThis.__socialMediaHandler=handler;}});'
            : args.path.endsWith("chefObjectStorage")
              ? 'export const CHEF_IMAGE_TYPES=["image/jpeg","image/png","image/webp"]; export const CHEF_IMAGE_MAX_BYTES=5242880; export const streamChefObject=(path)=>{globalThis.__streamedSocialPhoto=path;}; export const getChefObject=()=>{};'
              : 'export async function assertPublicHttpsUrl(){return new URL("https://example.com");}',
        }));
      },
    }],
  });
  return import(pathToFileURL(outfile).href);
}
const captions = await fixture("ai.service.ts", "captions");
const media = await fixture("media.ts", "media");
const pathId = "/objects/chef/123e4567-e89b-12d3-a456-426614174000";
test.after(async () => rm(dir, { recursive: true, force: true }));

test("missing facts do not produce claims about cuisine, chef, ingredients, trends or reviews", () => {
  const safe = captions.restaurantCaptions({ name: "Cafe One", city: "Leeds" });
  assert.ok(safe.length >= 3);
  assert.ok(safe.every((text) => !/cuisine|chef|trending|ingredients|favourite|review|exceptional/i.test(text)));
  assert.throws(() => captions.restaurantCaptions({ name: "", city: "Leeds" }), /name and city/);
  assert.throws(() => captions.restaurantCaptions({ name: "Cafe One", city: "" }), /name and city/);
  assert.equal(captions.renderVerifiedTemplate(captions.verifiedTemplates[3], { review_excerpt: "Great", cuisine: "Italian" }, new Set(["review_excerpt", "cuisine"])), null);
});

test("only an approved profile provides chef name and a candidate photo; generation does not publish it", async () => {
  globalThis.__socialProfile = { name: "Alex", path: pathId };
  const post = await captions.generateRestaurantPost({ placeId: "one", name: "Cafe One", city: "Leeds" }, 5);
  assert.match(post.caption, /Alex/);
  assert.equal(post.mediaObjectPath, pathId);
  assert.equal("media" in post, false);
  globalThis.__socialProfile = null;
  const withoutProfile = await captions.generateRestaurantPost({ placeId: "one", name: "Cafe One", city: "Leeds" });
  assert.equal(withoutProfile.mediaObjectPath, null);
  assert.doesNotMatch(withoutProfile.caption, /Alex/);
});

test("photo is inaccessible without explicit post approval and the same currently approved image", async () => {
  const post = { restaurantId: "one", mediaObjectPath: pathId, mediaApprovedAt: null };
  globalThis.__socialProfile = { path: pathId, mime: "image/jpeg", size: 100 };
  assert.equal(await media.approvedPhotoPath(post), null);
  post.mediaApprovedAt = new Date();
  assert.equal(await media.approvedPhotoPath(post), pathId);
  globalThis.__socialProfile.path = "/objects/chef/123e4567-e89b-12d3-a456-426614174001";
  assert.equal(await media.approvedPhotoPath(post), null);
  globalThis.__socialProfile.path = pathId;
  globalThis.__socialProfile.mime = "text/html";
  assert.equal(await media.approvedPhotoPath(post), null);
});

test("public Facebook fetch denies unapproved and changed images, serves the approved object", async () => {
  const route = globalThis.__socialMediaHandler;
  const post = { restaurantId: "one", mediaObjectPath: pathId, mediaApprovedAt: null };
  globalThis.__socialPost = post;
  globalThis.__socialProfile = { path: pathId, mime: "image/jpeg", size: 100 };
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, end() {} });
  const request = { params: { postId: "123e4567-e89b-12d3-a456-426614174002" } };
  globalThis.__streamedSocialPhoto = null;
  assert.equal((await route(request, response())), undefined);
  assert.equal(globalThis.__streamedSocialPhoto, null);
  post.mediaApprovedAt = new Date();
  await route(request, response());
  assert.equal(globalThis.__streamedSocialPhoto, pathId);
  globalThis.__streamedSocialPhoto = null;
  globalThis.__socialProfile.path = "/objects/chef/123e4567-e89b-12d3-a456-426614174003";
  await route(request, response());
  assert.equal(globalThis.__streamedSocialPhoto, null);
});