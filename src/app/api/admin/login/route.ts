import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { ConcurrencyGate, clientKey, globalLimit, rateLimit } from "@/lib/security/rate-limit";
import { createSession, findUserByEmail } from "@/lib/auth/session.server";
import { hashPassword, verifyPassword } from "@/lib/auth/passwords";
import { recordAudit } from "@/lib/audit";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
});

/**
 * Caps concurrent password verifications process-wide.
 *
 * scrypt is memory-hard on purpose. Without this, a flood of login attempts —
 * from any number of source addresses, real or spoofed — allocates tens of MiB
 * each and monopolises the libuv threadpool that also serves photo downloads.
 * The result is not a compromised account but a dead kiosk, which for a paying
 * customer mid-transaction is just as bad. Two at a time is plenty for a
 * boutique with four accounts.
 */
const passwordGate = new ConcurrencyGate(2);

/**
 * Pre-computed hash of a throwaway password, used to burn the same scrypt work
 * when the email does not exist. Without it, "no such user" returns in
 * microseconds while a real user takes ~100ms — which is a free account
 * enumeration oracle.
 */
let decoyHash: string | null = null;
async function getDecoyHash(): Promise<string> {
  decoyHash ??= await hashPassword("decoy-password-not-used-for-login");
  return decoyHash;
}

/** Same message for every failure mode — bad email, bad password, deactivated. */
const GENERIC_FAILURE = "Incorrect email or password.";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Two ceilings. The per-client one is the brute-force limit; the global one
    // survives IP rotation and a spoofed X-Forwarded-For, which is what stops a
    // login flood from becoming an outage.
    const perClient = rateLimit(clientKey(request, "admin-login"), 8, 300);
    const overall = globalLimit("admin-login", 60, 300);
    if (!perClient.allowed || !overall.allowed) {
      log.warn("admin.login_rate_limited", { scope: perClient.allowed ? "global" : "client" });
      const retryAfter = Math.max(perClient.retryAfterSeconds, overall.retryAfterSeconds);
      return fail(429, "RATE_LIMITED", "Too many attempts. Please wait a few minutes.", {
        headers: { "Retry-After": String(retryAfter) },
      });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "INVALID_REQUEST", GENERIC_FAILURE);

    const user = await findUserByEmail(parsed.data.email);
    const storedHash = user?.password_hash ?? (await getDecoyHash());
    // Serialised through the gate: the decoy path costs the same as a real one
    // (so timing reveals nothing) and both are bounded (so cost cannot be
    // amplified into a denial of service).
    const passwordOk = await passwordGate.run(() => verifyPassword(parsed.data.password, storedHash));

    if (!user || !passwordOk || !user.active) {
      log.warn("admin.login_failed", { reason: !user ? "no_user" : !passwordOk ? "bad_password" : "inactive" });
      await recordAudit({
        actorLabel: "anonymous",
        eventType: "admin.login_failed",
        metadata: { reason: !user ? "unknown_account" : !passwordOk ? "bad_password" : "inactive_account" },
      });
      return fail(401, "INVALID_CREDENTIALS", GENERIC_FAILURE);
    }

    await createSession(user.id);
    await recordAudit({
      actorUserId: user.id,
      actorLabel: user.email,
      eventType: "admin.login_succeeded",
      metadata: { role: user.role },
    });
    log.info("admin.login_succeeded", { role: user.role });

    return ok({ role: user.role });
  } catch (error) {
    return handleApiError("POST /api/admin/login", error);
  }
}
