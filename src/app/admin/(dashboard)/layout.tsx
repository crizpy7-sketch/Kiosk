import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminIdentity, hasPermission } from "@/lib/auth/session.server";
import { SignOutButton } from "@/components/admin/SignOutButton";

export const dynamic = "force-dynamic";

/**
 * Admin shell and the authentication gate.
 *
 * This layout wraps the `(dashboard)` route group, which contains every
 * authenticated admin page and nothing else. `/admin/login` lives outside the
 * group, so it renders for a signed-out user without this layout having to
 * decide anything.
 *
 * That structure is the point. An earlier version kept login under the same
 * layout and skipped the check when a request header said the path was the
 * login page — which made the whole admin gate depend on a header rather than
 * on routing. Now there is no condition to get wrong: if a page is in this
 * group, it is behind the check.
 *
 * Still defence-in-depth, not the boundary: every server action re-checks
 * permissions itself, because hiding a link is not access control.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const identity = await getAdminIdentity();
  if (!identity) redirect("/admin/login");

  const isOwner = identity.role === "owner";

  return (
    <div className="min-h-[100dvh] bg-wf-ink text-white">
      <header className="border-b border-wf-border bg-wf-surface">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link href="/admin" className="wf-display text-[19px] text-wf-pink">
            WILD FRAME <span className="text-wf-green">ADMIN</span>
          </Link>

          <nav className="flex flex-wrap items-center gap-1 text-[14px]">
            <NavLink href="/admin">Dashboard</NavLink>
            <NavLink href="/admin/orders">Orders</NavLink>
            {hasPermission(identity.role, "experiences.manage") && (
              <NavLink href="/admin/experiences">Styles</NavLink>
            )}
            {hasPermission(identity.role, "audit.view") && <NavLink href="/admin/audit">Audit</NavLink>}
            {hasPermission(identity.role, "settings.manage") && (
              <NavLink href="/admin/settings">Settings</NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <span
              className={`rounded-full px-3 py-1 text-[12px] font-semibold uppercase tracking-wide ${
                isOwner ? "bg-wf-pink/20 text-wf-pink" : "bg-wf-green/15 text-wf-green"
              }`}
              data-testid="admin-role"
            >
              {identity.role}
            </span>
            <span className="hidden text-[13px] text-wf-dim sm:inline">{identity.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-6 py-8">{children}</main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-2 text-wf-dim transition-colors hover:bg-white/5 hover:text-white"
    >
      {children}
    </Link>
  );
}
