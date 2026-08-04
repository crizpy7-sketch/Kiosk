import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDeliveryToken,
  expiryFromNow,
  hashDeliveryToken,
  hoursUntil,
  isExpired,
  isWellFormedDeliveryToken,
} from "@/lib/delivery/tokens";
import { ConcurrencyGate, clientKey, rateLimit, resetRateLimits } from "@/lib/security/rate-limit";
import { hashPassword, verifyPassword } from "@/lib/auth/passwords";
import { hasPermission, PERMISSIONS } from "@/lib/auth/session.server";
import { sanitizeMetadata } from "@/lib/audit";
import { normalizeDecartError, isRetryable } from "@/lib/ai/errors";
import { assertSafeStoragePath } from "@/lib/storage/index.server";

describe("delivery tokens", () => {
  it("mints unguessable, unique tokens", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const { token } = createDeliveryToken();
      expect(seen.has(token)).toBe(false);
      seen.add(token);
      // 32 random bytes, base64url — at least 43 characters.
      expect(token.length).toBeGreaterThanOrEqual(43);
    }
  });

  it("stores only a hash, never the token", () => {
    const { token, tokenHash } = createDeliveryToken();
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).not.toContain(token);
    expect(hashDeliveryToken(token)).toBe(tokenHash);
  });

  it("rejects malformed tokens before any database lookup", () => {
    expect(isWellFormedDeliveryToken(createDeliveryToken().token)).toBe(true);
    expect(isWellFormedDeliveryToken("short")).toBe(false);
    expect(isWellFormedDeliveryToken("../../etc/passwd")).toBe(false);
    expect(isWellFormedDeliveryToken("a".repeat(200))).toBe(false);
    expect(isWellFormedDeliveryToken("has spaces in it aaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(isWellFormedDeliveryToken("'; DROP TABLE assets;--")).toBe(false);
  });

  describe("expiry", () => {
    const now = new Date("2026-08-03T12:00:00Z");

    it("computes an absolute expiry from a TTL", () => {
      expect(expiryFromNow(24, now).toISOString()).toBe("2026-08-04T12:00:00.000Z");
      expect(expiryFromNow(1, now).toISOString()).toBe("2026-08-03T13:00:00.000Z");
    });

    it("reports whole hours remaining, floored at zero", () => {
      expect(hoursUntil(new Date("2026-08-04T12:00:00Z"), now)).toBe(24);
      expect(hoursUntil(new Date("2026-08-03T13:30:00Z"), now)).toBe(2);
      expect(hoursUntil(new Date("2026-08-01T12:00:00Z"), now)).toBe(0);
    });

    it("treats the exact expiry instant as expired", () => {
      expect(isExpired(new Date("2026-08-03T12:00:00Z"), now)).toBe(true);
      expect(isExpired(new Date("2026-08-03T12:00:01Z"), now)).toBe(false);
    });
  });
});

describe("rate limiting", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit then refuses", () => {
    for (let i = 0; i < 5; i += 1) {
      expect(rateLimit("key", 5, 60).allowed).toBe(true);
    }
    const blocked = rateLimit("key", 5, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps separate buckets per key", () => {
    rateLimit("a", 1, 60);
    expect(rateLimit("a", 1, 60).allowed).toBe(false);
    expect(rateLimit("b", 1, 60).allowed).toBe(true);
  });

  it("reopens after the window passes", () => {
    const start = 1_000_000;
    rateLimit("w", 1, 60, start);
    expect(rateLimit("w", 1, 60, start + 1000).allowed).toBe(false);
    expect(rateLimit("w", 1, 60, start + 61_000).allowed).toBe(true);
  });
});

