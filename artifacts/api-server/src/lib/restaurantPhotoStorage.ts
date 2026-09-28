import { randomUUID } from "node:crypto";
import { CHEF_IMAGE_MAX_BYTES, CHEF_IMAGE_TYPES, configuredPath, hasExpectedImageSignature, storage } from "./chefObjectStorage";

export const PHOTO_TYPES = CHEF_IMAGE_TYPES;
export const PHOTO_MAX_BYTES = CHEF_IMAGE_MAX_BYTES;
export const createPhotoPath = () => `/objects/restaurant/${randomUUID()}`;

function fileFor(path: string) {
  if (!/^\/objects\/restaurant\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(path)) throw new Error("Invalid photo path.");
  const { bucket, prefix } = configuredPath();
  return storage.bucket(bucket).file(`${prefix ? `${prefix}/` : ""}${path.slice("/objects/".length)}`);
}

export async function signPhotoUpload(path: string) {
  const { bucket, prefix } = configuredPath();
  fileFor(path);
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucket, object_name: `${prefix ? `${prefix}/` : ""}${path.slice("/objects/".length)}`,
      method: "PUT", expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    }),
  });
  if (!response.ok) throw new Error("Photo upload signing failed.");
  const payload = await response.json() as { signed_url?: unknown };
  if (!payload.signed_url) throw new Error("Missing photo upload URL.");
  return payload.signed_url;
}

export async function verifyPhoto(path: string, type: (typeof PHOTO_TYPES)[number], size: number) {
  const file = fileFor(path);
  try {
    const [meta] = await file.getMetadata();
    const generation = String(meta.generation ?? "");
    if (!/^\d+$/.test(generation) || !Number.isSafeInteger(Number(generation))) throw new Error("Photo generation unavailable.");
    if (Number(meta.size) !== size || size <= 0 || size > PHOTO_MAX_BYTES || meta.contentType !== type)
      throw new Error("Photo metadata does not match.");
    const [header] = await file.bucket.file(file.name, { generation: Number(generation) }).download({ start: 0, end: 11 });
    if (!hasExpectedImageSignature(header, type)) throw new Error("Unsupported image.");
    await file.setMetadata({ contentType: type });
    return generation;
  } catch (error) {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    throw error;
  }
}

export async function deletePhoto(path: string) {
  await fileFor(path).delete({ ignoreNotFound: true });
}

export async function streamPhoto(path: string, generation: string, res: import("express").Response, cache = "private, no-store") {
  try {
    const original = fileFor(path);
    if (!/^\d+$/.test(generation) || !Number.isSafeInteger(Number(generation))) throw new Error("Invalid generation.");
    const file = original.bucket.file(original.name, { generation: Number(generation) });
    const [meta] = await file.getMetadata();
    res.setHeader("Content-Type", String(meta.contentType));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", cache);
    file.createReadStream().on("error", () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); }).pipe(res);
  } catch {
    res.status(404).json({ error: "Photo not found." });
  }
}