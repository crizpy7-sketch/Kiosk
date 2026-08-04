/**
 * AI provider abstraction.
 *
 * Decart Lucy is the launch provider, but the kiosk should not have to be
 * rewritten to add or swap one. The split is deliberate:
 *
 *   - The *server* half (AiProvider) mints short-lived client credentials and
 *     normalises errors. It is the only place a permanent API key exists.
 *   - The *browser* half (RealtimeSession) owns the WebRTC lifecycle. It never
 *     sees a permanent key — only the short-lived token the server issued.
 */

import type { Experience } from "@/lib/config/experiences";

/** Provider-agnostic error codes. The UI maps these to customer-facing copy. */
export const AI_ERROR_CODES = [
  "AI_TOKEN_FAILED",
  "AI_CONNECT_TIMEOUT",
  "AI_CONNECT_FAILED",
  "AI_DISCONNECTED",
  "AI_MODEL_UNAVAILABLE",
  "AI_RATE_LIMITED",
  "AI_INVALID_CREDENTIALS",
  "AI_CAPTURE_FAILED",
  "AI_SESSION_TIMEOUT",
  "AI_UNKNOWN",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

/** What the server hands the browser. Deliberately minimal and short-lived. */
export interface ClientSessionGrant {
  /** Short-lived provider credential. Never the account key. */
  clientToken: string;
  /** ISO timestamp. The browser must not attempt a connection after this. */
  expiresAt: string;
  model: string;
  /** Prompt resolved server-side from the chosen experience. */
  prompt: string;
  /** Hard cap the provider itself enforces, in seconds. */
  maxSessionSeconds: number;
  provider: string;
  /** Our own generation_sessions row id, echoed back when reporting usage. */
  generationSessionId: string;
}

export interface CreateClientSessionInput {
  experience: Experience;
  maxSessionSeconds: number;
  /** Origin the token is pinned to, when the provider supports it. */
  allowedOrigin: string;
  /** Opaque correlation id; must not contain customer data. */
  reference: string;
}

export interface UsageReport {
  billableSeconds: number;
  providerSessionId?: string | null;
  status: "completed" | "failed" | "timeout" | "canceled";
  errorCode?: AiErrorCode | null;
}

export interface AiProvider {
  readonly name: string;
  /** Mints a restricted, short-lived credential for one kiosk session. */
  createClientSession(input: CreateClientSessionInput): Promise<Omit<ClientSessionGrant, "generationSessionId">>;
  /** Maps whatever the provider threw onto our stable code set. */
  normalizeProviderError(error: unknown): AiErrorCode;
}

/** Browser-side realtime handle. Implemented per provider in src/lib/ai/realtime/. */
export interface RealtimeSession {
  /** Resolves once transformed frames are flowing. */
  connect(): Promise<void>;
  /** Swaps the active style without reconnecting. */
  applyExperience(prompt: string): Promise<void>;
  /** Grabs the current transformed frame as a JPEG. */
  captureFrame(): Promise<Blob>;
  /** Idempotent. Safe to call from cleanup paths and error handlers. */
  disconnect(): void;
  /** Seconds of generation the provider has billed so far. */
  billableSeconds(): number;
  readonly providerSessionId: string | null;
}
