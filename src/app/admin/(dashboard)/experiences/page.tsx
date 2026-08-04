import Image from "next/image";
import { requirePermission } from "@/lib/auth/session.server";
import { listResolvedExperiences } from "@/lib/db/repositories";
import { ExperienceToggle } from "@/app/admin/(dashboard)/experiences/ExperienceToggle";
import { formatMoney, Panel } from "@/components/admin/Ui";

export const dynamic = "force-dynamic";

export default async function AdminExperiencesPage() {
  await requirePermission("experiences.manage");
  const experiences = await listResolvedExperiences({ includeInactive: true });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[26px] font-bold text-white">Styles</h1>
        <p className="mt-1 max-w-[720px] text-[14px] text-wf-dim">
          Turn a style off and it disappears from the kiosk immediately. Prompts and safety rules live
          in code and are reviewed in a pull request — they are deliberately not editable here.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {experiences.map((experience) => (
          <Panel key={experience.id} title={experience.name.en}>
            <div className="flex gap-5">
              <Image
                src={experience.previewAsset}
                alt=""
                width={120}
                height={150}
                className="h-[150px] w-[120px] shrink-0 rounded-xl object-cover"
              />

              <div className="flex flex-1 flex-col gap-3">
                <p className="text-[14px] text-wf-dim">{experience.tagline.en}</p>

                <dl className="grid grid-cols-2 gap-2 text-[13px]">
                  <Field label="Price" value={formatMoney(experience.priceCents)} />
                  <Field label="Model" value={experience.modelPreference} />
                  <Field label="Max session" value={`${experience.maxGenerationSeconds}s`} />
                  <Field label="Audience" value={experience.audience.replace("_", " ")} />
                </dl>

                {experience.featured && (
                  <span className="w-fit rounded-full bg-wf-pink/20 px-2.5 py-1 text-[11px] font-semibold uppercase text-wf-pink">
                    Featured — shows NEW! badge
                  </span>
                )}

                <ExperienceToggle
                  experienceId={experience.id}
                  slug={experience.slug}
                  active={experience.active}
                />
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-wf-dim">{label}</dt>
      <dd className="text-white">{value}</dd>
    </div>
  );
}
