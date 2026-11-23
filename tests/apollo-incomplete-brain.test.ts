// Production, 22–23 Nov 2026: "Daily visitor pull failed for manch: Unknown seller "nicsphere"".
// The Apollo pull asks every active client for its Account Brain website (clientForSite) to find whose site
// the visitor list tracks. Nicsphere and Wipro 3D still hold the starter Brain saved when they were created
// (no website, no use cases, no triggers). It fails pack validation, so loading it threw "Unknown seller",
// after Apollo's list had been read and before any visit was saved, for the daily pull and the Fetch button
// alike. These tests rebuild that state (the four production clients, in the order Postgres returns them) and
// check: a client with an incomplete Brain never stops the owner's pull, and Apollo's visitors are recorded
// for Manch only, never for Nicsphere, Trilliant Digital or Wipro 3D. Apollo itself is stubbed: no requests.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apollo = vi.hoisted(() => ({ companies: vi.fn(), dates: vi.fn() }));
vi.mock("@/lib/adapters/live/apollo", async (orig) => ({
  ...(await orig<typeof import("@/lib/adapters/live/apollo")>()),
  apolloVisitorCompanies: apollo.companies,
  apolloVisitDates: apollo.dates,
}));
// Suggestions run after the visits are saved and look companies up; not part of what failed.
vi.mock("@/lib/discover/visitors", () => ({ suggestFromVisitors: vi.fn(async () => ({ suggested: 0, excluded: 0, justVisitors: 0 })) }));

import { baseDb } from "@/lib/db-base";
import { clearSellerOverrides, ensureSellerPacks, loadSeller, packSource, withSeller, type SellerProfile } from "@/lib/seller";
import { starterPack } from "@/lib/seller/brain";
import { clientForSite } from "@/lib/web/visits";
import { apolloOwnerClient, dailyVisitorPull, syncApolloVisitors } from "@/lib/web/apollo-sync";
import { newContext } from "@/lib/pipeline/context";

const MANCH_SITE = "https://manchtech.com/en/";
const mode = process.env.ADAPTER_MODE;
const outside = vi.fn(async () => { throw new Error("no outside requests in this test"); });

function visitorList() {
  const list = [
    { name: "Acme Steel", domain: "acmesteel.example", lastSeenAt: null, dateField: null },
    { name: "Bharat Foods", domain: "bharatfoods.example", lastSeenAt: null, dateField: null },
    { name: "Gamma Retail", domain: "gammaretail.example", lastSeenAt: null, dateField: null }, // visited another tracked site only
  ];
  return Object.assign(list, { totalPages: 1, truncated: false });
}
function visitDates() {
  return new Map<string, { at: Date; field: string } | "other_site">([
    ["acmesteel.example", { at: new Date("2026-11-22T09:15:00Z"), field: "domain_aggregates.last_visit (manchtech.com)" }],
    ["bharatfoods.example", { at: new Date("2026-11-21T11:40:00Z"), field: "domain_aggregates.last_visit (manchtech.com)" }],
    ["gammaretail.example", "other_site"],
  ]);
}

beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  clearSellerOverrides();
  delete process.env.APOLLO_VISITOR_SITE;
  process.env.APOLLO_API_KEY = "test-key";
  delete process.env.ADAPTER_MODE;
  vi.stubGlobal("fetch", outside);
  outside.mockClear();
  apollo.companies.mockReset().mockImplementation(async () => visitorList());
  apollo.dates.mockReset().mockImplementation(async () => visitDates());
  // Production's clients, in the order Postgres returns them without ORDER BY (Nicsphere first).
  for (const [id, name] of [["nicsphere", "Nicsphere"], ["trilliant-digital", "Trilliant Digital"], ["wipro-3d", "Wipro 3D"], ["manch", "Manch"]]) {
    await baseDb.client.create({ data: { id, name } });
  }
  // Nicsphere and Wipro 3D: the starter Brain saved when the client was created, never completed.
  for (const [id, name] of [["nicsphere", "Nicsphere"], ["wipro-3d", "Wipro 3D"]]) {
    await baseDb.sellerPackRevision.create({ data: { sellerId: id, pack: starterPack(id, name) as never, version: `${id}-starter`, changed: ["all"], note: "starter" } });
  }
  // Trilliant Digital: a complete Brain with its own website.
  const trilliant = structuredClone(loadSeller("manch").pack) as SellerProfile;
  Object.assign(trilliant, { id: "trilliant-digital", name: "Trilliant Digital", website: "https://trilliantdigital.com/" });
  await baseDb.sellerPackRevision.create({ data: { sellerId: "trilliant-digital", pack: trilliant as never, version: "t1", changed: ["all"], note: "complete" } });
  await ensureSellerPacks(true);
});
afterEach(() => {
  if (mode === undefined) delete process.env.ADAPTER_MODE; else process.env.ADAPTER_MODE = mode;
  delete process.env.APOLLO_API_KEY;
  delete process.env.APOLLO_VISITOR_SITE;
  vi.unstubAllGlobals();
  clearSellerOverrides();
});

