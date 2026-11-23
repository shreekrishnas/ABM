// Turns a sign-in result into the response for the sign-in route handlers: the session cookie and
// the landing page on success, otherwise back to the sign-in page with a short code (never free text).
import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_DAYS } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";
import { safeNext, type RequestInfo, type SignInResult } from "@/lib/sign-in";

export function requestInfo(req: Request): RequestInfo {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host;
  const proto = h.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return { ip: clientIp(h), userAgent: h.get("user-agent") ?? "", origin: `${proto}://${host}` };
}

export function signInResponse(req: Request, r: SignInResult, next: unknown): NextResponse {
  const info = requestInfo(req);
  const to = (path: string, q: Record<string, string | undefined> = {}) => {
    const u = new URL(path, info.origin);
    for (const [k, v] of Object.entries(q)) if (v) u.searchParams.set(k, v);
    return NextResponse.redirect(u, 303);
  };
  if (r.kind === "signed_in") {
    const res = to(r.to);
    res.cookies.set(SESSION_COOKIE, r.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
    return res;
  }
  const n = safeNext(next);
  const keep = n === "/" ? undefined : n;
  if (r.kind === "sent") return to("/login", { sent: "1", email: r.email, next: keep });
  return to("/login", { e: r.code, email: r.email, m: r.minutes ? String(r.minutes) : undefined, next: keep });
}
