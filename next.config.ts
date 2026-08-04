import type { NextConfig } from "next";

/**
 * Hosts the Decart SDK talks to. Realtime is LiveKit-backed, so the signaling
 * socket lands on a LiveKit host handed to us at runtime — we cannot enumerate
 * it, only its domains. Overridable via CSP_EXTRA_CONNECT_SRC for self-hosted
 * or regional Decart endpoints.
 */
const DECART_CONNECT_SRC = [
  "https://api.decart.ai",
  "https://*.decart.ai",
  "wss://*.decart.ai",
  "wss://*.livekit.cloud",
];

function contentSecurityPolicy(): string {
  const isDev = process.env.NODE_ENV !== "production";
  const extra = (process.env.CSP_EXTRA_CONNECT_SRC ?? "").split(/\s+/).filter(Boolean);

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next.js injects inline bootstrap scripts; 'unsafe-eval' is dev-only (React Refresh).
    // 'wasm-unsafe-eval' lets demo mode instantiate MediaPipe's WebAssembly for
    // on-device segmentation and face tracking. It permits WASM compilation only
    // — it does NOT re-enable eval() for JavaScript.
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      "'wasm-unsafe-eval'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    // blob: — transformed frames rendered from MediaStream captures.
    // data: — server-rendered QR codes are inlined as data URIs.
    "img-src": ["'self'", "data:", "blob:"],
    "media-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", "blob:", ...DECART_CONNECT_SRC, ...extra],
    // Stripe Checkout is a full redirect, not an iframe — nothing may embed us.
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };

  if (!isDev) directives["upgrade-insecure-requests"] = [];

  return Object.entries(directives)
    .map(([key, values]) => (values.length ? `${key} ${values.join(" ")}` : key))
    .join("; ");
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The dev overlay badge sits on top of the kiosk's bottom-left corner and
  // lands in every design screenshot. The kiosk is a full-bleed surface; there
  // is nowhere for it to go.
  devIndicators: false,
  // Fail the production build on type or lint errors rather than shipping them.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            // The kiosk needs the camera; nothing else, and nobody else.
            value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
