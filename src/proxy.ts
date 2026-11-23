import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authRequired, authSecret, domainAllowed, verify, type Session } from "@/lib/auth";

/** The only places a signed-out visitor may post to: the sign-in form and the emailed link's button. */
const SIGN_IN_ROUTES = new Set(["/login/submit", "/login/verify/submit"]);

// Sign-in gate: every page needs a session from /login (work email on the allowed domain).
// /api/v1 skips the sign-in gate (it uses its own bearer key, ABM_API_KEY, so webhooks and cron can
// call it) but is rate-limited per address.
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // Public API: its own bearer key, plus a per-address request limit.
  if (pathname.startsWith("/api/v1/")) {
    const { hit, clientIp, LIMITS } = await import("@/lib/rate-limit");
    const r = await hit(`api:${clientIp(req.headers)}`, LIMITS.api.max, LIMITS.api.windowMs);
    if (!r.ok) return NextResponse.json({ error: "rate_limited", retryAfterSeconds: r.retryAfter }, { status: 429, headers: { "retry-after": String(r.retryAfter) } });
    return NextResponse.next();
  }
  if (!authRequired()) return NextResponse.next();
  const secret = authSecret();
  const session = secret ? await verify<Session>(req.cookies.get(SESSION_COOKIE)?.value, secret) : null;
  const signedIn = Boolean(session && domainAllowed(session.email));
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    // Signed out, the sign-in pages may be opened and the two sign-in route handlers posted to, nothing
    // else. Every server action is refused here: the app's layout makes its actions callable from any
    // page, so one posted to /login would run with no one signed in (and unscoped).
    if (!signedIn && (req.headers.has("next-action") || (req.method !== "GET" && req.method !== "HEAD" && !SIGN_IN_ROUTES.has(pathname)))) {
      return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
    }
    return NextResponse.next();
  }
  if (signedIn) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|woff2?)$).*)"],
};
