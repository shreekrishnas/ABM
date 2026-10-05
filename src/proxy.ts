import { NextResponse, type NextRequest } from "next/server";

// Password gate until real auth (roadmap item 1). When APP_PASSWORD is set,
// every page requires HTTP Basic auth. /api/v1 is excluded: it uses its own
// bearer key (ABM_API_KEY) so webhooks and cron can call it.
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const pass = decoded.slice(decoded.indexOf(":") + 1);
      if (safeEqual(pass, password)) return NextResponse.next();
    } catch {
      // fall through to the challenge
    }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ABM Intelligence", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!api/v1|_next/static|_next/image|favicon.ico).*)"],
};
