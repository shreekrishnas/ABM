import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { MANCH } from "@/lib/seller/manch";
import { ingestRows } from "@/lib/pipeline/ingest";
import { newContext } from "@/lib/pipeline/context";
import { findLookalikes } from "@/lib/discover/lookalike";
import { withSeller } from "@/lib/seller";
import { suggestFromVisitors } from "@/lib/discover/visitors";
import { addSuggestion } from "@/lib/discover/scan";
import { recordVisit } from "@/lib/web/visits";

let saved: typeof MANCH.icp.mustHave;
beforeAll(() => {
  saved = MANCH.icp.mustHave;
  MANCH.icp.mustHave = { countries: ["IN"], minEmployees: 5001 };
});
afterAll(() => {
  MANCH.icp.mustHave = saved;
});
beforeEach(async () => {
  setAdapters(createMockAdapters());
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
});

describe("source 2: companies similar to a website", () => {
  it("finds peers, checks the targeting rule, skips companies already held, waits for approval", async () => {
    await ingestRows([{ "Company Name": "Saffron Foods", "Company Website": "saffronfoods.in" }], { source: "csv" });
    const r = await findLookalikes("https://www.kaverifoods.in/about", newContext());
    expect(r.seed).toBe("Kaverifoods");
    expect(r.found).toBeGreaterThan(3);
    const all = await db.prospectSuggestion.findMany({ where: { origin: "lookalike" } });
    const by = (n: string) => all.find((s) => s.name === n);
    expect(by("Saffron Foods")).toBeUndefined(); // already a company
    expect(by("Narmada Pharma")).toMatchObject({ status: "new", seed: "Kaverifoods", country: "IN" });
    expect(by("Narmada Pharma")!.whyNow).toMatch(/^Similar to Kaverifoods/);
    expect(by("Marina Retail Group")).toMatchObject({ status: "excluded" }); // Singapore
    expect(by("Godavari Generics")).toMatchObject({ status: "excluded" }); // 3,100 employees
    expect(await db.account.count()).toBe(1); // nothing added before approval
  });
});

describe("source 3: website visitors", () => {
  it("visiting companies with 2+ buying signals become suggestions (targeting rule not applied); a single plain visit stays a visitor", async () => {
    await recordVisit({ url: "https://seller.example/pricing", companyName: "Lotus Consumer Brands", companyDomain: "lotusconsumer.in", source: "apollo", sellerId: "manch" });
    await recordVisit({ url: "https://seller.example/case-study", companyName: "Lotus Consumer Brands", companyDomain: "lotusconsumer.in", source: "apollo", sellerId: "manch" });
    await recordVisit({ url: "https://seller.example/", companyName: "Marina Retail Group", source: "apollo", sellerId: "manch" });
    const r = await withSeller("manch", () => suggestFromVisitors(newContext()));
    // Lotus looked at pricing and a case study (two signals); Marina only opened the home page once.
    expect(r).toEqual({ suggested: 1, excluded: 0, justVisitors: 1 });
    expect(await db.prospectSuggestion.count({ where: { name: "Marina Retail Group" } })).toBe(0);
    const s = await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Lotus Consumer Brands" } });
    expect(s).toMatchObject({ origin: "website_visitor", status: "new", country: "IN" });
    expect(s.whyNow).toMatch(/Visited your website and .*pricing/i);
  });

  it("approving starts the normal flow and the earlier visits move to the new company", async () => {
    await recordVisit({ url: "https://seller.example/pricing", companyName: "Lotus Consumer Brands", companyDomain: "lotusconsumer.in", source: "apollo", sellerId: "manch" });
    await recordVisit({ url: "https://seller.example/case-study", companyName: "Lotus Consumer Brands", companyDomain: "lotusconsumer.in", source: "apollo", sellerId: "manch" });
    await withSeller("manch", () => suggestFromVisitors(newContext()));
    const s = await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Lotus Consumer Brands" } });
    const id = await addSuggestion(s.id);
    const acc = await db.account.findUniqueOrThrow({ where: { id: id! } });
    expect(acc).toMatchObject({ source: "website-visitor", pipelineStatus: "queued" });
    expect(await db.webVisit.count({ where: { accountId: id } })).toBe(2);
    expect((await db.prospectSuggestion.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("added");
  });
});
