import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { InvalidTransitionError } from "@/lib/orders/state-machine";
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/session.server";
import { AiProviderError } from "@/lib/ai/provider";
import { PaymentProviderError } from "@/lib/payments/provider";

/**
 * One place that turns a thrown error into an HTTP response.
 *
 * The contract: the body a client receives contains a stable machine code and a
 * short, non-technical message. Stack traces, SQL, provider payloads and
 * anything else that could help an attacker (or confuse a customer) stay in the
 * server log. There is no stack trace path to the kiosk screen.
 */

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export function ok<T extends object>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function fail(status: number, code: string, message: string, init?: ResponseInit): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message } },
    { ...init, status, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } },
  );
}

const GENERIC_MESSAGE = "Something went wrong. Please ask a team member for help.";

export function handleApiError(route: string, error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof UnauthenticatedError) {
    return fail(401, "UNAUTHENTICATED", "Please sign in.");
  }
  if (error instanceof ForbiddenError) {
    log.warn("api.forbidden", { route, message: error.message });
    return fail(403, "FORBIDDEN", "You don't have permission to do that.");
  }
  if (error instanceof InvalidTransitionError) {
    log.warn("api.invalid_transition", { route, from: error.from, to: error.to });
    return fail(409, "INVALID_TRANSITION", "That step isn't available right now.");
  }
  if (error instanceof AiProviderError) {
    log.error("api.ai_error", { route, code: error.code, error });
    return fail(502, error.code, "The AI service is unavailable right now.");
  }
  if (error instanceof PaymentProviderError) {
    log.error("api.payment_error", { route, code: error.code, error });
    return fail(502, error.code, "The payment service is unavailable right now.");
  }

  log.error("api.unhandled", { route, error });
  return fail(500, "INTERNAL_ERROR", GENERIC_MESSAGE);
}
