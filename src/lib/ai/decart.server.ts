import "server-only";
import { createDecartClient } from "@decartai/sdk";
import { getEnv } from "@/lib/env";
import { buildPrompt } from "@/lib/config/experiences";
import { normalizeDecartError } from "@/lib/ai/errors";
import {
  AiProviderError,
  type AiProvider,
  type ClientSessionGrant,
  type CreateClientSessionInput,
} from "@/lib/ai/provider";

/**
 * Decart Lucy — server half.
 *
 * The permanent DECART_API_KEY is read here and nowhere else. It never appears
 * in a client component, a prop, a response body, or a log line. What the
 * browser receives is a token from `client.tokens.create()`, which we pin to:
 *
 *   - one model      (allowedModels)
 *   - one origin     (allowedOrigins)
 *   - a short expiry (expiresIn — seconds until the token itself dies)
 *   - a hard session cap (constraints.realtime.maxSessionDuration — enforced by
 *     Decart, so a tampered browser cannot stream longer than we sold)
 *
 * Verified against @decartai/sdk 0.1.17.
 */

const PROVIDER_NAME = "decart";

/**
 * Grace on top of the generation window: the token must survive the customer
 * reading the countdown and the WebRTC handshake, but not much longer.
 */
const TOKEN_GRACE_SECONDS = 45;

function decartClient() {
  const env = getEnv();
  if (!env.DECART_API_KEY) {
    throw new AiProviderError("AI_INVALID_CREDENTIALS", "DECART_API_KEY is not configured.");
  }
  return createDecartClient({ apiKey: env.DECART_API_KEY });
}

export const decartProvider: AiProvider = {
  name: PROVIDER_NAME,

  async createClientSession(
    input: CreateClientSessionInput,
  ): Promise<Omit<ClientSessionGrant, "generationSessionId">> {
    const { experience, maxSessionSeconds, allowedOrigin, reference } = input;
    const model = experience.modelPreference;

    try {
      const token = await decartClient().tokens.create({
        // 1–3600s per the SDK contract; we stay at the short end.
        expiresIn: Math.min(3600, maxSessionSeconds + TOKEN_GRACE_SECONDS),
        allowedModels: [model],
        allowedOrigins: [allowedOrigin],
        constraints: { realtime: { maxSessionDuration: maxSessionSeconds } },
        // Correlation only — an order reference, never customer data.
        metadata: { reference, kiosk: getEnv().KIOSK_ID },
      });

      return {
        clientToken: token.apiKey,
        expiresAt: token.expiresAt,
        model,
        prompt: buildPrompt(experience),
        maxSessionSeconds,
        provider: PROVIDER_NAME,
      };
    } catch (error) {
      throw new AiProviderError(
        normalizeDecartError(error),
        "Could not create a Decart client session.",
        error,
      );
    }
  },

  normalizeProviderError: normalizeDecartError,
};
