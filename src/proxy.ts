import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/auth/session";
import { PORTAL_BY_ROLE, portalRoleForPath } from "@/lib/roles";

/*
 * Fast routing gate: sends signed-out users to /login and keeps each role in its own portal.
 * Real authorization happens again in every page/action/route via the data layer.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const portalRole = portalRoleForPath(pathname);

  if (portalRole) {
    if (!session) {
      const url = new URL("/login", req.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    if (session.role !== portalRole) return NextResponse.redirect(new URL(PORTAL_BY_ROLE[session.role], req.url));
  }
  if (session && (pathname === "/" || pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL(PORTAL_BY_ROLE[session.role], req.url));
  }
  if (!session && pathname === "/") return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/signup", "/admin/:path*", "/owner/:path*", "/storeroom/:path*", "/store/:path*"],
};
