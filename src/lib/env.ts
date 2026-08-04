import "server-only";
import { z } from "zod";

/**
 * Server-only environment. Importing this module from a client component is a
 * build error by design (it reads secrets). Anything the browser legitimately
 * needs is exposed through `publicConfig` in src/lib/public-config.ts, which is
 * assembled server-side and passed down as props.
 */

const booleanish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0", ""])])
  .transform((v) => v === true || v === "true" || v === "1");

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_BASE_URL: z.url().default("http://localhost:3000"),

    /**
     * Demo mode swaps Stripe and Decart for local adapters: no charge, no
     * credits consumed. It is refused in production unless someone
     * deliberately sets ALLOW_DEMO_MODE_IN_PRODUCTION — see the refinement below.
     */
    DEMO_MODE: booleanish.default(false),
    ALLOW_DEMO_MODE_IN_PRODUCTION: booleanish.default(false),

    DATABASE_URL: z.string().min(1),

    // Supabase is optional: only needed when STORAGE_DRIVER=supabase.
    SUPABASE_URL: z.url().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    DECART_API_KEY: z.string().optional(),

    STORAGE_DRIVER: z.enum(["filesystem", "supabase"]).default("filesystem"),
    STORAGE_BUCKET: z.string().default("wildframe-private"),
    STORAGE_LOCAL_DIR: z.string().default(".data/assets"),

    DOWNLOAD_LINK_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    SESSION_MAX_SECONDS: z.coerce.number().int().min(5).max(120).default(15),
    COUNTDOWN_SECONDS: z.coerce.number().int().min(0).max(10).default(3),
    KIOSK_ID: z.string().min(1).default("kiosk-shia-baby-01"),
    DEFAULT_LANGUAGE: z.enum(["en", "es"]).default("en"),
    ATTRACT_TIMEOUT_SECONDS: z.coerce.number().int().min(15).max(600).default(90),

    /** 32+ byte secret used to sign admin session cookies and delivery tokens. */
    APP_SECRET: z.string().min(32),

    CSP_EXTRA_CONNECT_SRC: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const demoAllowed = env.NODE_ENV !== "production" || env.ALLOW_DEMO_MODE_IN_PRODUCTION;
    if (env.DEMO_MODE && !demoAllowed) {
      ctx.addIssue({
        code: "custom",
        path: ["DEMO_MODE"],
        message:
          "DEMO_MODE cannot be enabled in production. Set ALLOW_DEMO_MODE_IN_PRODUCTION=true only for a deliberate on-stage demo build.",
      });
    }

    // Live mode must have real credentials — an unconfigured kiosk that takes
    // money is worse than one that refuses to start.
    if (!env.DEMO_MODE) {
      if (!env.STRIPE_SECRET_KEY) {
        ctx.addIssue({ code: "custom", path: ["STRIPE_SECRET_KEY"], message: "Required when DEMO_MODE is off." });
      }
      if (!env.STRIPE_WEBHOOK_SECRET) {
        ctx.addIssue({ code: "custom", path: ["STRIPE_WEBHOOK_SECRET"], message: "Required when DEMO_MODE is off." });
      }
      if (!env.DECART_API_KEY) {
        ctx.addIssue({ code: "custom", path: ["DECART_API_KEY"], message: "Required when DEMO_MODE is off." });
      }
    }

    if (env.STORAGE_DRIVER === "supabase") {
      if (!env.SUPABASE_URL) {
        ctx.addIssue({ code: "custom", path: ["SUPABASE_URL"], message: "Required when STORAGE_DRIVER=supabase." });
      }
      if (!env.SUPABASE_SERVICE_ROLE_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["SUPABASE_SERVICE_ROLE_KEY"],
          message: "Required when STORAGE_DRIVER=supabase.",
        });
      }
    }

    // iPadOS only grants camera access on a secure context. Loopback counts as
    // secure to browsers, so a local production build (E2E, smoke tests) is
    // exempt; anything else served over plain HTTP would fail at the camera
    // step in front of a paying customer, so refuse to boot instead.
    if (env.NODE_ENV === "production" && env.APP_BASE_URL.startsWith("http://")) {
      const host = URL.parse(env.APP_BASE_URL)?.hostname ?? "";
      const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
      if (!isLoopback) {
        ctx.addIssue({
          code: "custom",
          path: ["APP_BASE_URL"],
          message: "Production must be served over HTTPS — iPadOS blocks camera access on insecure origins.",
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/** Parses and caches process.env. Throws a readable aggregate error on misconfiguration. */
export function getEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(
      `Invalid environment configuration:\n${lines.join("\n")}\n\nSee .env.example and README.md#environment-variables.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: forget the cached parse so a test can swap process.env. */
export function resetEnvCache(): void {
  cached = null;
}

/** True when payment and AI are simulated locally. */
export function isDemoMode(): boolean {
  return getEnv().DEMO_MODE;
}
