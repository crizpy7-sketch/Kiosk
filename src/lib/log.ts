/**
 * Structured server logging. One JSON object per line — greppable in Vercel /
 * Supabase logs without a log-shipping dependency.
 *
 * Everything passed through here is redacted first. Kiosk logs are read over
 * someone's shoulder at a boutique counter; treat them as semi-public.
 */

type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE = /(api[_-]?key|secret|token|password|authorization|cookie|signature|sk_live|sk_test|whsec_)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    // Catch bare credentials that arrive as values rather than under a key name.
    if (/^(sk_|rk_|whsec_|ek_|eyJ)/.test(value)) return "[redacted]";
    return value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), stack: undefined };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE.test(key) ? "[redacted]" : redact(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const payload = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (message: string, context?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== "production") emit("debug", message, context);
  },
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};
