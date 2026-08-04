"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { log } from "@/lib/log";
import {
  ForbiddenError,
  requirePermission,
  UnauthenticatedError,
  type AdminIdentity,
} from "@/lib/auth/session.server";
import {
  failOrder,
  getOrderById,
  markHelped,
  setStaffNote,
  transitionOrder,
} from "@/lib/orders/repository";
import { mayRefund } from "@/lib/orders/state-machine";
import { getPaymentProvider } from "@/lib/payments/index.server";
import { regenerateDelivery } from "@/lib/delivery/service";
import { getStorage } from "@/lib/storage/index.server";
import {
  getLatestAssetForOrder,
  markAssetDeleted,
  setAllExperiencePrices,
  setExperienceActive,
  setKioskDailyLimit,
  setSetting,
} from "@/lib/db/repositories";
import { createUser, listUsers, setUserActive } from "@/lib/auth/session.server";
import { hashPassword } from "@/lib/auth/passwords";

/**
 * Admin server actions.
 *
 * Every one of these starts with `requirePermission`. That call is the
 * authorization boundary — not the route the action was invoked from, and
 * certainly not whether the button was rendered. A staff member who crafts a
 * request for an owner-only action gets a ForbiddenError, and the attempt is
 * audited.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
}

async function guarded<T extends ActionResult>(
  permission: Parameters<typeof requirePermission>[0],
  run: (identity: AdminIdentity) => Promise<T>,
): Promise<T | ActionResult> {
  try {
    const identity = await requirePermission(permission);
    return await run(identity);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, message: "Please sign in again." };
    }
    if (error instanceof ForbiddenError) {
      log.warn("admin.forbidden", { permission });
      await recordAudit({
        actorLabel: "admin",
        eventType: "admin.permission_denied",
        metadata: { permission },
      }).catch(() => undefined);
      return { ok: false, message: "You don't have permission to do that." };
    }
    log.error("admin.action_failed", { permission, error });
    return { ok: false, message: "That didn't work. Please try again." };
  }
}

// ------------------------------------------------------------------ orders --

/** Staff action: flags an order for the owner to refund. Moves no money. */
export async function requestRefundAction(orderId: string, reason: string): Promise<ActionResult> {
  return guarded("orders.request_refund", async (identity) => {
    const order = await getOrderById(orderId);
    if (!order) return { ok: false, message: "Order not found." };
    if (!mayRefund(order.status)) return { ok: false, message: "That order can't be refunded." };

    await transitionOrder(orderId, "refund_pending", {
      actorUserId: identity.userId,
      actorLabel: identity.role,
      auditMetadata: { reason: reason.slice(0, 300) },
    });

    revalidatePath("/admin/orders");
    return { ok: true, message: "Refund requested. An owner can now complete it." };
  });
}

/**
 * Owner action: actually refunds through the payment provider.
 *
 * The provider call comes first. Only a confirmed refund moves the order to
 * `refunded` — marking it refunded on a failed API call would tell the owner a
 * customer got their money back when they did not.
 */
export async function completeRefundAction(orderId: string): Promise<ActionResult> {
  return guarded("refunds.issue", async (identity) => {
    const order = await getOrderById(orderId);
    if (!order) return { ok: false, message: "Order not found." };
    if (!order.stripe_payment_intent_id) {
      return { ok: false, message: "No payment on file for this order — nothing to refund." };
    }
    if (order.status !== "refund_pending") {
      if (!mayRefund(order.status)) return { ok: false, message: "That order can't be refunded." };
      await transitionOrder(orderId, "refund_pending", {
        actorUserId: identity.userId,
        actorLabel: identity.role,
        auditMetadata: { reason: "owner_direct" },
      });
    }

    const provider = getPaymentProvider();
    const result = await provider.refund(order.stripe_payment_intent_id, order.price_cents);

    if (result.status === "failed") {
      await recordAudit({
        actorUserId: identity.userId,
        actorLabel: identity.role,
        orderId,
        eventType: "refund.failed",
        metadata: { provider: provider.name },
      });
      return { ok: false, message: "The payment provider rejected the refund." };
    }

    if (result.status === "succeeded") {
      await transitionOrder(orderId, "refunded", {
        refundedAt: new Date(),
        actorUserId: identity.userId,
        actorLabel: identity.role,
        auditMetadata: { provider: provider.name, refundId: result.id },
      });
    }

    revalidatePath("/admin/orders");
    return {
      ok: true,
      message:
        result.status === "succeeded"
          ? "Refunded."
          : "Refund submitted — it will settle shortly and confirm by webhook.",
    };
  });
}

