import { NextResponse, type NextRequest } from "next/server";
import { GATE_HEADER, REQUEST_ID_HEADER, SESSION_COOKIE, authRequired } from "@/lib/auth";
import { checkSession } from "@/lib/session";

/** The only places a signed-out visitor may post to: the sign-in form and the emailed link's button. */
const SIGN_IN_ROUTES = new Set(["/login/submit", "/login/verify/submit"]);

type Gate = "api" | "public" | "session";

/** Pass the request on, with the gate's own headers (never the browser's) for the data layer. */
function forward(req: NextRequest, gate: Gate) {
  const headers = new Headers(req.headers);
  headers.set(GATE_HEADER, gate);
  headers.set(REQUEST_ID_HEADER, crypto.randomUUID());
  return NextResponse.next({ request: { headers } });
}

/** A session cookie that no longer works is removed, so the browser stops sending it. */
function dropCookie<T extends NextResponse>(res: T, drop: boolean): T {
  if (drop) res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}

// Sign-in gate: every page needs a session from /login (work email on the allowed domain), and the
// session must still be good: its person on the team and the session not ended since ("Sign out
// everywhere", removal). That is checked against the database on every request, before any page,
// server action or route runs, so an old cookie stops working at once.
// /api/v1 skips the sign-in gate (it uses its own bearer key, ABM_API_KEY or a client key, so webhooks
// and cron can call it) but is rate-limited per address.
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // Public API: its own bearer key, plus a per-address request limit.
  if (pathname.startsWith("/api/v1/")) {
    const { hit, clientIp, LIMITS } = await import("@/lib/rate-limit");
    const r = await hit(`api:${clientIp(req.headers)}`, LIMITS.api.max, LIMITS.api.windowMs);
    if (!r.ok) return NextResponse.json({ error: "rate_limited", retryAfterSeconds: r.retryAfter }, { status: 429, headers: { "retry-after": String(r.retryAfter) } });
    return forward(req, "api");
  }
  if (!authRequired()) return NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  // A database hiccup is not a sign-out: let the request through and keep the cookie; the data layer
  // checks the session again and refuses (or fails) on its own.
  const state = await checkSession(token).catch(() => null);
  const signedIn = state === null || state.ok;
  const ended = Boolean(token) && !signedIn;
  const writes = req.headers.has("next-action") || (req.method !== "GET" && req.method !== "HEAD");
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    // Signed out, the sign-in pages may be opened and the two sign-in route handlers posted to, nothing
    // else. Every server action is refused here: the app's layout makes its actions callable from any
    // page, so one posted to /login would run with no one signed in.
    if (!signedIn && (req.headers.has("next-action") || (writes && !SIGN_IN_ROUTES.has(pathname)))) {
      return dropCookie(NextResponse.json({ error: "sign_in_required" }, { status: 401 }), ended);
    }
    // (The two sign-in routes set a fresh cookie themselves: never clear it in the same response.)
    return dropCookie(forward(req, signedIn ? "session" : "public"), ended && !SIGN_IN_ROUTES.has(pathname));
  }
  if (signedIn) return forward(req, "session");
  const q = new URLSearchParams();
  if (pathname !== "/") q.set("next", pathname + search);
  if (ended) q.set("e", "ended");
  const signIn = `/login${q.size ? `?${q}` : ""}`;
  // A server action never runs: it is refused, and the page that sent it is told to load the sign-in
  // page (Next's action client follows x-action-redirect), so the person sees why instead of an error.
  if (req.headers.has("next-action")) {
    return dropCookie(NextResponse.json({ error: ended ? "session_ended" : "sign_in_required" }, { status: 401, headers: { "x-action-redirect": `${signIn};replace` } }), ended);
  }
  // Other writes from a session that has ended get a plain refusal, not a page.
  if (ended && writes) return dropCookie(NextResponse.json({ error: "session_ended" }, { status: 401 }), true);
  return dropCookie(NextResponse.redirect(new URL(signIn, req.nextUrl.origin)), ended);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|woff2?)$).*)"],
};
