/**
 * In-process fixed-window rate limiter.
 *
 * Sized for the actual deployment: one supervised iPad behind one origin. It
 * protects the endpoints that cost money or leak information if hammered —
 * checkout creation, AI token minting, admin login, delivery downloads.
 *
 * The honest limitation: state is per-process, so it degrades on a multi-
 * instance deploy. That is recorded in docs/SECURITY.md as a known risk with
 * the upgrade path (a shared store) rather than pretending otherwise. Since the
 * expensive operations are additionally gated by server-side order state, a
 * bypass here still cannot obtain a paid AI session.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

/** Bounded so a flood of distinct keys cannot grow the map without limit. */
const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowSeconds: number, now = Date.now()): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) evictExpired(now);
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

function evictExpired(now: number): void {
  for (const [key, window] of buckets) {
    if (window.resetAt <= now) buckets.delete(key);
  }
  // Still full of live windows: drop the oldest to stay bounded.
  if (buckets.size >= MAX_BUCKETS) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt).slice(0, MAX_BUCKETS / 10);
    for (const [key] of oldest) buckets.delete(key);
  }
}

/** Test helper. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Client identity for rate limiting.
 *
 * `x-forwarded-for` is attacker-controlled unless a trusted proxy sets it. Taking
 * it at face value hands out a fresh, empty bucket per request — which removes
 * the limiter entirely, and with it the brute-force ceiling on the admin
 * password. So it is only honoured when TRUST_PROXY_HEADERS is explicitly set,
 * which is the deployer asserting that a proxy overwrites it.
 *
 * When it is not trusted, every caller shares one bucket. That is the correct
 * shape for this product — the kiosk is a single device behind a single IP — but
 * it means a flood could exhaust a shared window, so the endpoints that matter
 * carry a second, IP-independent ceiling (see `globalLimit`) and their real
 * protection is server-side order state, not this.
 */
export function clientKey(request: Request, salt: string): string {
  const trustProxy = process.env["TRUST_PROXY_HEADERS"] === "true";
  if (!trustProxy) return `${salt}:shared`;

  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return `${salt}:${ip}`;
}

/**
 * An IP-independent ceiling, for endpoints whose cost is high enough that
 * per-client limiting is not sufficient on its own.
 */
export function globalLimit(name: string, limit: number, windowSeconds: number): RateLimitResult {
  return rateLimit(`global:${name}`, limit, windowSeconds);
}

/**
 * Caps how many expensive operations run at once.
 *
 * scrypt is memory-hard *by design*: each verification allocates tens of
 * megabytes and occupies a libuv threadpool slot (default size 4) that also
 * serves file reads. Without a gate, a few dozen concurrent login attempts
 * exhaust both — the process OOMs or the event loop starves, and a customer who
 * already paid through Stripe gets nothing. The gate is what keeps a login
 * flood from becoming a kiosk outage.
 */
export class ConcurrencyGate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  get inFlight(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiting.length;
  }
}
