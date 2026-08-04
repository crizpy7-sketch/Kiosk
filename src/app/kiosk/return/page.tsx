import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Landing point for the return from hosted checkout.
 *
 * Its entire job is to normalise the provider's redirect into the kiosk's own
 * URL shape. Reaching this page with `result=success` proves only that a browser
 * followed a link — it grants nothing. The kiosk still polls the order status
 * and waits for the verified webhook to mark it paid.
 */
export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const order = typeof params["order"] === "string" ? params["order"] : "";
  const result = params["result"] === "cancel" ? "cancel" : "success";

  redirect(`/kiosk?order=${encodeURIComponent(order)}&result=${result}`);
}
