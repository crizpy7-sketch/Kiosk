import "server-only";
import { randomBytes } from "node:crypto";
import { buildPrompt } from "@/lib/config/experiences";
import {
  type AiProvider,
  type ClientSessionGrant,
  type CreateClientSessionInput,
} from "@/lib/ai/provider";
import { normalizeDecartError } from "@/lib/ai/errors";

/**
 * Demo AI provider. Consumes no Decart credits and reaches no network.
 *
 * The token it mints is a plainly-labelled fake so that a demo token found in a
 * log or a screenshot can never be mistaken for a live credential. The browser
 * side (src/lib/ai/realtime/mock.ts) recognises the prefix and renders a local
 * stylised effect over the camera instead of connecting to a provider.
 */
export const mockAiProvider: AiProvider = {
  name: "mock",

  async createClientSession(
    input: CreateClientSessionInput,
  ): Promise<Omit<ClientSessionGrant, "generationSessionId">> {
    return {
      clientToken: `demo_not_a_real_token_${randomBytes(12).toString("hex")}`,
      expiresAt: new Date(Date.now() + (input.maxSessionSeconds + 45) * 1000).toISOString(),
      model: input.experience.modelPreference,
      prompt: buildPrompt(input.experience),
      maxSessionSeconds: input.maxSessionSeconds,
      provider: "mock",
    };
  },

  normalizeProviderError: normalizeDecartError,
};
