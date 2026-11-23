// Website Visitors: annual revenue and employees from the client's own records (never estimated, never
// another client's), and Add to Pipeline once per company: recognised by normalized website within the
// client, no duplicates across sources or concurrent clicks, research already queued or running left as it
// was, and no outside requests when the list is viewed or a company is added.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
const hdr = new Map<string, string>();
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined), getAll: () => [...jar].map(([name, value]) => ({ name, value })), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers([...hdr, ["host", "localhost:3000"]]),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

import { baseDb } from "@/lib/db-base";
import { GATE_HEADER, REQUEST_ID_HEADER, SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { clearScopeCache } from "@/lib/scope";
import { companyFacts, customerCheck, employeesText, exportRows, importCompanies, listVisitorCompanies, REVENUE_META, revenueText, toImportRow } from "@/lib/web/visitor-prospects";
import type { ApolloOrg, ApolloProspect } from "@/lib/adapters/live/apollo";

const SECRET = "test-secret-for-visitor-pipeline";
const prev = { secret: process.env.AUTH_SECRET, req: process.env.AUTH_REQUIRED };
beforeAll(() => { process.env.AUTH_SECRET = SECRET; process.env.AUTH_REQUIRED = "true"; });
afterAll(() => {
  for (const [k, v] of [["AUTH_SECRET", prev.secret], ["AUTH_REQUIRED", prev.req]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const ANA = "ana@trilliantdigital.com"; // Manager of Manch
const BEN = "ben@trilliantdigital.com"; // Manager of Beta
const SAM = "sam@trilliantdigital.com"; // Super Admin over every client
const FROM = new Date("2026-11-01T00:00:00Z");
const TO = new Date("2026-11-30T23:59:59Z");

beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.client.createMany({ data: [{ id: "manch", name: "Manch" }, { id: "beta", name: "Beta" }] });
  const ana = await baseDb.user.create({ data: { name: "Ana", email: ANA } });
  const ben = await baseDb.user.create({ data: { name: "Ben", email: BEN } });
  await baseDb.user.create({ data: { name: "Sam", email: SAM, superAdmin: true } });
  await baseDb.userClient.createMany({ data: [{ userId: ana.id, clientId: "manch", role: "manager" }, { userId: ben.id, clientId: "beta", role: "manager" }] });
  jar.clear();
  hdr.clear();
  clearScopeCache();
});
afterEach(() => vi.unstubAllGlobals());

let n = 0;
async function as(email: string, o: { mode?: "super"; client?: string } = {}) {
  jar.clear();
  hdr.clear();
  clearScopeCache();
  const u = await baseDb.user.findUniqueOrThrow({ where: { email } });
  jar.set(SESSION_COOKIE, await sessionToken(email, SECRET, u.sessionVersion));
  if (o.mode) jar.set("abm_mode", o.mode);
  if (o.client) jar.set("abm_client", o.client);
  hdr.set(GATE_HEADER, "session");
  hdr.set(REQUEST_ID_HEADER, `visitor-pipeline-${++n}`);
}

const visit = (sellerId: string, companyName: string | null, companyDomain: string | null, source = "apollo", day = 15) =>
  baseDb.webVisit.create({ data: { sellerId, companyName, companyDomain, url: "https://apollo.io/website-visitors", path: "/website-visitors", title: "Visited the website (seen by Apollo)", topic: "general", source, occurredAt: new Date(`2026-11-${String(day).padStart(2, "0")}T10:00:00Z`) } });
const org = (o: Partial<ApolloOrg>): ApolloOrg => ({ name: "X", domain: null, industry: null, employees: null, country: null, keywords: [], ...o });
const person = (first: string, domain: string): ApolloProspect => ({ firstName: first, lastName: "Rao", fullName: `${first} Rao`, title: "Chief Financial Officer", email: `${first.toLowerCase()}@${domain}`, linkedinUrl: null, phone: null, seniority: null, department: null, location: null, companyDomain: domain });
/** What a row of the visitor table shows for each company (as the page builds it). */
async function tableRows() {
  const out: Record<string, { inPipeline: boolean; revenue: { text: string; note: string } | null; employees: string | null; visits: number }> = {};
  for (const c of await listVisitorCompanies(FROM, TO)) {
    const chk = await customerCheck(c.name, c.domain);
    const f = await companyFacts(c, chk.account);
    out[c.name] = { inPipeline: chk.inPipeline, revenue: f.revenue ? revenueText(f.revenue) : null, employees: f.employees ? `${f.employees.value} (${f.employees.source})` : null, visits: c.visits };
  }
  return out;
}
const accountsAt = (sellerId: string, domain: string) => baseDb.account.count({ where: { sellerId, domain } });

describe("Annual revenue and employees", () => {
  it("come from the client's own records with currency and period; what isn't recorded says Not available", async () => {
    const acme = await baseDb.account.create({ data: { name: "Acme", sellerId: "manch", domain: "acme.example", employees: 1200 } });
    await baseDb.companyFinancial.create({ data: { accountId: acme.id, fiscalYear: "FY2025", currency: "inr", revenue: 52_000_000_000, source: "annual report", status: "verified" } });
    await visit("manch", "Acme", "acme.example");
    await visit("manch", "Nova Labs", "nova.example");
    await baseDb.visitorEnrichment.create({ data: { sellerId: "manch", companyKey: "d:nova.example", companyName: "Nova Labs", domain: "nova.example", status: "no_prospects", rows: [toImportRow({ name: "Nova Labs", domain: "nova.example" }, org({ name: "Nova Labs", domain: "nova.example", employees: 350, annualRevenueUsd: 48_000_000 }), null)!] } });
    await visit("manch", "Ghost Co", "ghost.example");
    await as(ANA);
    const rows = await tableRows();
    expect(rows["Acme"]).toMatchObject({ inPipeline: true, revenue: { text: "INR 52B", note: "FY2025 · Research (verified)" }, employees: "1,200 (Company record)" });
    expect(rows["Nova Labs"]).toMatchObject({ inPipeline: false, revenue: { text: "USD 48M", note: "Period not stated · Apollo" }, employees: "350 (Apollo)" });
    expect(rows["Ghost Co"]).toMatchObject({ inPipeline: false, revenue: null, employees: null });
  });

  it("show a company record's revenue without inventing a period; employee figures are shown as given", async () => {
    await baseDb.account.create({ data: { name: "Plain Co", sellerId: "manch", domain: "plain.example", revenueUsd: BigInt(7_500_000) } });
    await visit("manch", "Plain Co", "plain.example");
    await as(ANA);
    expect((await tableRows())["Plain Co"]).toMatchObject({ revenue: { text: "USD 7.5M", note: "Period not stated · Company record" }, employees: null });
    expect(employeesText("1000-5000")).toBe("1,000–5,000");
    expect(employeesText("10,001+")).toBe("10,001+");
    expect(employeesText("0")).toBeNull();
    expect(employeesText("")).toBeNull();
  });

  it("Apollo's revenue is kept from the answer already fetched, never invented, and never reaches the download or the import", () => {
    const withRevenue = toImportRow({ name: "Nova Labs", domain: "nova.example" }, org({ name: "Nova Labs", annualRevenueUsd: 48_000_000 }), person("Asha", "nova.example"))!;
    expect(withRevenue[REVENUE_META]).toBe("48000000");
    const without = toImportRow({ name: "Plain Co", domain: "plain.example" }, org({ name: "Plain Co" }), null)!;
    expect(without[REVENUE_META]).toBeUndefined();
    const out = exportRows([{ key: "d:nova.example", name: "Nova Labs", domain: "nova.example", visits: 1, lastVisit: new Date(), pages: [], accountId: null, enrichment: { status: "found", message: null, rows: [withRevenue], enrichedAt: new Date(), importedAt: null } }]);
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]).some((k) => k.startsWith("_"))).toBe(false);
  });
});

