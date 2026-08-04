import { KioskApp } from "@/components/kiosk/KioskApp";
import { getEnv } from "@/lib/env";
import { getKiosk, listResolvedExperiences } from "@/lib/db/repositories";
import { validateExperienceCatalogue } from "@/lib/config/experiences";
import type { PublicKioskConfig } from "@/lib/public-config";
import type { Language } from "@/lib/i18n/messages";
import { isDemoMode } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The kiosk entry point.
 *
 * A server component assembles the *entire* set of values the browser is
 * allowed to see and hands them down as one typed prop. No environment variable
 * is read on the client, which is what makes "no secrets in the bundle" a
 * property of the architecture rather than a review checklist item.
 */
export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  validateExperienceCatalogue();

  const env = getEnv();
  const params = await searchParams;
  const [kiosk, experiences] = await Promise.all([getKiosk(env.KIOSK_ID), listResolvedExperiences()]);

  const config: PublicKioskConfig = {
    kioskName: kiosk?.name ?? "Wild Frame AI",
    defaultLanguage: (kiosk?.configured_language ?? env.DEFAULT_LANGUAGE) as Language,
    demoMode: isDemoMode(),
    priceCents: experiences[0]?.priceCents ?? 599,
    currency: "usd",
    countdownSeconds: env.COUNTDOWN_SECONDS,
    sessionMaxSeconds: env.SESSION_MAX_SECONDS,
    downloadTtlHours: env.DOWNLOAD_LINK_TTL_HOURS,
    attractTimeoutSeconds: env.ATTRACT_TIMEOUT_SECONDS,
    experiences: experiences.map((experience) => ({
      id: experience.id,
      slug: experience.slug,
      name: experience.name,
      tagline: experience.tagline,
      previewAsset: experience.previewAsset,
      priceCents: experience.priceCents,
      featured: experience.featured,
      theme: experience.theme,
    })),
  };

  const orderParam = params["order"];
  const resultParam = params["result"];

  return (
    <KioskApp
      config={config}
      resumeOrderId={typeof orderParam === "string" ? orderParam : null}
      resumeResult={resultParam === "success" || resultParam === "cancel" ? resultParam : null}
    />
  );
}
