import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing with scrypt from node:crypto.
 *
 * scrypt rather than an argon2/bcrypt dependency: it is memory-hard, it is in
 * the standard library, and the entire user base of this app is one owner and a
 * handful of boutique staff. Adding a native-binary dependency to hash four
 * passwords is not a trade worth making.
 *
 * Parameters: N=2^15, r=8, p=3 — an OWASP-listed configuration (~32 MiB,
 * ~150ms). Deliberately NOT the 2^17 variant: at 128 MiB per verification, a
 * handful of concurrent login attempts exhausts both process memory and the
 * libuv threadpool that also serves image reads, turning a login flood into a
 * kiosk outage. 32 MiB is still far past what a four-account admin panel needs
 * to make offline cracking impractical.
 *
 * Existing hashes keep working: verifyPassword reads N/r/p from the stored
 * string, so this only changes newly created passwords.
 */
const PARAMS = { N: 32_768, r: 8, p: 3, maxmem: 128 * 1024 * 1024 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error("Password must be at least 12 characters.");
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [string, string, string, string, string, string];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltRaw, "base64");
  const expected = Buffer.from(hashRaw, "base64");

  let derived: Buffer;
  try {
    derived = await scrypt(password, salt, expected.length, { N, r, p, maxmem: PARAMS.maxmem });
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