describe("rate-limit client identity", () => {
  const original = process.env["TRUST_PROXY_HEADERS"];
  afterEach(() => {
    if (original === undefined) delete process.env["TRUST_PROXY_HEADERS"];
    else process.env["TRUST_PROXY_HEADERS"] = original;
  });

  it("ignores a client-supplied X-Forwarded-For by default", () => {
    delete process.env["TRUST_PROXY_HEADERS"];
    // A spoofed header must NOT mint a fresh bucket — that is how a limiter
    // gets bypassed and a brute-force ceiling disappears.
    const a = clientKey(new Request("http://x", { headers: { "x-forwarded-for": "1.1.1.1" } }), "login");
    const b = clientKey(new Request("http://x", { headers: { "x-forwarded-for": "2.2.2.2" } }), "login");
    expect(a).toBe(b);
  });

  it("honours X-Forwarded-For only when a trusted proxy is declared", () => {
    process.env["TRUST_PROXY_HEADERS"] = "true";
    const a = clientKey(new Request("http://x", { headers: { "x-forwarded-for": "1.1.1.1" } }), "login");
    const b = clientKey(new Request("http://x", { headers: { "x-forwarded-for": "2.2.2.2" } }), "login");
    expect(a).not.toBe(b);
  });
});

describe("concurrency gate", () => {
  it("never runs more than the configured number at once", async () => {
    const gate = new ConcurrencyGate(2);
    let concurrent = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 12 }, () =>
        gate.run(async () => {
          concurrent += 1;
          peak = Math.max(peak, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 5));
          concurrent -= 1;
        }),
      ),
    );

    expect(peak).toBeLessThanOrEqual(2);
  });

  it("releases its slot when the work throws", async () => {
    const gate = new ConcurrencyGate(1);
    await expect(gate.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(gate.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
    expect(gate.inFlight).toBe(0);
  });
});

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("a-sufficiently-long-password");
    expect(await verifyPassword("a-sufficiently-long-password", hash)).toBe(true);
    expect(await verifyPassword("a-sufficiently-long-passwore", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts, so identical passwords hash differently", async () => {
    const a = await hashPassword("identical-password-here");
    const b = await hashPassword("identical-password-here");
    expect(a).not.toBe(b);
    expect(await verifyPassword("identical-password-here", a)).toBe(true);
    expect(await verifyPassword("identical-password-here", b)).toBe(true);
  });

  it("never stores the plaintext", async () => {
    const hash = await hashPassword("plaintext-should-not-appear");
    expect(hash).not.toContain("plaintext-should-not-appear");
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it("refuses a short password", async () => {
    await expect(hashPassword("short")).rejects.toThrow();
  });

  it("returns false rather than throwing on a corrupt stored hash", async () => {
    expect(await verifyPassword("anything", "garbage")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$x$y$z$q$r")).toBe(false);
  });
});

describe("role permissions", () => {
  it("gives owners everything", () => {
    for (const permission of PERMISSIONS) expect(hasPermission("owner", permission)).toBe(true);
  });

  it("denies staff every privileged capability the brief lists", () => {
    // The exact list from the requirements: staff may not view credentials,
    // change payment or security settings, delete audit history, or promote
    // themselves.
    expect(hasPermission("staff", "settings.manage")).toBe(false);
    expect(hasPermission("staff", "pricing.manage")).toBe(false);
    expect(hasPermission("staff", "limits.manage")).toBe(false);
    expect(hasPermission("staff", "users.manage")).toBe(false);
    expect(hasPermission("staff", "audit.view")).toBe(false);
    expect(hasPermission("staff", "refunds.issue")).toBe(false);
    expect(hasPermission("staff", "experiences.manage")).toBe(false);
    expect(hasPermission("staff", "revenue.view")).toBe(false);
  });

  it("lets staff honour a deletion request, as the privacy notice promises", () => {
    expect(hasPermission("staff", "orders.delete_photo")).toBe(true);
    expect(hasPermission("owner", "orders.delete_photo")).toBe(true);
  });

  it("gives staff the operational capabilities they need at the counter", () => {
    expect(hasPermission("staff", "orders.view")).toBe(true);
    expect(hasPermission("staff", "orders.assist")).toBe(true);
    expect(hasPermission("staff", "orders.regenerate_qr")).toBe(true);
    expect(hasPermission("staff", "orders.request_refund")).toBe(true);
    expect(hasPermission("staff", "kiosk.reset")).toBe(true);
  });
});

describe("audit redaction", () => {
  it("redacts anything that looks like a credential", () => {
    const output = sanitizeMetadata({
      apiKey: "sk_live_should_never_appear",
      api_key: "another",
      token: "tok_secret",
      password: "hunter2",
      client_secret: "cs_secret",
      stripe_signature: "t=1,v1=abc",
      email: "customer@example.com",
      safeField: "keep me",
    }) as Record<string, unknown>;

    expect(output["apiKey"]).toBe("[redacted]");
    expect(output["api_key"]).toBe("[redacted]");
    expect(output["token"]).toBe("[redacted]");
    expect(output["password"]).toBe("[redacted]");
    expect(output["client_secret"]).toBe("[redacted]");
    expect(output["stripe_signature"]).toBe("[redacted]");
    expect(output["email"]).toBe("[redacted]");
    expect(output["safeField"]).toBe("keep me");

    expect(JSON.stringify(output)).not.toContain("sk_live_should_never_appear");
    expect(JSON.stringify(output)).not.toContain("hunter2");
  });

  it("redacts nested credentials too", () => {
    const output = sanitizeMetadata({ provider: { response: { apiKey: "sk_live_nested" } } });
    expect(JSON.stringify(output)).not.toContain("sk_live_nested");
  });

  it("truncates long strings and deep structures", () => {
    const long = sanitizeMetadata({ note: "x".repeat(2000) }) as Record<string, string>;
    expect(long["note"]!.length).toBeLessThan(600);
    expect(sanitizeMetadata({ a: { b: { c: { d: { e: { f: 1 } } } } } })).toBeDefined();
  });
});

describe("provider error normalisation", () => {
  it("maps Decart SDK codes onto stable codes", () => {
    expect(normalizeDecartError({ code: "INVALID_API_KEY" })).toBe("AI_INVALID_CREDENTIALS");
    expect(normalizeDecartError({ code: "TOKEN_CREATE_ERROR" })).toBe("AI_TOKEN_FAILED");
    expect(normalizeDecartError({ code: "MODEL_NOT_FOUND" })).toBe("AI_MODEL_UNAVAILABLE");
    expect(normalizeDecartError({ code: "WEBRTC_TIMEOUT_ERROR" })).toBe("AI_CONNECT_TIMEOUT");
    expect(normalizeDecartError({ code: "WEBRTC_ICE_ERROR" })).toBe("AI_CONNECT_FAILED");
    expect(normalizeDecartError({ code: "LIVEKIT_INITIALIZATION_ERROR" })).toBe("AI_CONNECT_FAILED");
  });

  it("falls back to message inspection", () => {
    expect(normalizeDecartError(new Error("request timed out"))).toBe("AI_CONNECT_TIMEOUT");
    expect(normalizeDecartError(new Error("429 rate limit exceeded"))).toBe("AI_RATE_LIMITED");
    expect(normalizeDecartError(new Error("401 unauthorized"))).toBe("AI_INVALID_CREDENTIALS");
    expect(normalizeDecartError(new Error("fetch failed"))).toBe("AI_CONNECT_FAILED");
  });

  it("never throws, whatever it is handed", () => {
    expect(normalizeDecartError(null)).toBe("AI_UNKNOWN");
    expect(normalizeDecartError(undefined)).toBe("AI_UNKNOWN");
    expect(normalizeDecartError("a bare string")).toBe("AI_UNKNOWN");
    expect(normalizeDecartError(12345)).toBe("AI_UNKNOWN");
  });

  it("marks transient failures retryable and credential failures not", () => {
    expect(isRetryable("AI_CONNECT_TIMEOUT")).toBe(true);
    expect(isRetryable("AI_DISCONNECTED")).toBe(true);
    expect(isRetryable("AI_INVALID_CREDENTIALS")).toBe(false);
    expect(isRetryable("AI_TOKEN_FAILED")).toBe(false);
  });
});

describe("storage path safety", () => {
  it("accepts server-generated keys", () => {
    expect(() => assertSafeStoragePath("orders/2026-08-03/uuid/file.jpg")).not.toThrow();
  });

  it("rejects traversal and absolute paths", () => {
    expect(() => assertSafeStoragePath("../../etc/passwd")).toThrow();
    expect(() => assertSafeStoragePath("orders/../../../secret")).toThrow();
    expect(() => assertSafeStoragePath("/etc/passwd")).toThrow();
    expect(() => assertSafeStoragePath("orders/x\0.jpg")).toThrow();
    expect(() => assertSafeStoragePath("orders/file name.jpg")).toThrow();
  });
});
