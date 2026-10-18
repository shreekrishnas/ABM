import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authRequired, authSecret, domainAllowed, verify, type Session } from "@/lib/auth";

// Sign-in gate: every page needs a session from /login (work email on the allowed domain).
// /api/v1 is excluded: it uses its own bearer key (ABM_API_KEY) so webhooks and cron can call it.
export async function proxy(req: NextRequest) {
  if (!authRequired()) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/login/")) return NextResponse.next();
  const secret = authSecret();
  const session = secret ? await verify<Session>(req.cookies.get(SESSION_COOKIE)?.value, secret) : null;
  if (session && domainAllowed(session.email)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api/v1|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|woff2?)$).*)"],
};
