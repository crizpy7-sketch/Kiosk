"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut(): Promise<void> {
    setBusy(true);
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      data-testid="admin-signout"
      className="rounded-lg border border-wf-border px-3 py-2 text-[13px] text-wf-dim transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
    >
      {busy ? "…" : "Sign out"}
    </button>
  );
}
