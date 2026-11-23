// P3: multi-client isolation. Campaigns and LinkedIn senders (S-4) and website visitors belong to a
// client; no write may point at another client's company, person or journey; topic and research
// labels are in the client's own words; screens name only the people of the clients in view.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
const hdr = new Map<string, string>();
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined), getAll: () => [...jar].map(([name, value]) => ({ name, value })), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers([...hdr, ["host", "localhost:3000"]]),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

import { baseDb } from "@/lib/db-base";
import { db } from "@/lib/db";
import { GATE_HEADER, REQUEST_ID_HEADER, SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { clearScopeCache } from "@/lib/scope";
import { createCampaignAction, createSenderAction, addNoteAction } from "@/app/actions";
import { claimForClient, ensureJourney } from "@/lib/journey/service";
import { recordVisit, topicOf, topicWordsFor, unknownVisitors, visitSummary } from "@/lib/web/visits";
import { listVisitorCompanies } from "@/lib/web/visitor-prospects";
import { suggestFromVisitors } from "@/lib/discover/visitors";
import { questionLabel } from "@/lib/research/keys";
import { peopleInView } from "@/lib/people";
import { MANCH } from "@/lib/seller/manch";
import { withSeller } from "@/lib/seller";
import { newContext } from "@/lib/pipeline/context";

const SECRET = "test-secret-for-client-isolation";
const prev = { secret: process.env.AUTH_SECRET, req: process.env.AUTH_REQUIRED };
beforeAll(() => { process.env.AUTH_SECRET = SECRET; process.env.AUTH_REQUIRED = "true"; });
afterAll(() => {
  for (const [k, v] of [["AUTH_SECRET", prev.secret], ["AUTH_REQUIRED", prev.req]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const ANA = "ana@trilliantdigital.com"; // Manager of Manch (a client with a complete Account Brain)
const BEN = "ben@trilliantdigital.com"; // Manager of Beta (no Account Brain yet)
const SAM = "sam@trilliantdigital.com"; // Super Admin over every client
const LOU = "lou@trilliantdigital.com"; // Super Admin over Beta only
const OLD = "old@trilliantdigital.com"; // removed
let manchCo = "", betaCo = "", manchPerson = "", betaPerson = "";

beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.client.createMany({ data: [{ id: "manch", name: "Manch" }, { id: "beta", name: "Beta" }] });
  const ana = await baseDb.user.create({ data: { name: "Ana", email: ANA } });
  const ben = await baseDb.user.create({ data: { name: "Ben", email: BEN } });
  const old = await baseDb.user.create({ data: { name: "Old", email: OLD, status: "removed" } });
  await baseDb.user.create({ data: { name: "Sam", email: SAM, superAdmin: true } });
  await baseDb.user.create({ data: { name: "Lou", email: LOU, superAdmin: true, superAdminClients: ["beta"] } });
  await baseDb.userClient.createMany({ data: [{ userId: ana.id, clientId: "manch", role: "manager" }, { userId: ben.id, clientId: "beta", role: "manager" }, { userId: old.id, clientId: "beta", role: "manager" }] });
  manchCo = (await baseDb.account.create({ data: { name: "Manch Co", sellerId: "manch", domain: "manch-co.example" } })).id;
  betaCo = (await baseDb.account.create({ data: { name: "Beta Co", sellerId: "beta", domain: "beta-co.example" } })).id;
  manchPerson = (await baseDb.contact.create({ data: { accountId: manchCo, fullName: "Mira Manch" } })).id;
  betaPerson = (await baseDb.contact.create({ data: { accountId: betaCo, fullName: "Bea Beta" } })).id;
  jar.clear();
  hdr.clear();
  clearScopeCache();
});

let n = 0;
async function as(email: string, o: { mode?: "super"; client?: string } = {}) {
  jar.clear();
  hdr.clear();
  const u = await baseDb.user.findUniqueOrThrow({ where: { email } });
  jar.set(SESSION_COOKIE, await sessionToken(email, SECRET, u.sessionVersion));
  if (o.mode) jar.set("abm_mode", o.mode);
  if (o.client) jar.set("abm_client", o.client);
  hdr.set(GATE_HEADER, "session");
  hdr.set(REQUEST_ID_HEADER, `iso-${++n}`);
}
const names = async (model: "campaign" | "senderProfile") => ((await (db[model] as unknown as { findMany: (a: object) => Promise<{ name: string; sellerId: string | null }[]> }).findMany({ orderBy: { name: "asc" } })).map((c) => `${c.sellerId}:${c.name}`));

describe("S-4: campaigns and LinkedIn senders belong to one client", () => {
  it("each client creates and sees only its own; the same name in two clients is two records", async () => {
    await as(ANA);
    expect(await createCampaignAction("Q4 outreach")).toMatchObject({ ok: true });
    expect(await createSenderAction("Sender Priya")).toMatchObject({ ok: true });
    await as(BEN);
    expect(await createCampaignAction("Q4 outreach")).toMatchObject({ ok: true });
    expect(await names("campaign")).toEqual(["beta:Q4 outreach"]);
    expect(await names("senderProfile")).toEqual([]);
    await as(ANA);
    expect(await names("campaign")).toEqual(["manch:Q4 outreach"]);
    expect(await names("senderProfile")).toEqual(["manch:Sender Priya"]);
    await as(SAM, { mode: "super" });
    expect((await names("campaign")).sort()).toEqual(["beta:Q4 outreach", "manch:Q4 outreach"]);
    // Asking again for the same name reuses the client's own record.
    await as(ANA);
    const again = await createCampaignAction("Q4 outreach");
    expect(await baseDb.campaign.count()).toBe(2);
    expect(again.ok && (await baseDb.campaign.findUniqueOrThrow({ where: { id: again.id } })).sellerId).toBe("manch");
  });

  it("a Viewer can't create campaigns or senders", async () => {
    await baseDb.userClient.updateMany({ where: { user: { email: BEN } }, data: { role: "viewer" } });
    await as(BEN);
    await expect(createCampaignAction("Sneaky")).rejects.toThrow();
    expect(await baseDb.campaign.count()).toBe(0);
  });

  it("another client's campaign or sender can't be used, whatever the id; an unowned one is taken over by its first client", async () => {
    const manchCampaign = await baseDb.campaign.create({ data: { sellerId: "manch", name: "Manch only" } });
    const manchSender = await baseDb.senderProfile.create({ data: { sellerId: "manch", name: "Manch sender" } });
    expect(await claimForClient("campaign", manchCampaign.id, "beta")).toBeNull();
    await expect(ensureJourney(betaPerson, manchCampaign.id, manchSender.id)).rejects.toThrow(/another client/);
    expect(await baseDb.journey.count()).toBe(0);
    expect((await ensureJourney(manchPerson, manchCampaign.id, manchSender.id)).created).toBe(true);
    const legacy = await baseDb.campaign.create({ data: { name: "From before owners" } });
    expect(await claimForClient("campaign", legacy.id, "beta")).toMatchObject({ id: legacy.id });
    expect((await baseDb.campaign.findUniqueOrThrow({ where: { id: legacy.id } })).sellerId).toBe("beta");
    expect(await claimForClient("campaign", legacy.id, "manch")).toBeNull();
  });
});

describe("no write may point at another client's company, person or journey", () => {
  it("creates and updates that reach into another client are refused; your own work", async () => {
    await as(BEN);
    await expect(db.note.create({ data: { body: "x", accountId: manchCo } })).rejects.toThrow(/not assigned/);
    await expect(db.task.create({ data: { title: "x", contactId: manchPerson } })).rejects.toThrow(/not assigned/);
    await expect(db.task.createMany({ data: [{ title: "ok", accountId: betaCo }, { title: "x", accountId: manchCo }] })).rejects.toThrow(/not assigned/);
    const mine = await db.task.create({ data: { title: "Call Bea", accountId: betaCo } });
    await expect(db.task.update({ where: { id: mine.id }, data: { accountId: manchCo } })).rejects.toThrow(/not assigned/);
    await expect(db.account.update({ where: { id: betaCo }, data: { sellerId: "manch" } })).rejects.toThrow(/not assigned/);
    const fd = new FormData();
    fd.set("body", "should not be saved");
    fd.set("accountId", manchCo);
    await expect(addNoteAction({ ok: false, message: "" }, fd)).rejects.toThrow();
    expect(await baseDb.note.count({ where: { accountId: manchCo } })).toBe(0);
    expect(await baseDb.task.count({ where: { accountId: betaCo } })).toBe(1);
    // A full Super Admin works across clients.
    await as(SAM, { mode: "super" });
    expect(await db.note.create({ data: { body: "admin note", accountId: manchCo } })).toBeTruthy();
  });
});

describe("website visitors belong to the client whose site was visited", () => {
  const useCase = MANCH.useCases[0];
  const pageAbout = `https://example.test/solutions/${useCase.key.replace(/_/g, "-")}`;

  it("each client sees only its own visitors; a visit with no client and no company only a full Super Admin", async () => {
    await recordVisit({ url: pageAbout, companyName: "Visitor Ltd", companyDomain: "visitor.example", source: "reverse_ip", sellerId: "manch" });
    await recordVisit({ url: "https://beta.example/", companyName: "Beta Visitor", companyDomain: "beta-visitor.example", source: "reverse_ip", sellerId: "beta" });
    await recordVisit({ url: "https://nowhere.example/", companyName: "Nobody's Visitor", companyDomain: "nobody.example", source: "reverse_ip" });
    expect((await baseDb.webVisit.findMany({ orderBy: { companyName: "asc" } })).map((v) => `${v.companyName}:${v.sellerId}`)).toEqual(["Beta Visitor:beta", "Nobody's Visitor:null", "Visitor Ltd:manch"]);
    const year = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    await as(BEN);
    expect((await unknownVisitors()).map((v) => v.name)).toEqual(["Beta Visitor"]);
    expect((await listVisitorCompanies(year.from, year.to)).map((v) => v.name)).toEqual(["Beta Visitor"]);
    await as(ANA);
    expect((await unknownVisitors()).map((v) => v.name)).toEqual(["Visitor Ltd"]);
    await as(SAM, { mode: "super" });
    expect((await unknownVisitors()).map((v) => v.name).sort()).toEqual(["Beta Visitor", "Nobody's Visitor", "Visitor Ltd"]);
  });

  it("a visit's topic is read in the visited client's own words, never the default client's", async () => {
    expect(topicOf(pageAbout, null, await topicWordsFor("manch")).key).toBe(useCase.key);
    expect(topicOf(pageAbout, null, await topicWordsFor("beta")).key).toBe("general");
    const m = await recordVisit({ url: pageAbout, source: "reverse_ip", sellerId: "manch", companyDomain: "manch-co.example" });
    const b = await recordVisit({ url: pageAbout, source: "reverse_ip", sellerId: "beta", companyDomain: "beta-co.example" });
    expect(m.topic.key).toBe(useCase.key);
    expect(b.topic.key).toBe("general");
    expect((await visitSummary({ accountId: betaCo })).topics.map((t) => t.label)).toEqual(["Website"]);
    expect((await visitSummary({ accountId: manchCo })).topics.map((t) => t.label)).toEqual([useCase.name]);
  });

  it("suggestions from website visitors use only the running client's own visitors", async () => {
    // Beta's site had a hot visitor (three days, pricing pages); Manch's run must not pick it up.
    for (let i = 0; i < 3; i++) await recordVisit({ url: `https://beta.example/pricing?i=${i}`, companyName: "Hot Prospect", companyDomain: "hot.example", source: "reverse_ip", sellerId: "beta", occurredAt: new Date(Date.now() - i * 86_400_000) });
    const r = await withSeller("manch", () => suggestFromVisitors(newContext()));
    expect(r).toEqual({ suggested: 0, excluded: 0, justVisitors: 0 });
    expect(await baseDb.prospectSuggestion.count()).toBe(0);
  });
});

describe("labels and names are the client's own", () => {
  it("a research question is named in the company's client's words", async () => {
    const q = MANCH.researchQuestions.find((x) => !["trigger", "website", "firmographics", "negative"].includes(x.key))!;
    expect(questionLabel(q.key, MANCH)).toBe(q.label);
    expect(questionLabel(q.key, { researchQuestions: [] })).toBe(q.key.replace(/_/g, " "));
  });

  it("screens name only the people of the clients in view (and the Super Admins covering them)", async () => {
    await as(BEN);
    expect((await peopleInView()).map((p) => p.name)).toEqual(["Ben", "Lou", "Sam"]);
    expect((await peopleInView({ activeOnly: false })).map((p) => p.name)).toEqual(["Ben", "Lou", "Old", "Sam"]);
    await as(ANA);
    expect((await peopleInView()).map((p) => p.name)).toEqual(["Ana", "Sam"]);
    await as(LOU, { mode: "super" });
    expect((await peopleInView()).map((p) => p.name)).toEqual(["Ben", "Lou", "Sam"]);
    await as(SAM, { mode: "super" });
    expect((await peopleInView()).map((p) => p.name)).toEqual(["Ana", "Ben", "Lou", "Sam"]);
  });
});
