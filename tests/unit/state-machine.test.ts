import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isOrderStatus,
  isPaid,
  isTerminal,
  mayRefund,
  mayRequestAiSession,
  mayRetake,
  ORDER_STATUSES,
  type OrderStatus,
} from "@/lib/orders/state-machine";

describe("order state machine", () => {
  it("covers every status with a transition list", () => {
    for (const status of ORDER_STATUSES) {
      expect(allowedTransitions(status)).toBeDefined();
    }
  });

  it("walks the happy path end to end", () => {
    const path: OrderStatus[] = [
      "created",
      "payment_pending",
      "paid",
      "consented",
      "generation_authorized",
      "generating",
      "captured",
      "completed",
      "delivered",
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("refuses to skip payment", () => {
    expect(canTransition("created", "paid")).toBe(false);
    expect(canTransition("created", "generation_authorized")).toBe(false);
    expect(canTransition("payment_pending", "generating")).toBe(false);
    expect(canTransition("payment_pending", "delivered")).toBe(false);
  });

  it("refuses to skip consent", () => {
    expect(canTransition("paid", "generation_authorized")).toBe(false);
    expect(canTransition("paid", "generating")).toBe(false);
  });

  it("cannot mark an order paid twice", () => {
    expect(canTransition("paid", "paid")).toBe(false);
  });

  it("has no self-transitions at all", () => {
    // A self-transition makes the repository's compare-and-set a no-op, which
    // let two concurrent retake requests each mint an AI token for one payment.
    for (const status of ORDER_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("treats deleted as fully terminal", () => {
    expect(allowedTransitions("deleted")).toHaveLength(0);
    expect(isTerminal("deleted")).toBe(true);
    expect(isTerminal("refunded")).toBe(true);
    expect(isTerminal("failed")).toBe(false);
  });

  it("throws a typed error with both endpoints", () => {
    expect(() => assertTransition("created", "delivered")).toThrow(InvalidTransitionError);
    try {
      assertTransition("created", "delivered");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect((error as InvalidTransitionError).from).toBe("created");
      expect((error as InvalidTransitionError).to).toBe("delivered");
    }
  });

  it("lets any post-payment state reach failure or a refund", () => {
    for (const status of ["paid", "consented", "generation_authorized", "generating", "captured", "completed"] as const) {
      expect(canTransition(status, "failed")).toBe(true);
      expect(canTransition(status, "refund_pending")).toBe(true);
    }
  });

  describe("isPaid", () => {
    it("is true from payment through delivery", () => {
      for (const status of ["paid", "consented", "generation_authorized", "generating", "captured", "completed", "delivered"] as const) {
        expect(isPaid(status)).toBe(true);
      }
    });

    it("is false before payment and after a refund", () => {
      for (const status of ["created", "payment_pending", "failed", "expired", "refunded", "deleted"] as const) {
        expect(isPaid(status)).toBe(false);
      }
    });
  });

  describe("mayRequestAiSession — the gate protecting AI credits", () => {
    it("permits only generation_authorized and captured", () => {
      const allowed = ORDER_STATUSES.filter(mayRequestAiSession);
      expect(allowed).toEqual(["generation_authorized", "captured"]);
    });

    it("refuses every unpaid status", () => {
      for (const status of ["created", "payment_pending", "expired", "failed", "refunded", "deleted"] as const) {
        expect(mayRequestAiSession(status)).toBe(false);
      }
    });

    it("refuses a paid order that has not consented", () => {
      expect(mayRequestAiSession("paid")).toBe(false);
      expect(mayRequestAiSession("consented")).toBe(false);
    });
  });

  describe("mayRetake — exactly one retake", () => {
    it("permits the first retake from captured", () => {
      expect(mayRetake("captured", false)).toBe(true);
    });

    it("refuses a second retake", () => {
      expect(mayRetake("captured", true)).toBe(false);
    });

    it("refuses a retake from any other status", () => {
      for (const status of ORDER_STATUSES) {
        if (status === "captured") continue;
        expect(mayRetake(status, false)).toBe(false);
      }
    });
  });

  describe("mayRefund", () => {
    it("permits refunding paid, failed and expired orders", () => {
      expect(mayRefund("paid")).toBe(true);
      expect(mayRefund("delivered")).toBe(true);
      expect(mayRefund("failed")).toBe(true);
      expect(mayRefund("expired")).toBe(true);
    });

    it("refuses refunding what was never charged or is already refunded", () => {
      expect(mayRefund("created")).toBe(false);
      expect(mayRefund("payment_pending")).toBe(false);
      expect(mayRefund("refunded")).toBe(false);
    });
  });

  it("validates status strings", () => {
    expect(isOrderStatus("paid")).toBe(true);
    expect(isOrderStatus("not_a_status")).toBe(false);
    expect(isOrderStatus(null)).toBe(false);
    expect(isOrderStatus(42)).toBe(false);
  });
});