describe("Add to Pipeline", () => {
  it("adds a visitor company once; adding it again creates nothing; the status holds in a new session", async () => {
    await visit("manch", "Nova Labs", "nova.example");
    await as(ANA);
    const [c] = await listVisitorCompanies(FROM, TO);
    expect((await customerCheck(c.name, c.domain)).inPipeline).toBe(false);
    expect(await importCompanies([c.key], FROM, TO, { excludeCustomers: true, by: ANA })).toMatchObject({ imported: 1 });
    expect(await accountsAt("manch", "nova.example")).toBe(1);
    // Again (a second click, another tab): found in the pipeline, no second company.
    await importCompanies([c.key], FROM, TO, { excludeCustomers: true, by: ANA });
    expect(await accountsAt("manch", "nova.example")).toBe(1);
    // A new session reads the state from the records: still in the pipeline.
    await as(ANA);
    expect((await tableRows())["Nova Labs"].inPipeline).toBe(true);
  });

  it("recognises a company already in the pipeline by its normalized website within the client, whatever the name", async () => {
    await baseDb.account.create({ data: { name: "Acme", sellerId: "manch", domain: "acme.example" } });
    await visit("manch", "ACME Corporation", "acme.example");
    await as(ANA);
    const rows = await listVisitorCompanies(FROM, TO);
    expect(rows).toHaveLength(1);
    expect((await customerCheck(rows[0].name, rows[0].domain)).inPipeline).toBe(true);
    // A website written another way is the same company.
    expect((await customerCheck("Acme Ltd", "acme.example")).inPipeline).toBe(true);
  });

  it("two sources reporting the same company make one row and one company; a name shared by different websites isn't guessed", async () => {
    await visit("manch", "Orbit Systems", "orbit.example", "apollo", 15);
    await visit("manch", "Orbit Systems Pvt Ltd", null, "tracking_script", 16);
    await visit("manch", "Delta", "delta.example");
    await visit("manch", "Delta", "delta.io");
    await visit("manch", "Delta", null, "tracking_script");
    await as(ANA);
    const rows = await listVisitorCompanies(FROM, TO);
    const orbit = rows.filter((r) => r.name.startsWith("Orbit"));
    expect(orbit).toHaveLength(1);
    expect(orbit[0]).toMatchObject({ key: "d:orbit.example", visits: 2 });
    expect(rows.filter((r) => r.name === "Delta")).toHaveLength(3);
    await importCompanies([orbit[0].key], FROM, TO, { excludeCustomers: true, by: ANA });
    expect(await accountsAt("manch", "orbit.example")).toBe(1);
    // Both sources' visits now count for the one company.
    const acct = await baseDb.account.findFirstOrThrow({ where: { sellerId: "manch", domain: "orbit.example" } });
    expect(await baseDb.webVisit.count({ where: { accountId: acct.id } })).toBe(2);
  });

  it("two adds at the same moment create the company once", async () => {
    await visit("manch", "Nameless Works", null, "tracking_script");
    await as(ANA);
    const [c] = await listVisitorCompanies(FROM, TO);
    const results = await Promise.all([1, 2].map(() => importCompanies([c.key], FROM, TO, { excludeCustomers: false, by: ANA })));
    expect(results.filter((r) => r.busy)).toHaveLength(1);
    expect(await baseDb.account.count({ where: { sellerId: "manch", nameKey: "nameless works" } })).toBe(1);
  });

  it("research already queued or running is left as it was; only the new people are added", async () => {
    const queued = await baseDb.account.create({ data: { name: "Queued Co", sellerId: "manch", domain: "queued.example", pipelineStatus: "queued", queuedFromStage: 0, lastImportBatchId: "earlier-batch" } });
    const running = await baseDb.account.create({ data: { name: "Running Co", sellerId: "manch", domain: "running.example", pipelineStatus: "running" } });
    for (const [name, domain] of [["Queued Co", "queued.example"], ["Running Co", "running.example"]]) {
      await visit("manch", name, domain);
      await baseDb.visitorEnrichment.create({ data: { sellerId: "manch", companyKey: `d:${domain}`, companyName: name, domain, status: "found", rows: [toImportRow({ name, domain }, null, person("Asha", domain))!] } });
    }
    await as(ANA);
    const r = await importCompanies(["d:queued.example", "d:running.example"], FROM, TO, { excludeCustomers: true, by: ANA });
    expect(r.researchKept.sort()).toEqual(["Queued Co", "Running Co"]);
    expect(await baseDb.account.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ pipelineStatus: "queued", queuedFromStage: 0, lastImportBatchId: "earlier-batch" });
    expect(await baseDb.account.findUniqueOrThrow({ where: { id: running.id } })).toMatchObject({ pipelineStatus: "running" });
    expect(await baseDb.contact.count({ where: { accountId: { in: [queued.id, running.id] } } })).toBe(2);
    expect(await baseDb.account.count({ where: { sellerId: "manch" } })).toBe(2);
  });
});

