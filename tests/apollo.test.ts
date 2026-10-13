import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { ApolloProvider, apolloVisitorCompanies, titlesFor } from "@/lib/adapters/live/apollo";
import { syncApolloVisitors } from "@/lib/web/apollo-sync";
import { unknownVisitors } from "@/lib/web/visits";
import { ingestRows } from "@/lib/pipeline/ingest";
import { newContext } from "@/lib/pipeline/context";

type Call = { url: string; method: string; body: Record<string, unknown> | null; key: string | null };
let calls: Call[] = [];
function fakeApollo(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace("/api/v1", "");
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null, key: (init.headers as Record<string, string>)["x-api-key"] ?? null });
    if (!(path in routes)) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status: 200, headers: { "content-type": "application/json" } });
  }));
}

beforeEach(async () => {
  calls = [];
  setAdapters(createMockAdapters());
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.APOLLO_API_KEY;
  delete process.env.APOLLO_VISITOR_LIST;
});

describe("Apollo contact data", () => {
  it("finds people by function using the seller's persona titles, key in the header", async () => {
    fakeApollo({ "/mixed_people/api_search": { people: [{ first_name: "Priya", last_name: "Nair", title: "Chief Procurement Officer", linkedin_url: "https://linkedin.com/in/priya", organization: { primary_domain: "kaverifoods.in" } }] } });
    const people = await new ApolloProvider("k1").findByFunction("kaverifoods.in", "procurement", 2);
    expect(people[0]).toMatchObject({ fullName: "Priya Nair", title: "Chief Procurement Officer", companyDomain: "kaverifoods.in", email: null, source: "apollo" });
    expect(calls[0].key).toBe("k1");
    expect(calls[0].body).toMatchObject({ q_organization_domains_list: ["kaverifoods.in"] });
    expect((calls[0].body!.person_titles as string[]).length).toBeGreaterThan(0);
  });

  it("generic titles when the seller has no persona for a function", () => {
    expect(titlesFor("legal_ops")).toContain("Head of legal ops");
  });

  it("email lookup keeps only real addresses", async () => {
    fakeApollo({ "/people/match": { person: { name: "Asha Rao", email: "asha@kaverifoods.in", email_status: "verified" } } });
    expect(await new ApolloProvider("k").findEmail("Asha Rao", "kaverifoods.in")).toBe("asha@kaverifoods.in");
    fakeApollo({ "/people/match": { person: { name: "Asha Rao", email: "email_not_unlocked@domain.com" } } });
    expect(await new ApolloProvider("k").findEmail("Asha Rao", "kaverifoods.in")).toBeNull();
  });

  it("a refused key says so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("API_INACCESSIBLE", { status: 403 })));
    await expect(new ApolloProvider("k").findByFunction("x.in", "it", 1)).rejects.toThrow(/can't use this endpoint/);
  });
});

describe("Apollo website visitors", () => {
  const routes = {
    "/labels": [{ id: "lbl1", name: "Website Visitors", modality: "accounts" }, { id: "lbl2", name: "Website Visitors", modality: "contacts" }],
    "/accounts/search": { accounts: [{ name: "Kaveri Foods", domain: "kaverifoods.in" }, { name: "Nilgiri Dairy", website_url: "https://www.nilgiridairy.in/" }], pagination: { total_pages: 1 } },
  };

  it("reads the companies from the named account list", async () => {
    fakeApollo(routes);
    const c = await apolloVisitorCompanies("k", { name: "website visitors" });
    expect(c).toEqual([{ name: "Kaveri Foods", domain: "kaverifoods.in" }, { name: "Nilgiri Dairy", domain: "nilgiridairy.in" }]);
    expect(calls.find((x) => x.url.endsWith("/accounts/search"))!.body).toMatchObject({ account_label_ids: ["lbl1"] });
  });

  it("daily sync: known companies get a visit signal, new ones go to Discover, once a day", async () => {
    const r = await ingestRows([{ "Company Name": "Kaveri Foods", "Company Website": "kaverifoods.in" }], { source: "csv" });
    process.env.APOLLO_API_KEY = "k";
    process.env.APOLLO_VISITOR_LIST = "Website Visitors";
    const mode = process.env.ADAPTER_MODE;
    delete process.env.ADAPTER_MODE;
    fakeApollo(routes);
    const out = await syncApolloVisitors(newContext());
    expect(out).toMatchObject({ companies: 2, recorded: 2 });
    const sig = await db.signal.findMany({ where: { accountId: r.accountIds[0] } });
    expect(sig).toHaveLength(1);
    expect(sig[0]).toMatchObject({ type: "site_visit", source: "apollo" });
    expect((await unknownVisitors()).map((v) => v.name)).toEqual(["Nilgiri Dairy"]);
    const s = await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Nilgiri Dairy" } });
    expect(s.origin).toBe("website_visitor");
    expect(await syncApolloVisitors(newContext())).toBeNull(); // already ran today
    if (mode !== undefined) process.env.ADAPTER_MODE = mode;
  });

  it("does nothing without a key", async () => {
    expect(await syncApolloVisitors(newContext())).toBeNull();
  });
});
