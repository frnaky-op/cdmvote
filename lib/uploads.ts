import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "players");
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export class PhotoUploadError extends Error {}

/**
 * Saves an uploaded player photo to the local public/uploads volume and
 * returns its public URL path. Local disk is fine for this project's scale
 * (single-instance Docker deploy) — no S3 integration.
 */
export async function savePlayerPhoto(file: File): Promise<string> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new PhotoUploadError("Photo must be a JPEG, PNG, WebP, or GIF image");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new PhotoUploadError("Photo must be 5MB or smaller");
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  const extension = EXTENSION_BY_TYPE[file.type];
  const filename = `${randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);

  return `/uploads/players/${filename}`;
}
