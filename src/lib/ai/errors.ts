import type { AiErrorCode } from "@/lib/ai/provider";

/**
 * Normalises anything a provider (or the network) throws into our stable code
 * set. Shared by the server token route and the browser realtime session, which
 * is why it lives apart from the server-only Decart module.
 */
export function normalizeDecartError(error: unknown): AiErrorCode {
  const code = extractCode(error);
  const message = extractMessage(error).toLowerCase();

  switch (code) {
    case "INVALID_API_KEY":
      return "AI_INVALID_CREDENTIALS";
    case "TOKEN_CREATE_ERROR":
      return "AI_TOKEN_FAILED";
    case "MODEL_NOT_FOUND":
      return "AI_MODEL_UNAVAILABLE";
    case "WEBRTC_TIMEOUT_ERROR":
      return "AI_CONNECT_TIMEOUT";
    case "WEBRTC_WEBSOCKET_ERROR":
    case "WEBRTC_ICE_ERROR":
    case "WEBRTC_SIGNALING_ERROR":
    case "LIVEKIT_INITIALIZATION_ERROR":
      return "AI_CONNECT_FAILED";
    case "WEBRTC_SERVER_ERROR":
    case "PROCESSING_ERROR":
      return "AI_UNKNOWN";
    default:
      break;
  }

  if (message.includes("timeout") || message.includes("timed out")) return "AI_CONNECT_TIMEOUT";
  if (message.includes("rate limit") || message.includes("429")) return "AI_RATE_LIMITED";
  if (message.includes("unauthorized") || message.includes("401") || message.includes("403")) {
    return "AI_INVALID_CREDENTIALS";
  }
  if (message.includes("network") || message.includes("fetch failed") || message.includes("econnrefused")) {
    return "AI_CONNECT_FAILED";
  }

  return "AI_UNKNOWN";
}

function extractCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error ?? "");
}

/** Customer-facing severity: can staff retry this, or is it terminal? */
export function isRetryable(code: AiErrorCode): boolean {
  return (
    code === "AI_CONNECT_TIMEOUT" ||
    code === "AI_CONNECT_FAILED" ||
    code === "AI_DISCONNECTED" ||
    code === "AI_RATE_LIMITED" ||
    code === "AI_UNKNOWN"
  );
}
