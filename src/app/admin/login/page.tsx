import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/auth/session.server";
import { LoginForm } from "@/app/admin/login/LoginForm";
import { WildFrameLogo } from "@/components/brand/WildFrameLogo";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await getAdminIdentity()) redirect("/admin");

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-wf-ink px-6 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex justify-center">
          <WildFrameLogo size="md" />
        </div>

        <div className="rounded-3xl border border-wf-border bg-wf-surface p-8">
          <h1 className="wf-display mb-1 text-[24px] text-white">STAFF SIGN IN</h1>
          <p className="mb-6 text-[15px] text-wf-dim">
            Owner and staff accounts only. Ask the owner for access.
          </p>
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-[13px] text-wf-dim/70">
          Wild Frame AI admin. Not for customers.
        </p>
      </div>
    </main>
  );
}
