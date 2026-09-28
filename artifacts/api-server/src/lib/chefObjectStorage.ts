import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";

export const CHEF_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const CHEF_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export function hasExpectedImageSignature(
  bytes: Buffer,
  contentType: (typeof CHEF_IMAGE_TYPES)[number],
): boolean {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    );
  }
  return (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

export const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    type: "external_account",
    credential_source: {
      url: "http://127.0.0.1:1106/credential",
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export function configuredPath(): { bucket: string; prefix: string } {
  const raw = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!raw) throw new Error("PRIVATE_OBJECT_DIR is not configured.");
  const parts = raw.replace(/^\/+/, "").split("/");
  const bucket = parts.shift();
  if (!bucket) throw new Error("PRIVATE_OBJECT_DIR is invalid.");
  return { bucket, prefix: parts.join("/") };
}

export function createChefObjectPath(): string {
  return `/objects/chef/${randomUUID()}`;
}

function objectName(objectPath: string): string {
  if (!/^\/objects\/chef\/[0-9a-f-]{36}$/.test(objectPath)) {
    throw new Error("Invalid chef image object path.");
  }
  const { prefix } = configuredPath();
  return `${prefix ? `${prefix}/` : ""}${objectPath.slice("/objects/".length)}`;
}

export async function createChefUploadUrl(
  objectPath: string,
  contentType: (typeof CHEF_IMAGE_TYPES)[number],
  sizeBytes: number,
): Promise<string> {
  if (sizeBytes <= 0 || sizeBytes > CHEF_IMAGE_MAX_BYTES) {
    throw new Error("Invalid chef image size.");
  }
  const { bucket } = configuredPath();
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucket,
      object_name: objectName(objectPath),
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
  });
  if (!response.ok) {
    throw new Error(`Object storage signing failed (${response.status}).`);
  }
  const payload = await response.json() as { signed_url?: unknown };
  if (typeof payload.signed_url !== "string" || !payload.signed_url) {
    throw new Error("Object storage returned an invalid signed URL.");
  }
  return payload.signed_url;
}

export async function deleteChefObject(objectPath: string | null | undefined): Promise<void> {
  if (!objectPath) return;
  const { bucket } = configuredPath();
  await storage.bucket(bucket).file(objectName(objectPath)).delete({ ignoreNotFound: true });
}

export async function finalizeChefObject(
  objectPath: string,
  contentType: (typeof CHEF_IMAGE_TYPES)[number],
  sizeBytes: number,
  owner: string,
): Promise<void> {
  const { bucket } = configuredPath();
  const file = storage.bucket(bucket).file(objectName(objectPath));
  try {
    const [metadata] = await file.getMetadata();
    const actualSize = Number(metadata.size ?? 0);
    if (actualSize <= 0 || actualSize > CHEF_IMAGE_MAX_BYTES || actualSize !== sizeBytes) {
      throw new Error("Uploaded image size does not match the validated request.");
    }
    if (metadata.contentType !== contentType) {
      throw new Error("Uploaded image content type does not match the validated request.");
    }
    const [header] = await file.download({ start: 0, end: 11 });
    if (!hasExpectedImageSignature(header, contentType)) {
      throw new Error("Uploaded file content is not a supported image.");
    }
    await file.setMetadata({
      contentType,
      metadata: { chefOwner: owner, chefVisibility: "private" },
    });
  } catch (error) {
    try {
      await file.delete({ ignoreNotFound: true });
    } catch {
      // Best effort cleanup; callers log the verification failure.
    }
    throw error;
  }
}

export async function getChefObject(objectPath: string) {
  const { bucket } = configuredPath();
  return storage.bucket(bucket).file(objectName(objectPath));
}

export async function streamChefObject(
  objectPath: string,
  res: any,
  cacheControl = "public, max-age=3600",
): Promise<void> {
  try {
    const file = await getChefObject(objectPath);
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", String(metadata.contentType ?? "application/octet-stream"));
    res.setHeader("Cache-Control", cacheControl);
    file.createReadStream().on("error", () => {
      if (!res.headersSent) res.status(404).end();
    }).pipe(res);
  } catch {
    res.status(404).json({ error: "Object not found." });
  }
}