"use client";

import { useState, useTransition } from "react";
import { toggleExperienceAction } from "@/lib/admin/actions";

export function ExperienceToggle({
  experienceId,
  slug,
  active,
}: {
  experienceId: string;
  slug: string;
  active: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [isActive, setIsActive] = useState(active);
  const [error, setError] = useState<string | null>(null);

  function toggle(): void {
    const next = !isActive;
    startTransition(async () => {
      const result = await toggleExperienceAction(experienceId, next);
      if (result.ok) {
        setIsActive(next);
        setError(null);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="mt-auto flex flex-col gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        data-testid={`toggle-${slug}`}
        aria-pressed={isActive}
        className={`min-h-[44px] rounded-xl px-5 text-[14px] font-semibold transition-colors disabled:opacity-50 ${
          isActive
            ? "bg-wf-green/15 text-wf-green hover:bg-wf-green/25"
            : "border border-wf-border text-wf-dim hover:bg-white/5"
        }`}
      >
        {pending ? "Saving…" : isActive ? "Active — tap to disable" : "Disabled — tap to enable"}
      </button>
      {error && <p className="text-[13px] text-wf-pink">{error}</p>}
    </div>
  );
}
