import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Private object storage for approved final images.
 *
 * Nothing here is ever publicly readable. Bytes leave through exactly one route
 * (/api/download/[token]) after a token hash lookup, and are deleted by the
 * expiry job. Two drivers:
 *
 *   filesystem — default; a private directory outside /public. Right for a
 *                single supervised kiosk and for local development.
 *   supabase   — Supabase Storage on a private bucket, via the REST API using
 *                the service role key. No extra SDK dependency.
 */

export interface StoredObject {
  path: string;
  byteSize: number;
  contentType: string;
}

export interface StorageDriver {
  readonly name: string;
  put(path: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(path: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(path: string): Promise<void>;
}

/**
 * Object keys are built from server-generated UUIDs, but this is the belt to
 * that suspenders: a key may only contain safe characters and may never escape
 * the storage root. Applied before every filesystem operation.
 */
export function assertSafeStoragePath(path: string): void {
  if (!/^[A-Za-z0-9/_.-]+$/.test(path) || path.includes("..") || path.startsWith("/")) {
    throw new Error("Unsafe storage path.");
  }
}

// ------------------------------------------------------------- filesystem --

function localRoot(): string {
  return resolve(process.cwd(), getEnv().STORAGE_LOCAL_DIR);
}

function localPathFor(path: string): string {
  assertSafeStoragePath(path);
  const root = localRoot();
  const full = normalize(join(root, path));
  // Defence in depth against a normalisation surprise.
  if (full !== root && !full.startsWith(root + sep)) throw new Error("Unsafe storage path.");
  return full;
}

const filesystemDriver: StorageDriver = {
  name: "filesystem",

  async put(path, body, contentType) {
    const full = localPathFor(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body, { mode: 0o600 });
    await writeFile(`${full}.type`, contentType, { mode: 0o600 });
    return { path, byteSize: body.byteLength, contentType };
  },

  async get(path) {
    const full = localPathFor(path);
    try {
      const body = await readFile(full);
      const contentType = await readFile(`${full}.type`, "utf8").catch(() => "image/jpeg");
      return { body, contentType: contentType.trim() };
    } catch {
      return null;
    }
  },

  async delete(path) {
    const full = localPathFor(path);
    await rm(full, { force: true });
    await rm(`${full}.type`, { force: true });
  },
};

// --------------------------------------------------------------- supabase --

const supabaseDriver: StorageDriver = {
  name: "supabase",

  async put(path, body, contentType) {
    assertSafeStoragePath(path);
    const env = getEnv();
    const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${env.STORAGE_BUCKET}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": contentType,
        "x-upsert": "true",
        "cache-control": "no-store",
      },
      body: new Uint8Array(body),
    });
    if (!response.ok) {
      throw new Error(`Supabase Storage upload failed (${response.status}).`);
    }
    return { path, byteSize: body.byteLength, contentType };
  },

  async get(path) {
    assertSafeStoragePath(path);
    const env = getEnv();
    const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${env.STORAGE_BUCKET}/${path}`, {
      headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return { body: buffer, contentType: response.headers.get("content-type") ?? "image/jpeg" };
  },

  async delete(path) {
    assertSafeStoragePath(path);
    const env = getEnv();
    const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${env.STORAGE_BUCKET}/${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!response.ok && response.status !== 404) {
      log.warn("storage.delete_failed", { status: response.status, driver: "supabase" });
    }
  },
};

export function getStorage(): StorageDriver {
  return getEnv().STORAGE_DRIVER === "supabase" ? supabaseDriver : filesystemDriver;
}
