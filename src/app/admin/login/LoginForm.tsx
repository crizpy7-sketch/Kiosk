"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        // The server answers the same way for a bad email and a bad password,
        // so this message never confirms whether an account exists.
        setError(body?.error?.message ?? "Sign in failed.");
        setBusy(false);
        return;
      }

      router.replace("/admin");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-wf-dim">Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="username"
          data-testid="admin-email"
          className="min-h-[52px] rounded-xl border border-wf-border bg-wf-ink px-4 text-[16px] text-white outline-none focus:border-wf-pink"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-wf-dim">Password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          autoComplete="current-password"
          data-testid="admin-password"
          className="min-h-[52px] rounded-xl border border-wf-border bg-wf-ink px-4 text-[16px] text-white outline-none focus:border-wf-pink"
        />
      </label>

      {error && (
        <p role="alert" data-testid="admin-login-error" className="text-[14px] text-wf-pink">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        data-testid="admin-submit"
        className="wf-display mt-2 min-h-[52px] rounded-xl bg-wf-pink text-[17px] text-white disabled:opacity-50"
      >
        {busy ? "SIGNING IN…" : "SIGN IN"}
      </button>
    </form>
  );
}
