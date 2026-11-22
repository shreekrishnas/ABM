// One Vega: what moved over from the old admin assistant ("This week", saved questions), page
// focus, and the limits that keep it inside the workspace (platform-wide lookups, other clients).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined), getAll: () => [...jar].map(([name, value]) => ({ name, value })) }),
  headers: async () => new Headers(),
}));

import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { clearScopeCache } from "@/lib/scope";
import { REGISTRY, catalog, PLATFORM_ONLY } from "@/lib/agent/registry";
import { authorize } from "@/lib/agent/policy";
import { weeklyDigest } from "@/lib/assistant/digest";
import { listVegaSavedQuestions, removeVegaSavedQuestion, saveVegaQuestion, vegaFocus, vegaThisWeek } from "@/app/vega/actions";

const SECRET = "test-secret-for-vega-unified";
const prev = { secret: process.env.AUTH_SECRET, req: process.env.AUTH_REQUIRED };
beforeAll(() => { process.env.AUTH_SECRET = SECRET; process.env.AUTH_REQUIRED = "true"; });
afterAll(() => {
  for (const [k, v] of [["AUTH_SECRET", prev.secret], ["AUTH_REQUIRED", prev.req]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

async function signIn(email: string, superMode = true) {
  jar.clear();
  jar.set(SESSION_COOKIE, await sessionToken(email, SECRET, 0));
  if (superMode) jar.set("abm_mode", "super");
  clearScopeCache();
}

const ids = { accA: "", accB: "", personA: "", reviewA: "" };

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.client.createMany({ data: [{ id: "test", name: "Client A" }, { id: "test-b", name: "Client B" }] });
  await baseDb.user.createMany({
    data: [
      { id: "full", name: "Full Admin", email: "full@trilliantdigital.com", superAdmin: true },
      { id: "some", name: "Some Admin", email: "some@trilliantdigital.com", superAdmin: true, superAdminClients: ["test"] },
      { id: "rep", name: "Rep A", email: "rep@trilliantdigital.com" },
    ],
  });
  await baseDb.userClient.create({ data: { userId: "rep", clientId: "test", role: "rep" } });
  ids.accA = (await baseDb.account.create({ data: { name: "Alpha Co", domain: "alpha.example", sellerId: "test" } })).id;
  ids.accB = (await baseDb.account.create({ data: { name: "Beta Co", domain: "beta.example", sellerId: "test-b" } })).id;
  ids.personA = (await baseDb.contact.create({ data: { fullName: "Asha A", accountId: ids.accA } })).id;
  ids.reviewA = (await baseDb.reviewItem.create({ data: { type: "proposed_rejection", reason: "rule", stage: 3, accountId: ids.accA } })).id;
  await baseDb.auditEntry.create({ data: { actorEmail: "x@trilliantdigital.com", action: "role.change", target: "someone" } });
});

describe("platform-wide lookups stay with Super Admins covering every client", () => {
  const meSome = { superAdmin: true, superAdminClients: ["test"], clients: [] };
  const meFull = { superAdmin: true, superAdminClients: null, clients: [] };
  const deps = { aiPaused: async () => false, budgetOk: async () => true };

  it("marks the error log, audit log and job leases as platform-only", () => {
    for (const n of ["errors", "audit_log", "jobs"]) expect(REGISTRY[n].platformOnly, n).toBe(true);
    expect(REGISTRY.find_companies.platformOnly).toBeFalsy();
    expect([...PLATFORM_ONLY].sort()).toEqual(["audit_log", "errors", "jobs"]);
  });

  it("leaves them out of the tool list for a limited Super Admin, and refuses them if asked anyway", async () => {
    expect(catalog(0)).not.toMatch(/- audit_log:/);
    expect(catalog(0, { platform: true })).toMatch(/- audit_log:/);
    const v = await authorize(REGISTRY.audit_log, {}, { sellerId: "test", actor: "some@trilliantdigital.com", origin: "chat", me: meSome, maxLevel: 0 }, deps);
    expect(v).toMatchObject({ ok: false, code: "platform_only" });
    expect(await authorize(REGISTRY.audit_log, {}, { sellerId: "test", actor: "full@trilliantdigital.com", origin: "chat", me: meFull, maxLevel: 0 }, deps)).toEqual({ ok: true });
    expect(await authorize(REGISTRY.find_companies, {}, { sellerId: "test", actor: "some@trilliantdigital.com", origin: "chat", me: meSome, maxLevel: 0 }, deps)).toEqual({ ok: true });
  });
});

describe('"This week" (moved over from the old assistant, no AI)', () => {
  it("covers only the clients asked for, and platform-wide items only when asked", async () => {
    const some = await weeklyDigest(new Date(), { clientIds: ["test"], platform: false });
    expect(some.confirmed.join(" ")).toMatch(/Client A/);
    expect(some.confirmed.join(" ")).not.toMatch(/Client B/);
    expect(some.facts.map((f) => f.label)).not.toContain("Sensitive changes");
    const all = await weeklyDigest(new Date());
    expect(all.confirmed.join(" ")).toMatch(/Client B/);
    expect(all.facts.map((f) => f.label)).toContain("Sensitive changes");
  });

  it("a limited Super Admin's digest in Vega shows their clients only; it is saved in that client's conversation", async () => {
    await signIn("some@trilliantdigital.com");
    const r = await vegaThisWeek({ clientId: "test", conversationId: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.message.answer?.title).toMatch(/^This week/);
    expect(JSON.stringify(r.message.answer)).not.toMatch(/Client B|Sensitive changes/);
    expect((await baseDb.assistantConversation.findUnique({ where: { id: r.conversationId } }))?.sellerId).toBe("test");
  });

  it("is refused for a client the Super Admin doesn't cover, and for non-Super Admins", async () => {
    await signIn("some@trilliantdigital.com");
    expect(await vegaThisWeek({ clientId: "test-b", conversationId: null })).toMatchObject({ ok: false });
    await signIn("rep@trilliantdigital.com", false);
    expect(await vegaThisWeek({ clientId: "test", conversationId: null })).toMatchObject({ ok: false });
  });
});

describe("saved questions (moved over from the old assistant)", () => {
  it("are kept per person and can be removed", async () => {
    await signIn("full@trilliantdigital.com");
    expect(await saveVegaQuestion("test", "Which imports failed this week?")).toEqual({ ok: true });
    const list = await listVegaSavedQuestions("test");
    expect(list.map((q) => q.text)).toEqual(["Which imports failed this week?"]);
    await signIn("some@trilliantdigital.com");
    expect(await listVegaSavedQuestions("test")).toEqual([]);
    await signIn("full@trilliantdigital.com");
    await removeVegaSavedQuestion("test", list[0].id);
    expect(await listVegaSavedQuestions("test")).toEqual([]);
  });
});

describe("page focus", () => {
  it("finds the company behind a company page, a person page or an item in Approvals", async () => {
    await signIn("some@trilliantdigital.com");
    expect(await vegaFocus("test", `/accounts/${ids.accA}`, null)).toEqual({ accountId: ids.accA, accountName: "Alpha Co", from: "company" });
    expect(await vegaFocus("test", `/people/${ids.personA}`, null)).toMatchObject({ accountId: ids.accA, from: "person" });
    expect(await vegaFocus("test", "/review", ids.reviewA)).toMatchObject({ accountId: ids.accA, from: "approval" });
    expect(await vegaFocus("test", "/accounts", null, `a_${ids.accA}`)).toMatchObject({ accountId: ids.accA, from: "company" });
    expect(await vegaFocus("test", "/", null, `d_${ids.reviewA}`)).toMatchObject({ accountId: ids.accA, from: "approval" });
    expect(await vegaFocus("test", "/analytics", null)).toBeNull();
  });

  it("never reaches another client's record, even with its id", async () => {
    await signIn("some@trilliantdigital.com");
    expect(await vegaFocus("test", `/accounts/${ids.accB}`, null)).toBeNull();
    expect(await vegaFocus("test-b", `/accounts/${ids.accB}`, null)).toBeNull(); // not a client they cover
    await signIn("full@trilliantdigital.com");
    expect(await vegaFocus("test", `/accounts/${ids.accB}`, null)).toBeNull(); // in client A's Vega
  });
});
