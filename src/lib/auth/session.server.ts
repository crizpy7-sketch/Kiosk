import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne } from "@/lib/db/client";
import type { AdminSessionRow, UserRole, UserRow } from "@/lib/db/types";
import { getEnv } from "@/lib/env";
import { ADMIN_COOKIE } from "@/lib/auth/session.constants";

/**
 * Admin sessions.
 *
 * A random 32-byte token in an HttpOnly, SameSite=Lax, Secure cookie; only its
 * SHA-256 is stored. There is no JWT and no client-readable claim: role is
 * looked up from the database on every request, so revoking or demoting a staff
 * member takes effect immediately rather than when a token happens to expire.
 */

export { ADMIN_COOKIE };
const SESSION_TTL_HOURS = 12;

export interface AdminIdentity {
  userId: string;
  email: string;
  role: UserRole;
  sessionId: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

  await query(`INSERT INTO admin_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    userId,
    hashToken(token),
    expiresAt,
  ]);
  await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);

  const store = await cookies();
  store.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

/** Resolves the caller's identity, or null. Expired and inactive users get null. */
export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne<AdminSessionRow & { email: string; role: UserRole; active: boolean }>(
    `SELECT s.*, u.email, u.role, u.active
       FROM admin_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );

  if (!row || !row.active) return null;

  // Cheap liveness signal for the admin "active sessions" view; not on the hot path.
  void query(`UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1`, [row.id]).catch(() => undefined);

  return { userId: row.user_id, email: row.email, role: row.role, sessionId: row.id };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (token) await query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [hashToken(token)]);
  store.delete(ADMIN_COOKIE);
}

export async function purgeExpiredSessions(): Promise<void> {
  await query(`DELETE FROM admin_sessions WHERE expires_at < now()`);
}

// ------------------------------------------------------------ permissions --

/**
 * Capability list. Staff get the operational subset needed to rescue a customer
 * standing at the kiosk; everything touching money configuration, credentials,
 * security, audit history or other people's access is owner-only.
 */
export const PERMISSIONS = [
  "orders.view",
  "orders.assist",
  "orders.retry_delivery",
  "orders.regenerate_qr",
  "orders.mark_helped",
  "orders.request_refund",
  "orders.delete_photo",
  "kiosk.view",
  "kiosk.reset",
  "revenue.view",
  "refunds.issue",
  "experiences.manage",
  "pricing.manage",
  "limits.manage",
  "audit.view",
  "users.manage",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const STAFF_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "orders.view",
  "orders.assist",
  "orders.retry_delivery",
  "orders.regenerate_qr",
  "orders.mark_helped",
  "orders.request_refund",
  "orders.delete_photo",
  "kiosk.view",
  "kiosk.reset",
]);

export function hasPermission(role: UserRole, permission: Permission): boolean {
  if (role === "owner") return true;
  return STAFF_PERMISSIONS.has(permission);
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  constructor(permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED";
  constructor() {
    super("Sign in required.");
    this.name = "UnauthenticatedError";
  }
}

/** Throws unless the caller is signed in and holds `permission`. */
export async function requirePermission(permission: Permission): Promise<AdminIdentity> {
  const identity = await getAdminIdentity();
  if (!identity) throw new UnauthenticatedError();
  if (!hasPermission(identity.role, permission)) throw new ForbiddenError(permission);
  return identity;
}

// ------------------------------------------------------------------ users --

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
}

export async function listUsers(): Promise<UserRow[]> {
  return query<UserRow>(`SELECT * FROM users ORDER BY created_at ASC`);
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  role: UserRole;
}): Promise<UserRow> {
  const row = await queryOne<UserRow>(
    `INSERT INTO users (email, password_hash, role) VALUES (lower($1), $2, $3) RETURNING *`,
    [input.email, input.passwordHash, input.role],
  );
  if (!row) throw new Error("Failed to create user.");
  return row;
}

export async function setUserActive(userId: string, active: boolean): Promise<void> {
  await query(`UPDATE users SET active = $2 WHERE id = $1`, [userId, active]);
  if (!active) await query(`DELETE FROM admin_sessions WHERE user_id = $1`, [userId]);
}
