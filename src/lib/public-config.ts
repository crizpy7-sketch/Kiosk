import type { Language } from "@/lib/i18n/messages";

/**
 * The complete set of values the kiosk browser is allowed to know.
 *
 * Assembled server-side and passed down as props. Nothing is read from
 * NEXT_PUBLIC_* env vars, which is what makes "no secrets in the client bundle"
 * a structural property rather than a discipline: there is exactly one door,
 * and this type is it.
 */
export interface PublicExperience {
  id: string;
  slug: string;
  /** Both languages travel together: the customer can toggle at any moment, and
   *  a screen must never mix English chrome with a Spanish card (or vice versa). */
  name: Record<Language, string>;
  tagline: Record<Language, string>;
  previewAsset: string;
  priceCents: number;
  featured: boolean;
  theme: "slime" | "anime" | "royal" | "baby";
}

export interface PublicKioskConfig {
  kioskName: string;
  defaultLanguage: Language;
  demoMode: boolean;
  priceCents: number;
  currency: string;
  countdownSeconds: number;
  sessionMaxSeconds: number;
  downloadTtlHours: number;
  attractTimeoutSeconds: number;
  experiences: PublicExperience[];
}

export function formatPrice(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
