import { NextResponse } from "next/server";
import { handleApiError, ok } from "@/lib/api/respond";
import { destroySession, getAdminIdentity } from "@/lib/auth/session.server";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    const identity = await getAdminIdentity();
    await destroySession();

    if (identity) {
      await recordAudit({
        actorUserId: identity.userId,
        actorLabel: identity.email,
        eventType: "admin.logout",
      });
    }

    return ok({ signedOut: true });
  } catch (error) {
    return handleApiError("POST /api/admin/logout", error);
  }
}
