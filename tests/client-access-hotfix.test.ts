// Security hotfix S-1 / S-2 / S-3: who may change a client's seller profile (Account Brain) and
// knowledge base, and what a client with an unfinished brain is shown. Server actions are called
// directly, as a crafted request would call them: hiding a button is never the check.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const jar = new Map<string, string>();
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined), getAll: () => [...jar].map(([name, value]) => ({ name, value })), set: (k: string, v: string) => jar.set(k, v), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers(),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

import { baseDb } from "@/lib/db-base";
import { db } from "@/lib/db";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { CLIENT_COOKIE, activeSellerState, clearScopeCache } from "@/lib/scope";
import { clearSellerOverrides, ensureSellerPacks, loadSeller, type SellerProfile } from "@/lib/seller";
import { resetPackAction, restorePackAction, savePackAction } from "@/app/settings/seller/actions";
import { addDocumentAction, deleteDocumentAction, reindexAction, searchAction } from "@/app/settings/knowledge/actions";
import { saveBrainSectionAction } from "@/app/brain/actions";
import { previewMatchesAction } from "@/app/actions";
import EditSellerPage from "@/app/settings/seller/edit/page";
import SellerPage from "@/app/settings/seller/page";

const SECRET = "test-secret-for-client-access";
const prev = { secret: process.env.AUTH_SECRET, req: process.env.AUTH_REQUIRED };
beforeAll(() => { process.env.AUTH_SECRET = SECRET; process.env.AUTH_REQUIRED = "true"; });
afterAll(() => {
  for (const [k, v] of [["AUTH_SECRET", prev.secret], ["AUTH_REQUIRED", prev.req]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const USERS = {
  viewerA: { email: "viewer-a@trilliantdigital.com", client: "manch", role: "viewer" },
  repA: { email: "rep-a@trilliantdigital.com", client: "manch", role: "rep" },
  mgrA: { email: "mgr-a@trilliantdigital.com", client: "manch", role: "manager" },
  ownerA: { email: "owner-a@trilliantdigital.com", client: "manch", role: "owner" },
  mgrB: { email: "mgr-b@trilliantdigital.com", client: "client-b", role: "manager" },
} as const;
const LIMITED = "limited@trilliantdigital.com"; // Super Admin over client-b only
const FULL = "full@trilliantdigital.com";

async function signIn(email: string, opts: { superMode?: boolean; client?: string } = {}) {
  jar.clear();
  jar.set(SESSION_COOKIE, await sessionToken(email, SECRET, 0));
  if (opts.superMode) jar.set("abm_mode", "super");
  if (opts.client) jar.set(CLIENT_COOKIE, opts.client);
  clearScopeCache();
}

const manchPack = () => structuredClone(loadSeller("manch").pack) as SellerProfile;
const edited = (tag: string) => { const p = manchPack(); p.messaging.default = `${p.messaging.default} ${tag}`; return JSON.stringify(p); };
const revisions = (sellerId: string) => baseDb.sellerPackRevision.count({ where: { sellerId } });
const denials = (action: string) => baseDb.auditEntry.count({ where: { action: `denied.${action}` } });
const docForm = (title: string) => { const fd = new FormData(); fd.set("title", title); fd.set("text", `${title}: a paragraph long enough to be indexed by the knowledge base, about distributor onboarding.`); fd.set("kind", "document"); return fd; };
let manchRevisionId = "";
let manchDocId = "";

beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  clearSellerOverrides();
  await baseDb.client.createMany({ data: [{ id: "manch", name: "Manch" }, { id: "client-b", name: "Client B" }, { id: "client-c", name: "Client C" }] });
  for (const [, u] of Object.entries(USERS)) {
    const row = await baseDb.user.create({ data: { name: u.email.split("@")[0], email: u.email } });
    await baseDb.userClient.create({ data: { userId: row.id, clientId: u.client, role: u.role } });
  }
  await baseDb.user.create({ data: { name: "Limited", email: LIMITED, superAdmin: true, superAdminClients: ["client-b"] } });
  await baseDb.user.create({ data: { name: "Full", email: FULL, superAdmin: true } });
  // Client C has a complete brain of its own; client B has none yet.
  const c = manchPack(); c.id = "client-c"; c.name = "Client C Corp";
  await baseDb.sellerPackRevision.create({ data: { sellerId: "client-c", pack: c as never, version: "c1", changed: ["all"], note: "complete" } });
  manchRevisionId = (await baseDb.sellerPackRevision.create({ data: { sellerId: "manch", pack: manchPack() as never, version: "m1", changed: ["all"], note: "baseline" } })).id;
  manchDocId = (await baseDb.knowledgeDoc.create({ data: { sellerId: "manch", key: "upload:manch-secret", origin: "upload", kind: "document", title: "Manch secret pricing notes", text: "zebracorn pricing notes for Manch only", approved: false, hash: "x" } })).id;
  await ensureSellerPacks(true);
});

describe("S-1: seller profile (Account Brain) changes", () => {
  it("refuses a Viewer and a Rep on their own client (save, restore, reset), and audits it", async () => {
    for (const u of [USERS.viewerA, USERS.repA]) {
      await signIn(u.email);
      const before = await revisions("manch");
      expect(await savePackAction("manch", edited(u.role), "x"), `${u.role} save`).toMatchObject({ ok: false, message: expect.stringMatching(/needs Manager access/) });
      expect(await restorePackAction(manchRevisionId), `${u.role} restore`).toMatchObject({ ok: false });
      expect(await resetPackAction("manch"), `${u.role} reset`).toMatchObject({ ok: false });
      expect(await revisions("manch"), `${u.role}: nothing saved`).toBe(before);
    }
    expect(await denials("account_brain.profile_save")).toBe(2);
    expect(await denials("account_brain.profile_restore")).toBe(2);
    expect(await denials("account_brain.profile_reset")).toBe(2);
  });

  it("refuses a Manager of another client, and a Super Admin limited to another client", async () => {
    for (const [email, superMode] of [[USERS.mgrB.email, false], [LIMITED, true]] as const) {
      await signIn(email, { superMode });
      expect(await savePackAction("manch", edited("b"), "x"), email).toMatchObject({ ok: false, message: "You don't have access to that client" });
      expect(await restorePackAction(manchRevisionId), email).toMatchObject({ ok: false, message: "You don't have access to that client" });
      expect(await resetPackAction("manch"), email).toMatchObject({ ok: false, message: "You don't have access to that client" });
    }
    expect(await revisions("manch")).toBe(1);
  });

  it("lets the client's own Manager and Owner, and a full Super Admin, save, restore and reset", async () => {
    await signIn(USERS.mgrA.email);
    expect(await savePackAction("manch", edited("mgr"), "x")).toMatchObject({ ok: true });
    await signIn(USERS.ownerA.email);
    expect(await savePackAction("manch", edited("owner"), "x")).toMatchObject({ ok: true });
    expect(await restorePackAction(manchRevisionId)).toMatchObject({ ok: true });
    await signIn(FULL, { superMode: true });
    expect(await savePackAction("manch", edited("full"), "x")).toMatchObject({ ok: true });
    expect(await resetPackAction("manch")).toMatchObject({ ok: true });
    expect(await baseDb.auditEntry.count({ where: { action: { in: ["account_brain.profile_save", "account_brain.profile_restore", "account_brain.profile_reset"] }, clientId: "manch" } })).toBe(5);
  });

  it("crafted calls with wrong argument types are refused, never thrown", async () => {
    await signIn(USERS.mgrB.email);
    expect(await savePackAction(123 as never, "{}", "x")).toMatchObject({ ok: false });
    expect(await savePackAction(null as never, "{}", "x")).toMatchObject({ ok: false });
    expect(await restorePackAction({ id: manchRevisionId } as never)).toMatchObject({ ok: false });
    expect(await resetPackAction(["manch"] as never)).toMatchObject({ ok: false });
    expect(await revisions("manch")).toBe(1);
  });

  it("the profile editor page answers 'not found' to anyone who may not edit it, whatever ?seller= says", async () => {
    const page = (seller?: string) => EditSellerPage({ searchParams: Promise.resolve(seller ? { seller } : {}) });
    const notFound = (e: unknown) => String((e as { digest?: string }).digest ?? "").includes("404");
    for (const [email, superMode] of [[USERS.mgrB.email, false], [USERS.viewerA.email, false], [USERS.repA.email, false], [LIMITED, true]] as const) {
      await signIn(email, { superMode });
      await expect(page("manch").then(() => "rendered", (e) => (notFound(e) ? "not found" : String(e))), email).resolves.toBe("not found");
    }
    await signIn(USERS.mgrA.email);
    await expect(page("manch")).resolves.toBeTruthy();
    await signIn(FULL, { superMode: true });
    await expect(page("manch")).resolves.toBeTruthy();
  });

  it("the Account Brain editor (the other way in) has the same rule, and audits refusals", async () => {
    const items = [{ name: "Probe", website: "https://probe.example", summary: "probe" }] as never;
    await signIn(USERS.viewerA.email);
    expect(await saveBrainSectionAction("manch", "overview", items)).toMatchObject({ ok: false });
    await signIn(USERS.mgrB.email);
    expect(await saveBrainSectionAction("manch", "overview", items)).toMatchObject({ ok: false, message: "You don't have access to that client" });
    expect(await denials("account_brain.edit")).toBe(2);
    await signIn(LIMITED, { superMode: true });
    expect(await saveBrainSectionAction("client-b", "overview", items)).toMatchObject({ ok: true }); // the client they cover
  });
});

describe("S-2: knowledge base", () => {
  it("files a document under the client in view, never under the default client", async () => {
    await signIn(USERS.mgrB.email);
    expect(await addDocumentAction(null, docForm("Client B playbook"))).toMatchObject({ ok: true });
    const doc = await baseDb.knowledgeDoc.findFirst({ where: { title: "Client B playbook" } });
    expect(doc?.sellerId).toBe("client-b");
    expect(await baseDb.knowledgeDoc.count({ where: { sellerId: "manch" } })).toBe(1); // only the original
  });

  it("refuses uploads, deletes and re-indexing by a Viewer or a Rep, and audits them", async () => {
    for (const u of [USERS.viewerA, USERS.repA]) {
      await signIn(u.email);
      expect(await addDocumentAction(null, docForm(`${u.role} upload`)), u.role).toMatchObject({ ok: false, message: expect.stringMatching(/needs Manager access/) });
      expect(await deleteDocumentAction(manchDocId), u.role).toMatchObject({ ok: false });
      expect(await reindexAction(), u.role).toMatchObject({ ok: false });
    }
    expect(await baseDb.knowledgeDoc.count({ where: { sellerId: "manch" } })).toBe(1);
    expect(await denials("knowledge.add")).toBe(2);
    expect(await denials("knowledge.delete")).toBe(2);
    expect(await denials("knowledge.reindex")).toBe(2);
    expect(await baseDb.backgroundJob.count()).toBe(0);
  });

  it("Client B can neither read nor delete Client A's documents", async () => {
    await signIn(USERS.mgrB.email);
    expect(await db.knowledgeDoc.count()).toBe(0); // scoped read
    const s = await searchAction("zebracorn pricing");
    expect(s.ok && s.hits.map((h) => h.title)).toEqual([]);
    expect(await deleteDocumentAction(manchDocId)).toMatchObject({ ok: false, message: "You don't have access to that client" });
    expect(await baseDb.knowledgeDoc.findUnique({ where: { id: manchDocId } })).not.toBeNull();
    expect(await deleteDocumentAction("no-such-doc")).toMatchObject({ ok: false });
  });

  it("re-indexing waits for a finished brain; the client's own Manager may delete its documents", async () => {
    await signIn(USERS.mgrB.email);
    expect(await reindexAction()).toMatchObject({ ok: false, message: expect.stringMatching(/Finish the Account Brain first/) });
    await signIn(USERS.mgrA.email);
    expect(await reindexAction()).toMatchObject({ ok: true });
    expect((await baseDb.backgroundJob.findFirst())?.sellerId).toBe("manch");
    expect(await deleteDocumentAction(manchDocId)).toMatchObject({ ok: true });
    expect(await baseDb.auditEntry.count({ where: { action: { in: ["knowledge.reindex", "knowledge.delete"] }, clientId: "manch" } })).toBe(2);
  });

  it("a limited Super Admin works in the client they cover, not in others", async () => {
    await signIn(LIMITED, { superMode: true, client: "client-b" });
    expect(await addDocumentAction(null, docForm("Covered client doc"))).toMatchObject({ ok: true });
    expect((await baseDb.knowledgeDoc.findFirst({ where: { title: "Covered client doc" } }))?.sellerId).toBe("client-b");
    expect(await deleteDocumentAction(manchDocId)).toMatchObject({ ok: false });
  });
});

describe("S-3: a client whose Account Brain is unfinished", () => {
  it("is shown its own identity and what is missing, never Manch's profile; nothing is written", async () => {
    const before = await baseDb.sellerPackRevision.count();
    await signIn(USERS.mgrB.email);
    const s = await activeSellerState();
    expect(s).toMatchObject({ id: "client-b", ready: false });
    expect(s.pack.name).toBe("Client B");
    expect(s.missing.length).toBeGreaterThan(0);
    const manch = loadSeller("manch").pack;
    expect(JSON.stringify(s.pack)).not.toContain(manch.name);
    expect(JSON.stringify(s.pack)).not.toContain(manch.positioning.slice(0, 40));
    const html = renderToStaticMarkup(await SellerPage());
    expect(html).toContain("Client B");
    expect(html).toContain("Account Brain incomplete");
    expect(html).toContain("Finish the Account Brain"); // a Manager may continue the set-up
    expect(html).not.toContain(manch.name);
    expect(html).not.toContain("Edit profile");
    expect(await baseDb.sellerPackRevision.count()).toBe(before);
  });

  it("the import preview uses the client's own rule and says research waits for the brain", async () => {
    await signIn(USERS.mgrB.email);
    const c = await baseDb.campaign.create({ data: { name: "Camp" } });
    const sdr = await baseDb.senderProfile.create({ data: { name: "Sender" } });
    const pv = await previewMatchesAction({ companies: [{ domain: "x.example", companyLinkedin: null, nameKey: "x", name: "X", country: "US", employees: 10 }], people: [], campaignId: c.id, senderId: sdr.id });
    expect(pv).toMatchObject({ brainReady: false, rule: null, fit: 1, outside: 0 });
  });

  it("completed brains are unchanged: Manch and a client with its own brain", async () => {
    await signIn(USERS.mgrA.email);
    expect(await activeSellerState()).toMatchObject({ id: "manch", ready: true, pack: { name: loadSeller("manch").pack.name } });
    const html = renderToStaticMarkup(await SellerPage());
    expect(html).toContain("Edit profile");
    await signIn(FULL, { superMode: true, client: "client-c" });
    expect(await activeSellerState()).toMatchObject({ id: "client-c", ready: true, pack: { name: "Client C Corp" } });
  });

  it("a Viewer sees the profile but no way to edit it", async () => {
    await signIn(USERS.viewerA.email);
    const html = renderToStaticMarkup(await SellerPage());
    expect(html).toContain(loadSeller("manch").pack.name);
    expect(html).not.toContain("Edit profile");
  });
});
