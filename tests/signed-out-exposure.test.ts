// Signed-out visitors: the sign-in page must carry nothing private, and no server action may run
// for them. The request gate (src/proxy.ts) refuses every server action from a signed-out visitor;
// signing in goes through two route handlers instead; the layout reads nothing private when signed out.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const jar = new Map<string, string>();
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined), getAll: () => [...jar].map(([name, value]) => ({ name, value })), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "localhost:3000" }),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

import { baseDb } from "@/lib/db-base";
import { SESSION_COOKIE, linkToken, sessionToken } from "@/lib/auth";
import { clearScopeCache } from "@/lib/scope";
import { proxy } from "@/proxy";
import { POST as submitSignIn } from "@/app/login/submit/route";
import { POST as submitLink } from "@/app/login/verify/submit/route";
import RootLayout from "@/app/layout";

const SECRET = "test-secret-for-signed-out";
const prev = { secret: process.env.AUTH_SECRET, req: process.env.AUTH_REQUIRED, smtp: process.env.SMTP_URL };
beforeAll(() => { process.env.AUTH_SECRET = SECRET; process.env.AUTH_REQUIRED = "true"; delete process.env.SMTP_URL; });
afterAll(() => {
  for (const [k, v] of [["AUTH_SECRET", prev.secret], ["AUTH_REQUIRED", prev.req], ["SMTP_URL", prev.smtp]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const MEMBER = "member@trilliantdigital.com";
beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.client.create({ data: { id: "manch", name: "Manch" } });
  const u = await baseDb.user.create({ data: { name: "Secret Teammate", email: MEMBER } });
  await baseDb.userClient.create({ data: { userId: u.id, clientId: "manch", role: "manager" } });
  const a = await baseDb.account.create({ data: { name: "Hidden Co", sellerId: "manch" } });
  await baseDb.reviewItem.create({ data: { type: "proposed_rejection", reason: "rule", stage: 3, accountId: a.id } });
  jar.clear();
  clearScopeCache();
});

const req = (path: string, init: { method?: string; headers?: Record<string, string>; cookie?: string; body?: BodyInit } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? "GET", body: init.body, headers: { ...(init.headers ?? {}), ...(init.cookie ? { cookie: `${SESSION_COOKIE}=${init.cookie}` } : {}) } });
const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";

describe("request gate: no server action for a signed-out visitor", () => {
  it("lets a signed-out visitor open the sign-in pages and post to the two sign-in routes only", async () => {
    expect(passes(await proxy(req("/login")))).toBe(true);
    expect(passes(await proxy(req("/login/verify?t=x")))).toBe(true);
    for (const path of ["/login/submit", "/login/verify/submit"]) expect(passes(await proxy(req(path, { method: "POST" }))), path).toBe(true);
  });

  it("refuses server actions posted to the sign-in pages, with or without the action header", async () => {
    for (const r of [
      req("/login", { method: "POST", headers: { "next-action": "00920d037ea667d0d3af694e0b13f88cb3aad9cb9b" } }),
      req("/login", { method: "POST" }), // a no-JavaScript action form post carries no header
      req("/login/verify", { method: "POST" }),
      req("/login/submit", { method: "POST", headers: { "next-action": "abc" } }),
      req("/login", { method: "PUT" }),
    ]) {
      const res = await proxy(r);
      expect(res.status, `${r.method} ${r.nextUrl.pathname}`).toBe(401);
      expect(passes(res)).toBe(false);
    }
  });

  it("still sends signed-out visitors of every other page to sign in (actions there never run)", async () => {
    const page = await proxy(req("/accounts"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toMatch(/\/login\?next=%2Faccounts$/);
    // A server action is refused, and the page that sent it is told to open the sign-in page.
    const action = await proxy(req("/accounts", { method: "POST", headers: { "next-action": "abc" } }));
    expect(action.status).toBe(401);
    expect(action.headers.get("x-action-redirect")).toBe("/login?next=%2Faccounts;replace");
    expect(passes(action)).toBe(false);
  });

  it("lets a signed-in person use server actions anywhere, and leaves the bearer-key API alone", async () => {
    const token = await sessionToken(MEMBER, SECRET, 0);
    expect(passes(await proxy(req("/login", { method: "POST", headers: { "next-action": "abc" }, cookie: token })))).toBe(true);
    expect(passes(await proxy(req("/accounts", { method: "POST", headers: { "next-action": "abc" }, cookie: token })))).toBe(true);
    expect(passes(await proxy(req("/api/v1/health")))).toBe(true);
  });

  it("a forged or expired session is treated as signed out", async () => {
    const forged = await sessionToken(MEMBER, "not-the-secret", 0);
    expect((await proxy(req("/login", { method: "POST", headers: { "next-action": "abc" }, cookie: forged }))).status).toBe(401);
  });
});

describe("signing in through the route handlers", () => {
  const form = (fields: Record<string, string>) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return fd; };
  const post = (path: string, fields: Record<string, string>) => new Request(`http://localhost:3000${path}`, { method: "POST", body: form(fields), headers: { host: "localhost:3000", "user-agent": "vitest" } });

  it("signs a team member in: session cookie and a 303 to where they were going", async () => {
    const res = await submitSignIn(post("/login/submit", { email: MEMBER, next: "/accounts" }));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/accounts");
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(await baseDb.signInEvent.count({ where: { email: MEMBER, ok: true } })).toBe(1);
  });

  it("sends anyone else back with a short code and no cookie", async () => {
    for (const [email, code] of [["", "no_email"], ["someone@gmail.com", "domain"], ["stranger@trilliantdigital.com", "not_member"]] as const) {
      const res = await submitSignIn(post("/login/submit", { email, next: "/" }));
      expect(res.status, email).toBe(303);
      const to = new URL(res.headers.get("location")!);
      expect(to.pathname).toBe("/login");
      expect(to.searchParams.get("e"), email).toBe(code);
      expect(res.headers.get("set-cookie"), email).toBeNull();
    }
  });

  it("never redirects off-site or back into the sign-in pages", async () => {
    for (const next of ["https://evil.example/", "//evil.example", "/login/verify"]) {
      const res = await submitSignIn(post("/login/submit", { email: MEMBER, next }));
      expect(new URL(res.headers.get("location")!).host, next).toBe("localhost:3000");
      expect(new URL(res.headers.get("location")!).pathname, next).not.toMatch(/^\/login/);
    }
  });

  it("an emailed link signs in once; a used or forged one does not", async () => {
    const t = await linkToken(MEMBER, SECRET, 0);
    const ok = await submitLink(post("/login/verify/submit", { t, next: "/review" }));
    expect(ok.status).toBe(303);
    expect(new URL(ok.headers.get("location")!).pathname).toBe("/review");
    expect(ok.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    const again = await submitLink(post("/login/verify/submit", { t, next: "/" }));
    expect(new URL(again.headers.get("location")!).searchParams.get("e")).toBe("used");
    const bad = await submitLink(post("/login/verify/submit", { t: "garbage", next: "/" }));
    expect(new URL(bad.headers.get("location")!).searchParams.get("e")).toBe("expired");
    expect(bad.headers.get("set-cookie")).toBeNull();
  });
});

describe("the layout sends nothing private to a signed-out visitor", () => {
  type El = { type: unknown; props: Record<string, unknown> };
  const find = (node: unknown, pred: (e: El) => boolean): El | null => {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) { for (const n of node) { const f = find(n, pred); if (f) return f; } return null; }
    const e = node as El;
    if (e.props && pred(e)) return e;
    return e.props ? find(e.props.children, pred) : null;
  };
  const named = (name: string) => (e: El) => typeof e.type === "function" && (e.type as { name?: string }).name === name;

  it("signed out: no team list, no counts, no seller name", async () => {
    const tree = await RootLayout({ children: null });
    const text = JSON.stringify(tree, (_k, v) => (typeof v === "function" ? undefined : v));
    expect(text).not.toContain("Secret Teammate");
    expect(text).not.toContain("Manch");
    expect(find(tree, named("QuickTask"))?.props.users).toEqual([]);
    expect(find(tree, named("Shell"))?.props.counts).toEqual({ review: 0, handoffs: 0, tasks: 0 });
    expect(find(tree, named("AppNav"))?.props.sellerName).toBe("");
  });

  it("signed in: unchanged (team list, counts and seller name are there)", async () => {
    jar.set(SESSION_COOKIE, await sessionToken(MEMBER, SECRET, 0));
    clearScopeCache();
    const tree = await RootLayout({ children: null });
    expect((find(tree, named("QuickTask"))?.props.users as { name: string }[]).map((u) => u.name)).toEqual(["Secret Teammate"]);
    expect((find(tree, named("Shell"))?.props.counts as { review: number }).review).toBe(1);
    expect(find(tree, named("AppNav"))?.props.sellerName).toBeTruthy();
  });
});
