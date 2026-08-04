import { notFound } from "next/navigation";
import { WildFrameLogo } from "@/components/brand/WildFrameLogo";
import { getAssetByTokenHash } from "@/lib/db/repositories";
import { hashDeliveryToken, hoursUntil, isExpired, isWellFormedDeliveryToken } from "@/lib/delivery/tokens";
import { DownloadActions } from "@/app/d/[token]/DownloadActions";

export const dynamic = "force-dynamic";

/**
 * The customer's phone page.
 *
 * Reached by scanning the QR. Deliberately plain: a preview, a download button,
 * and when to expect the link to stop working. No account, no sign-up, no
 * gallery, no tracking — this page exists to hand someone their photo and get
 * out of the way.
 *
 * An expired, deleted or unknown token all render the same 404. Nothing here
 * confirms whether a given link ever existed.
 */
export default async function DownloadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isWellFormedDeliveryToken(token)) notFound();

  const asset = await getAssetByTokenHash(hashDeliveryToken(token));
  if (!asset || asset.deleted_at || isExpired(asset.expires_at)) notFound();

  const hoursLeft = hoursUntil(asset.expires_at);
  const imageUrl = `/api/download/${token}`;

  return (
    <main className="flex min-h-[100dvh] flex-col items-center gap-8 bg-wf-black px-6 py-10">
      <WildFrameLogo size="sm" />

      <h1 className="wf-display text-center text-[30px] leading-tight text-wf-green">
        YOUR PHOTO IS READY
      </h1>

      <div className="w-full max-w-[520px] overflow-hidden rounded-3xl border-2 border-wf-pink/40 bg-wf-surface">
        {/* eslint-disable-next-line @next/next/no-img-element -- served through the
            authorised token route, which must not be proxied by the image optimiser */}
        <img src={imageUrl} alt="Your Wild Frame AI transformation" className="w-full" />
      </div>

      <DownloadActions imageUrl={imageUrl} />

      <p className="max-w-[440px] text-center text-[16px] leading-relaxed text-wf-dim">
        This link expires in {hoursLeft} {hoursLeft === 1 ? "hour" : "hours"}, then the photo is
        deleted. Save it to your phone now.
      </p>

      <p className="mt-auto max-w-[440px] text-center text-[14px] leading-relaxed text-wf-dim/70">
        Created with AI at Wild Frame AI. We don&apos;t keep your raw camera photos and there is no
        public gallery. Ask a boutique team member to delete this any time.
      </p>
    </main>
  );
}