describe("Apollo website visitors with a client whose Account Brain is incomplete (production, 22–23 Nov)", () => {
  it("rebuilds production's state: the starter Brain is rejected and loading it says Unknown seller", () => {
    expect(packSource("nicsphere").rejected?.problems.join("; ")).toMatch(/website|useCases|triggers/);
    expect(packSource("wipro-3d").rejected).not.toBeNull();
    expect(() => loadSeller("nicsphere")).toThrow(/Unknown seller "nicsphere"/);
  });

  it("finding the client for a website skips a client whose Brain can't be loaded", async () => {
    await expect(clientForSite(MANCH_SITE)).resolves.toBe("manch");
    await expect(clientForSite("https://www.manchtech.com/en/pricing")).resolves.toBe("manch");
    await expect(clientForSite("https://trilliantdigital.com/about")).resolves.toBe("trilliant-digital");
    await expect(clientForSite("https://unknown.example/")).resolves.toBeNull();
  });

  it("the list's owner is Manch, with APOLLO_VISITOR_SITE unset or set to Manch's website", async () => {
    expect(await apolloOwnerClient()).toBe("manch");
    process.env.APOLLO_VISITOR_SITE = MANCH_SITE;
    expect(await apolloOwnerClient()).toBe("manch");
  });

  it("the daily pull records Apollo's visitors for Manch only, dated by their visit to Manch's site", async () => {
    const r = await dailyVisitorPull(newContext());
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ client: "manch", recorded: 2 });
    expect(apollo.dates).toHaveBeenCalledWith("test-key", ["acmesteel.example", "bharatfoods.example", "gammaretail.example"], MANCH_SITE);
    const visits = await baseDb.webVisit.findMany({ orderBy: { companyName: "asc" } });
    expect(visits.map((v) => [v.companyName, v.sellerId, v.occurredAt.toISOString()])).toEqual([
      ["Acme Steel", "manch", "2026-11-22T09:15:00.000Z"],
      ["Bharat Foods", "manch", "2026-11-21T11:40:00.000Z"],
    ]);
    expect(await baseDb.webVisit.count({ where: { OR: [{ sellerId: { not: "manch" } }, { sellerId: null }] } })).toBe(0);
    expect(await baseDb.pipelineEvent.count({ where: { step: "apollo.visitors", outcome: "error" } })).toBe(0);
    const ev = await baseDb.pipelineEvent.findFirstOrThrow({ where: { step: "apollo.visitors", outcome: "info" } });
    expect(ev.data).toMatchObject({ site: MANCH_SITE, realDates: 2, otherSite: 1 });
    expect(outside).not.toHaveBeenCalled();
  });

  it("the Fetch website visitors job (run inside Manch, forced) records the same visits for Manch", async () => {
    process.env.APOLLO_VISITOR_SITE = MANCH_SITE;
    const r = await withSeller("manch", () => syncApolloVisitors(newContext(), { force: true }));
    expect(r).toMatchObject({ recorded: 2 });
    expect(await baseDb.webVisit.groupBy({ by: ["sellerId"], _count: true })).toEqual([{ sellerId: "manch", _count: 2 }]);
  });

  it("pulled inside Trilliant Digital nothing is fetched or recorded; Nicsphere can't run a pull at all", async () => {
    process.env.APOLLO_VISITOR_SITE = MANCH_SITE;
    const t = await withSeller("trilliant-digital", () => syncApolloVisitors(newContext(), { force: true }));
    expect(t).toMatchObject({ recorded: 0, refusedFor: "manch" });
    await expect(withSeller("nicsphere", () => syncApolloVisitors(newContext(), { force: true }))).rejects.toThrow(/Unknown seller "nicsphere"/);
    expect(apollo.companies).not.toHaveBeenCalled();
    expect(await baseDb.webVisit.count()).toBe(0);
  });

  it("a second pull the same day adds nothing new (no duplicate visits)", async () => {
    await dailyVisitorPull(newContext());
    const again = await withSeller("manch", () => syncApolloVisitors(newContext(), { force: true }));
    expect(again).toMatchObject({ recorded: 0 });
    expect(await baseDb.webVisit.count()).toBe(2);
  });
});
