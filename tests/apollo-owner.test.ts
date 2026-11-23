// Apollo's website-visitor list belongs to one client, set explicitly: the client whose Account Brain website
// is APOLLO_VISITOR_SITE, else the default client. Never whoever last pressed "Fetch website visitors":
// pulled inside another client, Apollo's visitors would have been recorded as that client's.
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
import { clearSellerOverrides, ensureSellerPacks, loadSeller, withSeller, type SellerProfile } from "@/lib/seller";
import { apolloOwnerClient, syncApolloVisitors } from "@/lib/web/apollo-sync";
import { newContext } from "@/lib/pipeline/context";
import { fetchApolloVisitorsAction } from "@/app/discover/actions";

const SECRET = "test-secret-for-apollo-owner";
const prev = { secret: process.env.AUTH_SECRET, req: process.env.AUTH_REQUIRED, site: process.env.APOLLO_VISITOR_SITE };
beforeAll(() => { process.env.AUTH_SECRET = SECRET; process.env.AUTH_REQUIRED = "true"; });
afterAll(() => {
  for (const [k, v] of [["AUTH_SECRET", prev.secret], ["AUTH_REQUIRED", prev.req], ["APOLLO_VISITOR_SITE", prev.site]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const ANA = "ana@trilliantdigital.com"; // Manager of Manch (the default client)
const BEN = "ben@trilliantdigital.com"; // Manager of Beta

beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  clearSellerOverrides();
  delete process.env.APOLLO_VISITOR_SITE;
  await baseDb.client.createMany({ data: [{ id: "manch", name: "Manch" }, { id: "beta", name: "Beta" }] });
  const ana = await baseDb.user.create({ data: { name: "Ana", email: ANA } });
  const ben = await baseDb.user.create({ data: { name: "Ben", email: BEN } });
  await baseDb.userClient.createMany({ data: [{ userId: ana.id, clientId: "manch", role: "manager" }, { userId: ben.id, clientId: "beta", role: "manager" }] });
  // Beta has a complete Account Brain with its own website.
  const beta = structuredClone(loadSeller("manch").pack) as SellerProfile;
  beta.id = "beta";
  beta.name = "Beta Corp";
  beta.website = "https://beta.example/";
  await baseDb.sellerPackRevision.create({ data: { sellerId: "beta", pack: beta as never, version: "b1", changed: ["all"], note: "complete" } });
  await ensureSellerPacks(true);
  jar.clear();
  hdr.clear();
  clearScopeCache();
});
afterEach(() => clearSellerOverrides());

let n = 0;
async function as(email: string) {
  jar.clear();
  hdr.clear();
  const u = await baseDb.user.findUniqueOrThrow({ where: { email } });
  jar.set(SESSION_COOKIE, await sessionToken(email, SECRET, u.sessionVersion));
  hdr.set(GATE_HEADER, "session");
  hdr.set(REQUEST_ID_HEADER, `apollo-owner-${++n}`);
}

describe("Apollo's website visitors belong to one client, set explicitly", () => {
  it("the owner is the default client, even after another client fetched last", async () => {
    await baseDb.backgroundJob.create({ data: { kind: "apollo_fetch", sellerId: "beta", label: "Fetch website visitors from Apollo", status: "done" } });
    expect(await apolloOwnerClient()).toBe("manch");
  });

  it("the owner follows APOLLO_VISITOR_SITE when it names one client's website", async () => {
    process.env.APOLLO_VISITOR_SITE = "https://www.beta.example/pricing";
    expect(await apolloOwnerClient()).toBe("beta");
    process.env.APOLLO_VISITOR_SITE = "https://unknown.example";
    expect(await apolloOwnerClient()).toBe("manch");
  });

  it("a pull inside another client fetches nothing, records nothing for it, and says why", async () => {
    const r = await withSeller("beta", () => syncApolloVisitors(newContext(), { force: true }));
    expect(r).toMatchObject({ companies: 0, recorded: 0, refusedFor: "manch" });
    expect(await baseDb.webVisit.count()).toBe(0);
    const ev = await baseDb.pipelineEvent.findFirstOrThrow({ where: { step: "apollo.visitors_refused" } });
    expect(ev).toMatchObject({ outcome: "block", accountId: null, data: { sellerId: "beta", owner: "manch" } });
    expect(ev.reason).toMatch(/belong to manch; not pulled for beta/);
    // A refusal never counts as the owner's pull for the day.
    expect(await baseDb.pipelineEvent.count({ where: { step: "apollo.visitors" } })).toBe(0);
  });

  it("the Fetch website visitors button refuses outside the owner's client and starts nothing", async () => {
    await as(BEN);
    const r = await fetchApolloVisitorsAction();
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/belong to Manch\. Switch to Manch to fetch them/) });
    expect(await baseDb.backgroundJob.count({ where: { kind: "apollo_fetch" } })).toBe(0);
  });

  it("inside the owner's client the button starts the fetch for that client", async () => {
    await as(ANA);
    const r = await fetchApolloVisitorsAction();
    expect(r).toMatchObject({ ok: true });
    expect(await baseDb.backgroundJob.findFirstOrThrow({ where: { kind: "apollo_fetch" } })).toMatchObject({ sellerId: "manch" });
  });
});
