// S-5: a session counts only while its person is on the team and the session hasn't been ended since it
// was issued. Removal, "Sign out everywhere", a revoked Super Admin entitlement, a narrowed Super Admin
// coverage, a removed client assignment or an archived client take effect on the very next request: in
// the request gate (src/proxy.ts), the data layer (resolveScope / db), server actions (logAction), and
// background jobs (the person who started one must still be allowed when it runs). Everyone else's
// sessions are untouched.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const jar = new Map<string, string>();
const hdr = new Map<string, string>();
let outsideRequest = false;
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (outsideRequest) throw new Error("cookies() called outside a request scope");
    return { get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined), getAll: () => [...jar].map(([name, value]) => ({ name, value })), set: () => undefined, delete: () => undefined };
  },
  headers: async () => {
    if (outsideRequest) throw new Error("headers() called outside a request scope");
    return new Headers([...hdr, ["host", "localhost:3000"]]);
  },
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("@/lib/session", async (orig) => {
  const real = await orig<typeof import("@/lib/session")>();
  return { ...real, checkSession: vi.fn(real.checkSession) };
});

import { baseDb } from "@/lib/db-base";
import { db } from "@/lib/db";
import { GATE_HEADER, REQUEST_ID_HEADER, SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { checkSession } from "@/lib/session";
import { NO_CLIENT_ID, activeSellerId, clearScopeCache, resolveScope } from "@/lib/scope";
import { getMe } from "@/lib/me";
import { logAction } from "@/lib/action-utils";
import { ActionDenied } from "@/lib/roles";
import { runJob, starterRefusal } from "@/lib/jobs";
import { proxy } from "@/proxy";
import { addNoteAction } from "@/app/actions";
import { loadNotifications } from "@/components/shell/notification-actions";
import { GET as myJobs } from "@/app/api/jobs/mine/route";
import { DEFAULT_SELLER_ID } from "@/lib/seller";

const SECRET = "test-secret-for-session-security";
const prev = { secret: process.env.AUTH_SECRET, req: process.env.AUTH_REQUIRED };
beforeAll(() => { process.env.AUTH_SECRET = SECRET; process.env.AUTH_REQUIRED = "true"; });
afterAll(() => {
  for (const [k, v] of [["AUTH_SECRET", prev.secret], ["AUTH_REQUIRED", prev.req]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const ALICE = "alice@trilliantdigital.com"; // Manager of Alpha
const BOB = "bob@trilliantdigital.com"; // Manager of Beta: never touched, must keep working
const SAM = "sam@trilliantdigital.com"; // Super Admin over every client
const LENA = "lena@trilliantdigital.com"; // Super Admin over Alpha only
let alphaCo = "";

beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.client.createMany({ data: [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }] });
  const alice = await baseDb.user.create({ data: { name: "Alice", email: ALICE } });
  const bob = await baseDb.user.create({ data: { name: "Bob", email: BOB } });
  await baseDb.user.create({ data: { name: "Sam", email: SAM, superAdmin: true } });
  await baseDb.user.create({ data: { name: "Lena", email: LENA, superAdmin: true, superAdminClients: ["alpha"] } });
  await baseDb.userClient.createMany({ data: [{ userId: alice.id, clientId: "alpha", role: "manager" }, { userId: bob.id, clientId: "beta", role: "manager" }] });
  alphaCo = (await baseDb.account.create({ data: { name: "Alpha Co", sellerId: "alpha" } })).id;
  await baseDb.account.create({ data: { name: "Beta Co", sellerId: "beta" } });
  jar.clear();
  hdr.clear();
  outsideRequest = false;
  clearScopeCache();
  vi.mocked(checkSession).mockClear();
});

const tokenFor = async (email: string) => sessionToken(email, SECRET, (await baseDb.user.findUniqueOrThrow({ where: { email } })).sessionVersion);
const endSessions = (email: string) => baseDb.user.update({ where: { email }, data: { sessionVersion: { increment: 1 } } });
let n = 0;
/** Act as one request that came through the gate: its cookies, and a fresh request id. */
function request(token: string | null, o: { mode?: "super"; client?: string; gate?: string } = {}) {
  jar.clear();
  hdr.clear();
  if (token) jar.set(SESSION_COOKIE, token);
  if (o.mode) jar.set("abm_mode", o.mode);
  if (o.client) jar.set("abm_client", o.client);
  hdr.set(GATE_HEADER, o.gate ?? "session");
  hdr.set(REQUEST_ID_HEADER, `req-${++n}`);
}
const companies = async () => (await db.account.findMany({ select: { name: true }, orderBy: { name: "asc" } })).map((a) => a.name);

const nreq = (path: string, init: { method?: string; headers?: Record<string, string>; cookie?: string } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? "GET", headers: { ...(init.headers ?? {}), ...(init.cookie ? { cookie: `${SESSION_COOKIE}=${init.cookie}` } : {}) } });
const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";
const gateOf = (r: Response) => r.headers.get(`x-middleware-request-${GATE_HEADER}`);
const clearsCookie = (r: Response) => /abm_session=;.*Max-Age=0/i.test(r.headers.get("set-cookie") ?? "");

describe("request gate: every request's session is checked against the team record", () => {
  it("a good session passes, with the gate's own headers (a browser can't supply them)", async () => {
    const t = await tokenFor(ALICE);
    const res = await proxy(nreq("/accounts", { cookie: t, headers: { [GATE_HEADER]: "api", [REQUEST_ID_HEADER]: "chosen-by-browser" } }));
    expect(passes(res)).toBe(true);
    expect(gateOf(res)).toBe("session");
    expect(res.headers.get(`x-middleware-request-${REQUEST_ID_HEADER}`)).toMatch(/^[0-9a-f-]{36}$/);
    expect(clearsCookie(res)).toBe(false);
  });

  it("after Sign out everywhere, the old cookie is signed out at once: pages go to sign-in, actions get 401, the cookie is cleared", async () => {
    const old = await tokenFor(ALICE);
    await endSessions(ALICE);
    const page = await proxy(nreq("/accounts", { cookie: old }));
    expect(page.status).toBe(307);
    const to = new URL(page.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("e")).toBe("ended");
    expect(to.searchParams.get("next")).toBe("/accounts");
    expect(clearsCookie(page)).toBe(true);
    for (const r of [nreq("/accounts", { method: "POST", cookie: old, headers: { "next-action": "abc" } }), nreq("/review", { method: "POST", cookie: old }), nreq("/login", { method: "POST", cookie: old, headers: { "next-action": "abc" } })]) {
      const res = await proxy(r);
      expect(res.status, r.nextUrl.pathname).toBe(401);
      expect(clearsCookie(res)).toBe(true);
    }
    // The page that sent the action is told to open the sign-in page, saying the session ended.
    const action = await proxy(nreq("/accounts?stage=AWARE", { method: "POST", cookie: old, headers: { "next-action": "abc" } }));
    expect(action.headers.get("x-action-redirect")).toBe("/login?next=%2Faccounts%3Fstage%3DAWARE&e=ended;replace");
    const login = await proxy(nreq("/login", { cookie: old }));
    expect(passes(login)).toBe(true);
    expect(gateOf(login)).toBe("public");
    expect(clearsCookie(login)).toBe(true);
    // Signing in again with the old cookie still in the browser: the sign-in route sets the new cookie,
    // so the gate must not clear it in the same response.
    for (const path of ["/login/submit", "/login/verify/submit"]) {
      const submit = await proxy(nreq(path, { method: "POST", cookie: old }));
      expect(passes(submit), path).toBe(true);
      expect(clearsCookie(submit), path).toBe(false);
    }
  });

  it("a removed person, a deleted person and a disabled one are all signed out", async () => {
    const t = await tokenFor(ALICE);
    for (const status of ["removed", "disabled"]) {
      await baseDb.user.update({ where: { email: ALICE }, data: { status } });
      const res = await proxy(nreq("/work/today", { cookie: t }));
      expect(res.status, status).toBe(307);
      expect(new URL(res.headers.get("location")!).searchParams.get("e")).toBe("ended");
    }
    const sam = await tokenFor(SAM);
    await baseDb.user.delete({ where: { email: SAM } });
    expect((await proxy(nreq("/", { cookie: sam }))).status).toBe(307);
  });

  it("other people's sessions keep working, and signing in again works", async () => {
    const bob = await tokenFor(BOB);
    await endSessions(ALICE);
    await baseDb.user.update({ where: { email: SAM }, data: { status: "removed" } });
    expect(passes(await proxy(nreq("/accounts", { cookie: bob })))).toBe(true);
    expect(passes(await proxy(nreq("/accounts", { cookie: await tokenFor(ALICE) })))).toBe(true);
  });

  it("a database hiccup is not a sign-out: the request goes on (the data layer checks again) and the cookie stays", async () => {
    const t = await tokenFor(ALICE);
    vi.mocked(checkSession).mockRejectedValueOnce(new Error("database unavailable"));
    const res = await proxy(nreq("/accounts", { cookie: t }));
    expect(passes(res)).toBe(true);
    expect(clearsCookie(res)).toBe(false);
  });
});

describe("data layer: an ended or removed session gets no client data", () => {
  it("a good session sees its own client only", async () => {
    request(await tokenFor(ALICE));
    expect((await resolveScope())?.ids).toEqual(["alpha"]);
    expect(await companies()).toEqual(["Alpha Co"]);
  });

  it("after Sign out everywhere or removal, the old session sees nothing, on the next request", async () => {
    const old = await tokenFor(ALICE);
    await endSessions(ALICE);
    request(old);
    expect((await resolveScope())?.ids).toEqual([]);
    expect(await companies()).toEqual([]);
    expect(await db.account.count()).toBe(0);
    expect(await getMe()).toBeNull();
    const fresh = await tokenFor(ALICE);
    await baseDb.user.update({ where: { email: ALICE }, data: { status: "removed" } });
    request(fresh);
    expect(await companies()).toEqual([]);
  });

  it("no session behind the gate sees nothing; only the bearer-key API (and work outside a request) is unscoped", async () => {
    request(null, { gate: "session" });
    expect((await resolveScope())?.ids).toEqual([]);
    request(null, { gate: "public" });
    expect(await companies()).toEqual([]);
    request(null, { gate: "api" });
    expect(await resolveScope()).toBeNull();
    outsideRequest = true;
    expect(await resolveScope()).toBeNull();
  });

  it("a revoked Super Admin entitlement takes effect on the next request", async () => {
    const t = await tokenFor(SAM);
    request(t, { mode: "super" });
    expect(await resolveScope()).toMatchObject({ ids: null, all: true });
    expect(await companies()).toEqual(["Alpha Co", "Beta Co"]);
    await baseDb.user.update({ where: { email: SAM }, data: { superAdmin: false } });
    request(t, { mode: "super" });
    expect(await resolveScope()).toMatchObject({ ids: [], all: false });
    expect(await companies()).toEqual([]);
    expect((await getMe())?.superAdmin).toBe(false);
  });

  it("a Super Admin moved to cover a different client sees the new one only, on the next request", async () => {
    const t = await tokenFor(LENA);
    request(t, { mode: "super" });
    expect(await companies()).toEqual(["Alpha Co"]);
    await baseDb.user.update({ where: { email: LENA }, data: { superAdminClients: ["beta"] } });
    request(t, { mode: "super" });
    expect(await companies()).toEqual(["Beta Co"]);
  });

  it("a removed client assignment, or an archived client, no longer grants access", async () => {
    const t = await tokenFor(ALICE);
    request(t, { client: "alpha" });
    expect(await companies()).toEqual(["Alpha Co"]);
    await baseDb.client.update({ where: { id: "alpha" }, data: { status: "archived" } });
    request(t, { client: "alpha" });
    expect(await companies()).toEqual([]);
    await baseDb.client.update({ where: { id: "alpha" }, data: { status: "active" } });
    await baseDb.userClient.deleteMany({ where: { user: { email: ALICE } } });
    request(t, { client: "alpha" });
    expect(await companies()).toEqual([]);
    expect((await getMe())?.clients).toEqual([]);
  });

  it("the scope is worked out once per request and never carried into the next one", async () => {
    const t = await tokenFor(ALICE);
    request(t);
    const first = await resolveScope();
    await baseDb.userClient.deleteMany({ where: { user: { email: ALICE } } });
    expect(await resolveScope()).toBe(first); // the same request keeps the scope it started with
    request(t); // the next request works it out again
    expect((await resolveScope())?.ids).toEqual([]);
    expect(await companies()).toEqual([]);
  });

  it("a signed-in person with no client is never shown the default client", async () => {
    await baseDb.userClient.deleteMany({ where: { user: { email: ALICE } } });
    request(await tokenFor(ALICE));
    expect(await activeSellerId()).toBe(NO_CLIENT_ID);
    outsideRequest = true; // background work and local previews keep the default
    expect(await activeSellerId()).toBe(DEFAULT_SELLER_ID);
  });
});

describe("server actions and the signed-in API refuse a session that no longer works", () => {
  it("logAction refuses inside a request with no valid person; background work still runs", async () => {
    const old = await tokenFor(ALICE);
    await endSessions(ALICE);
    request(old);
    await expect(logAction("company.run", { accountId: alphaCo })).rejects.toBeInstanceOf(ActionDenied);
    await expect(logAction("company.run", { accountId: alphaCo })).rejects.toThrow(/session has ended/);
    outsideRequest = true;
    await expect(logAction("company.run", { accountId: alphaCo })).resolves.toBeUndefined();
  });

  it("an action that never checks roles still can't write anything for an ended session", async () => {
    const old = await tokenFor(ALICE);
    await endSessions(ALICE);
    request(old);
    const fd = new FormData();
    fd.set("body", "should not be saved");
    fd.set("accountId", alphaCo);
    await expect(addNoteAction({ ok: false, message: "" }, fd)).rejects.toThrow();
    expect(await baseDb.note.count()).toBe(0);
  });

  it("reads return nothing: notifications and the person's jobs", async () => {
    await baseDb.backgroundJob.create({ data: { kind: "run_account", sellerId: "alpha", label: "Research Alpha Co", createdBy: ALICE } });
    request(await tokenFor(ALICE));
    expect(((await (await myJobs()).json()) as { jobs: unknown[] }).jobs).toHaveLength(1);
    const old = jar.get(SESSION_COOKIE)!;
    await endSessions(ALICE);
    request(old);
    expect(((await (await myJobs()).json()) as { jobs: unknown[] }).jobs).toHaveLength(0);
    expect(await loadNotifications()).toEqual([]);
  });
});

describe("background jobs: the person who started one must still be allowed when it runs", () => {
  const job = (createdBy: string | null, kind = "run_account", sellerId = "alpha") =>
    baseDb.backgroundJob.create({ data: { kind, sellerId, label: "Research Alpha Co", createdBy } });

  it("still allowed: runs (manager of the client, covering Super Admin, or started by the system)", async () => {
    expect(await starterRefusal(await job(ALICE))).toBeNull();
    expect(await starterRefusal(await job(SAM, "run_account", "beta"))).toBeNull();
    expect(await starterRefusal(await job(LENA))).toBeNull();
    expect(await starterRefusal(await job(null))).toBeNull();
  });

  it("removed, unassigned, archived, out of coverage or demoted: not run, with the reason saved", async () => {
    const a = await job(ALICE);
    await baseDb.user.update({ where: { email: ALICE }, data: { status: "removed" } });
    await runJob(a.id);
    const saved = await baseDb.backgroundJob.findUniqueOrThrow({ where: { id: a.id } });
    expect(saved.status).toBe("failed");
    expect(saved.message).toMatch(/no longer has access/);
    await baseDb.user.update({ where: { email: ALICE }, data: { status: "active" } });

    expect(await starterRefusal(await job(LENA, "run_account", "beta"))).toMatch(/no longer has access/);
    expect(await starterRefusal(await job(BOB))).toMatch(/no longer has access/); // Bob isn't on Alpha
    await baseDb.userClient.updateMany({ where: { user: { email: ALICE } }, data: { role: "viewer" } });
    expect(await starterRefusal(await job(ALICE))).toMatch(/role/);
    expect(await starterRefusal(await job(ALICE, "apollo_fetch"))).toMatch(/role/);
    await baseDb.userClient.updateMany({ where: { user: { email: ALICE } }, data: { role: "rep" } });
    expect(await starterRefusal(await job(ALICE, "research_question"))).toBeNull(); // a Rep may ask a research question
    await baseDb.client.update({ where: { id: "alpha" }, data: { status: "archived" } });
    expect(await starterRefusal(await job(ALICE, "research_question"))).toMatch(/no longer has access/);
    await baseDb.userClient.deleteMany({ where: { user: { email: ALICE } } });
    expect(await starterRefusal(await job(ALICE))).toMatch(/no longer has access/);
  });

  it("Sign out everywhere alone doesn't stop the person's jobs (they are still allowed)", async () => {
    const a = await job(ALICE);
    await endSessions(ALICE);
    expect(await starterRefusal(a)).toBeNull();
  });
});
