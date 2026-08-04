import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth/session.constants";

/**
 * Bounces /admin/* to the login page when no session cookie is present.
 *
 * A convenience redirect, not the authorization boundary — it only sees whether
 * a cookie exists, not whether it is valid or what role it carries. The real
 * check is the database lookup in the (dashboard) layout, and the real
 * enforcement is `requirePermission` inside every server action. Deleting this
 * file would cost a redirect, not a security property.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const isAdminArea = pathname.startsWith("/admin") && !pathname.startsWith("/admin/login");
  if (isAdminArea && !request.cookies.get(ADMIN_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Only /admin needs this. Narrowing the matcher keeps the middleware off the
  // kiosk's hot path entirely.
  matcher: ["/admin/:path*"],
};
