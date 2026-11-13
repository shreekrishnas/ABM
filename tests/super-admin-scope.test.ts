// Super Admin for some clients: who can make whom a Super Admin, and for which clients.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A signed-in person in Super Admin mode; the test picks who.
const jar = new Map<string, string>();
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined), getAll: () => [...jar].map(([name, value]) => ({ name, value })) }),
  headers: async () => new Headers(),
}));

import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { clearScopeCache, scopeFor } from "@/lib/scope";
import { coversClient, getMe } from "@/lib/me";
import { setAssignmentAction, setClientStatusAction, setSuperAdminAction, setUserStatusAction, setAiPausedAction } from "@/app/team/actions";

const SECRET = "test-secret-for-super-admin-scope";
const prev = process.env.AUTH_SECRET;
beforeAll(() => { process.env.AUTH_SECRET = SECRET; });
afterAll(() => { if (prev === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = prev; });

async function signIn(email: string) {
  jar.clear();
  jar.set(SESSION_COOKIE, await sessionToken(email, SECRET, 0));
  jar.set("abm_mode", "super");
  clearScopeCache();
}

const form = (o: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  // Test clients only.
  await baseDb.client.createMany({ data: [{ id: "test", name: "Test" }, { id: "test-b", name: "Test B" }, { id: "test-c", name: "Test C" }] });
  await baseDb.user.createMany({
    data: [
      { id: "full", name: "Full Admin", email: "full@trilliantdigital.com", superAdmin: true },
      { id: "some", name: "Some Admin", email: "some@trilliantdigital.com", superAdmin: true, superAdminClients: ["test", "test-b"] },
      { id: "rep", name: "Rep One", email: "rep@trilliantdigital.com" },
      { id: "other", name: "Other Rep", email: "other@trilliantdigital.com" },
    ],
  });
  await baseDb.userClient.create({ data: { userId: "other", clientId: "test-c" } });
});

describe("who covers what", () => {
  it("a Super Admin with no list covers every client; one with a list covers only those", async () => {
    await signIn("full@trilliantdigital.com");
    const full = await getMe();
    expect(full).toMatchObject({ superAdmin: true, fullSuperAdmin: true, superAdminClients: null });
    expect(coversClient(full, "test-c")).toBe(true);

    await signIn("some@trilliantdigital.com");
    const some = await getMe();
    expect(some).toMatchObject({ superAdmin: true, fullSuperAdmin: false, superAdminClients: ["test", "test-b"] });
    expect(coversClient(some, "test-b")).toBe(true);
    expect(coversClient(some, "test-c")).toBe(false);
  });

  it("in Super Admin mode a limited Super Admin opens only their clients, and never 'every client'", async () => {
    const s = await scopeFor("some@trilliantdigital.com", true, null);
    expect(s.all).toBe(false);
    expect(s.ids).toEqual(["test", "test-b"]);
    expect(s.choices.map((c) => c.id)).toEqual(["test", "test-b"]);
    // Picking a client outside the list falls back to their own clients.
    expect((await scopeFor("some@trilliantdigital.com", true, "test-c")).ids).toEqual(["test", "test-b"]);
    // A full Super Admin is unchanged: every client.
    const f = await scopeFor("full@trilliantdigital.com", true, null);
    expect(f.all).toBe(true);
    expect(f.ids).toBeNull();
  });
});

