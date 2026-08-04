import "server-only";
import { isDemoMode } from "@/lib/env";
import type { AiProvider } from "@/lib/ai/provider";
import { decartProvider } from "@/lib/ai/decart.server";
import { mockAiProvider } from "@/lib/ai/mock.server";

/** Resolves the active AI provider. Demo mode never touches Decart. */
export function getAiProvider(): AiProvider {
  return isDemoMode() ? mockAiProvider : decartProvider;
}