describe("Client isolation", () => {
  it("another client's figures, pipeline status and visitors are never shown", async () => {
    const betaAcme = await baseDb.account.create({ data: { name: "Acme", sellerId: "beta", domain: "acme.example", employees: 9999, revenueUsd: BigInt(123_000_000) } });
    await baseDb.companyFinancial.create({ data: { accountId: betaAcme.id, fiscalYear: "FY2025", currency: "USD", revenue: 123_000_000, source: "filing", status: "verified" } });
    await baseDb.visitorEnrichment.create({ data: { sellerId: "beta", companyKey: "d:acme.example", companyName: "Acme", domain: "acme.example", status: "no_prospects", rows: [toImportRow({ name: "Acme", domain: "acme.example" }, org({ name: "Acme", employees: 9999, annualRevenueUsd: 123_000_000 }), null)!] } });
    await visit("manch", "Acme", "acme.example");
    await visit("beta", "Beta Only Co", "betaonly.example");
    await as(ANA);
    const manch = await tableRows();
    expect(Object.keys(manch)).toEqual(["Acme"]);
    expect(manch["Acme"]).toMatchObject({ inPipeline: false, revenue: null, employees: null });
    await as(BEN);
    expect(Object.keys(await tableRows())).toEqual(["Beta Only Co"]);
    // A Super Admin with no client picked sees one client's visitors (the client the page works for), never a mix.
    await as(SAM, { mode: "super" });
    const one = Object.keys(await tableRows());
    expect(one.length).toBe(1);
  });
});

describe("No outside requests", () => {
  it("viewing the list, its figures and adding a company call no outside service", async () => {
    await baseDb.account.create({ data: { name: "Acme", sellerId: "manch", domain: "acme.example", employees: 1200 } });
    await visit("manch", "Acme", "acme.example");
    await visit("manch", "Nova Labs", "nova.example");
    const fetchSpy = vi.fn(async () => { throw new Error("no outside request expected"); });
    vi.stubGlobal("fetch", fetchSpy);
    const env = { key: process.env.APOLLO_API_KEY, mode: process.env.ADAPTER_MODE };
    process.env.APOLLO_API_KEY = "k";
    process.env.ADAPTER_MODE = "live";
    try {
      await as(ANA);
      await tableRows();
      expect(await importCompanies(["d:nova.example"], FROM, TO, { excludeCustomers: true, by: ANA })).toMatchObject({ imported: 1 });
    } finally {
      if (env.key === undefined) delete process.env.APOLLO_API_KEY; else process.env.APOLLO_API_KEY = env.key;
      if (env.mode === undefined) delete process.env.ADAPTER_MODE; else process.env.ADAPTER_MODE = env.mode;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