export async function regenerateQrAction(orderId: string): Promise<ActionResult> {
  return guarded("orders.regenerate_qr", async (identity) => {
    const order = await getOrderById(orderId);
    if (!order) return { ok: false, message: "Order not found." };

    const delivery = await regenerateDelivery(order);
    if (!delivery) return { ok: false, message: "There's no photo stored for this order." };

    await recordAudit({
      actorUserId: identity.userId,
      actorLabel: identity.role,
      orderId,
      eventType: "delivery.qr_regenerated",
      metadata: { assetId: delivery.assetId, expiresAt: delivery.expiresAt.toISOString() },
    });

    return {
      ok: true,
      message: `New link created. It expires in ${delivery.expiresInHours} hours; the previous link no longer works.`,
      data: { qrDataUri: delivery.qrDataUri, downloadUrl: delivery.downloadUrl },
    };
  });
}

/**
 * Deletes a customer's photo on request, immediately.
 *
 * The kiosk's privacy notice and the customer's own download page both promise
 * "ask a team member to delete this any time". This is the action that keeps
 * that promise — without it, the only deletion path is the hourly expiry job,
 * and staff would have nothing to offer someone standing at the counter asking.
 *
 * Bytes go first, then the tombstone, so a crash between the two leaves a
 * retryable state rather than a row claiming a deletion that did not happen.
 */
export async function deletePhotoAction(orderId: string, reason: string): Promise<ActionResult> {
  return guarded("orders.delete_photo", async (identity) => {
    const asset = await getLatestAssetForOrder(orderId);
    if (!asset) return { ok: false, message: "There's no photo stored for this order." };

    await getStorage().delete(asset.private_storage_path);
    await markAssetDeleted(asset.id);

    await recordAudit({
      actorUserId: identity.userId,
      actorLabel: identity.role,
      orderId,
      eventType: "asset.deleted_on_request",
      metadata: { assetId: asset.id, reason: reason.slice(0, 300) },
    });

    revalidatePath("/admin/orders");
    return { ok: true, message: "Photo deleted. The download link no longer works." };
  });
}

export async function markHelpedAction(orderId: string, note: string): Promise<ActionResult> {
  return guarded("orders.mark_helped", async (identity) => {
    await markHelped(orderId);
    if (note.trim()) await setStaffNote(orderId, note.slice(0, 500));

    await recordAudit({
      actorUserId: identity.userId,
      actorLabel: identity.role,
      orderId,
      eventType: "order.marked_helped",
      metadata: { hasNote: Boolean(note.trim()) },
    });

    revalidatePath("/admin/orders");
    return { ok: true, message: "Marked as helped." };
  });
}

/** Re-authorizes a failed but paid order so the customer can try again free. */
export async function retryOrderAction(orderId: string): Promise<ActionResult> {
  return guarded("orders.assist", async (identity) => {
    const order = await getOrderById(orderId);
    if (!order) return { ok: false, message: "Order not found." };
    if (order.status !== "failed") return { ok: false, message: "Only failed orders can be retried." };
    if (!order.paid_at) return { ok: false, message: "That order was never paid." };

    await transitionOrder(orderId, "generation_authorized", {
      errorCode: null,
      actorUserId: identity.userId,
      actorLabel: identity.role,
      auditMetadata: { reason: "staff_retry" },
    });

    revalidatePath("/admin/orders");
    return { ok: true, message: "Re-authorized. Ask the customer to start again at the kiosk." };
  });
}

export async function markFailedAction(orderId: string, errorCode: string): Promise<ActionResult> {
  return guarded("orders.assist", async (identity) => {
    await failOrder(orderId, errorCode.slice(0, 60) || "STAFF_MARKED_FAILED", {
      actorLabel: identity.role,
    });
    revalidatePath("/admin/orders");
    return { ok: true, message: "Marked as failed." };
  });
}

// ------------------------------------------------------------ experiences --