describe("making someone a Super Admin", () => {
  it("a full Super Admin can give access to every client or to chosen clients, and take it away", async () => {
    await signIn("full@trilliantdigital.com");
    let r = await setSuperAdminAction(null, form({ userId: "rep", access: "some", clients: ["test-c"] }));
    expect(r).toMatchObject({ ok: true });
    expect(r?.message).toMatch(/Test C/);
    expect(await baseDb.user.findUniqueOrThrow({ where: { id: "rep" } })).toMatchObject({ superAdmin: true, superAdminClients: ["test-c"] });

    r = await setSuperAdminAction(null, form({ userId: "rep", access: "all" }));
    expect(r?.ok).toBe(true);
    expect(await baseDb.user.findUniqueOrThrow({ where: { id: "rep" } })).toMatchObject({ superAdmin: true, superAdminClients: [] });

    r = await setSuperAdminAction(null, form({ userId: "rep", access: "none" }));
    expect(r?.ok).toBe(true);
    expect(await baseDb.user.findUniqueOrThrow({ where: { id: "rep" } })).toMatchObject({ superAdmin: false, superAdminClients: [] });

    const log = await baseDb.auditEntry.findMany({ where: { action: "user.super_admin" }, orderBy: { createdAt: "asc" } });
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ actorEmail: "full@trilliantdigital.com", target: "rep@trilliantdigital.com" });
  });

  it("a limited Super Admin can give only clients they cover, never every client", async () => {
    await signIn("some@trilliantdigital.com");
    expect((await setSuperAdminAction(null, form({ userId: "rep", access: "all" })))?.ok).toBe(false);
    const beyond = await setSuperAdminAction(null, form({ userId: "rep", access: "some", clients: ["test", "test-c"] }));
    expect(beyond).toMatchObject({ ok: false });
    expect(beyond?.message).toMatch(/clients you cover/);
    expect((await baseDb.user.findUniqueOrThrow({ where: { id: "rep" } })).superAdmin).toBe(false);

    const ok = await setSuperAdminAction(null, form({ userId: "rep", access: "some", clients: ["test-b"] }));
    expect(ok?.ok).toBe(true);
    expect(await baseDb.user.findUniqueOrThrow({ where: { id: "rep" } })).toMatchObject({ superAdmin: true, superAdminClients: ["test-b"] });
  });

  it("a limited Super Admin can't change a full Super Admin, and nobody changes their own access", async () => {
    await signIn("some@trilliantdigital.com");
    expect((await setSuperAdminAction(null, form({ userId: "full", access: "none" })))?.ok).toBe(false);
    expect((await baseDb.user.findUniqueOrThrow({ where: { id: "full" } })).superAdmin).toBe(true);
    expect((await setSuperAdminAction(null, form({ userId: "some", access: "some", clients: ["test"] })))?.message).toMatch(/your own/);

    await signIn("full@trilliantdigital.com");
    expect((await setSuperAdminAction(null, form({ userId: "full", access: "none" })))?.ok).toBe(false);
  });

  it("picking no client is refused, and someone who can't sign in can't be given access", async () => {
    await signIn("full@trilliantdigital.com");
    expect((await setSuperAdminAction(null, form({ userId: "rep", access: "some" })))?.message).toMatch(/at least one/);
    await baseDb.user.update({ where: { id: "rep" }, data: { status: "removed" } });
    expect((await setSuperAdminAction(null, form({ userId: "rep", access: "all" })))?.ok).toBe(false);
  });
});

describe("what a limited Super Admin can do", () => {
  it("manages their own clients only", async () => {
    await signIn("some@trilliantdigital.com");
    expect((await setAssignmentAction("rep", "test", true))?.ok).toBe(true);
    expect((await setAssignmentAction("rep", "test-c", true))?.ok).toBe(false);
    expect(await baseDb.userClient.count({ where: { userId: "rep" } })).toBe(1);
    expect((await setClientStatusAction("test-c", "paused"))?.ok).toBe(false);
    expect((await baseDb.client.findUniqueOrThrow({ where: { id: "test-c" } })).status).toBe("active");
  });

  it("can't remove a person who also works on a client they don't cover", async () => {
    await signIn("some@trilliantdigital.com");
    const r = await setUserStatusAction("other", "removed");
    expect(r?.ok).toBe(false);
    expect((await baseDb.user.findUniqueOrThrow({ where: { id: "other" } })).status).toBe("active");
  });

  it("workspace-wide switches stay with Super Admins over every client", async () => {
    await signIn("some@trilliantdigital.com");
    const r = await setAiPausedAction(true);
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/all clients/);
  });
});