export async function toggleExperienceAction(experienceId: string, active: boolean): Promise<ActionResult> {
  return guarded("experiences.manage", async (identity) => {
    await setExperienceActive(experienceId, active);
    await recordAudit({
      actorUserId: identity.userId,
      actorLabel: identity.role,
      eventType: "experience.toggled",
      metadata: { experienceId, active },
    });
    revalidatePath("/admin/experiences");
    revalidatePath("/kiosk");
    return { ok: true, message: active ? "Style enabled." : "Style disabled." };
  });
}

const priceSchema = z.number().int().min(100).max(9999);

export async function setPriceAction(priceCents: number): Promise<ActionResult> {
  return guarded("pricing.manage", async (identity) => {
    const parsed = priceSchema.safeParse(priceCents);
    if (!parsed.success) return { ok: false, message: "Price must be between $1.00 and $99.99." };

    await setAllExperiencePrices(parsed.data);
    await recordAudit({
      actorUserId: identity.userId,
      actorLabel: identity.role,
      eventType: "pricing.changed",
      metadata: { priceCents: parsed.data },
    });

    revalidatePath("/admin/settings");
    revalidatePath("/kiosk");
    return { ok: true, message: `Price is now $${(parsed.data / 100).toFixed(2)}.` };
  });
}

// ------------------------------------------------------------------ limits --

export async function setDailyLimitAction(seconds: number): Promise<ActionResult> {
  return guarded("limits.manage", async (identity) => {
    if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86_400) {
      return { ok: false, message: "Daily limit must be between 60 and 86,400 seconds." };
    }

    await setKioskDailyLimit(getEnv().KIOSK_ID, seconds);
    await recordAudit({
      actorUserId: identity.userId,
      actorLabel: identity.role,
      kioskId: getEnv().KIOSK_ID,
      eventType: "limits.changed",
      metadata: { dailyAiLimitSeconds: seconds },
    });

    revalidatePath("/admin");
    revalidatePath("/admin/settings");
    return { ok: true, message: "Daily AI limit updated." };
  });
}

export async function setDownloadTtlAction(hours: number): Promise<ActionResult> {
  return guarded("settings.manage", async (identity) => {
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
      return { ok: false, message: "Expiry must be between 1 and 168 hours." };
    }

    // Applies to links created from here on; existing assets keep their expiry.
    await setSetting("download_ttl_hours", hours);
    await recordAudit({
      actorUserId: identity.userId,
      actorLabel: identity.role,
      eventType: "settings.download_ttl_changed",
      metadata: { hours },
    });

    revalidatePath("/admin/settings");
    return { ok: true, message: `New links will expire after ${hours} hours.` };
  });
}

// ------------------------------------------------------------------- users --

const newUserSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(12).max(200),
  role: z.enum(["owner", "staff"]),
});

export async function createUserAction(
  email: string,
  password: string,
  role: "owner" | "staff",
): Promise<ActionResult> {
  return guarded("users.manage", async (identity) => {
    const parsed = newUserSchema.safeParse({ email, password, role });
    if (!parsed.success) {
      return { ok: false, message: "Check the email and use a password of at least 12 characters." };
    }

    const existing = (await listUsers()).find((u) => u.email.toLowerCase() === parsed.data.email.toLowerCase());
    if (existing) return { ok: false, message: "That email already has an account." };

    await createUser({
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
      role: parsed.data.role,
    });

    await recordAudit({
      actorUserId: identity.userId,
      actorLabel: identity.role,
      eventType: "user.created",
      // The new account's email is deliberately not recorded: the audit log is
      // read on screen in a shop, and sanitizeMetadata would redact it anyway.
      metadata: { role: parsed.data.role },
    });

    revalidatePath("/admin/settings");
    return { ok: true, message: `${parsed.data.role === "owner" ? "Owner" : "Staff"} account created.` };
  });
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<ActionResult> {
  return guarded("users.manage", async (identity) => {
    // Nobody may lock themselves out, and an owner cannot be left unable to
    // reach the dashboard by their own click.
    if (userId === identity.userId) {
      return { ok: false, message: "You can't deactivate your own account." };
    }

    await setUserActive(userId, active);
    await recordAudit({
      actorUserId: identity.userId,
      actorLabel: identity.role,
      eventType: active ? "user.activated" : "user.deactivated",
      metadata: { targetUserId: userId },
    });

    revalidatePath("/admin/settings");
    return { ok: true, message: active ? "Account activated." : "Account deactivated." };
  });
}
