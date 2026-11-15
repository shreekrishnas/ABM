// P0-1: each client has its own record of a company. Two clients can work on the same website
// independently; nothing is created without a client; the API only ever acts for the caller's
// client; replies attach to the exact email they answer; visits count for the visited client.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { ingestRows } from "@/lib/pipeline/ingest";
import { withScope, type Scope } from "@/lib/scope";
import { SELLERS, withSeller } from "@/lib/seller";
import { MANCH } from "@/lib/seller/manch";
import { createClientKey, revokeClientKey } from "@/lib/api-clients";
import { recordVisit } from "@/lib/web/visits";
import { contactLookupAllowed } from "@/lib/discover/approval";
import { POST as accountsPost, GET as accountsGet } from "@/app/api/v1/accounts/route";
import { POST as signalsPost } from "@/app/api/v1/signals/route";
import { POST as repliesPost } from "@/app/api/v1/replies/route";

const A = "test-a", B = "test-b";
const only = (id: string): Scope => ({ ids: [id], active: id, choices: [{ id, name: id }], all: false });
const company = (contact?: { name: string; email: string }) => [{ company: "Acme Example", domain: "acme.example", industry: "fmcg", employees: 1500, country: "IN", ...(contact ? { contactName: contact.name, email: contact.email, title: "CFO" } : {}) }];
const api = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/v1/${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const acmeOf = (sellerId: string) => baseDb.account.findFirstOrThrow({ where: { sellerId, domain: "acme.example" } });

beforeAll(() => {
  SELLERS[A] = { ...MANCH, id: A, name: "Test A" };
  SELLERS[B] = { ...MANCH, id: B, name: "Test B" };
});
afterAll(() => {
  delete SELLERS[A];
  delete SELLERS[B];
});

beforeEach(async () => {
  setAdapters(createMockAdapters());
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.client.createMany({ data: [{ id: A, name: "Test A" }, { id: B, name: "Test B" }] });
});

describe("two clients, one company", () => {
  it("A and B each import acme.example and get independent records; re-importing in A touches only A's", async () => {
    await ingestRows(company(), { sellerId: A, source: "test" });
    await ingestRows(company(), { sellerId: B, source: "test" });
    const [a, b] = [await acmeOf(A), await acmeOf(B)];
    expect(a.id).not.toBe(b.id);
    await ingestRows([{ company: "Acme Example", domain: "acme.example", employees: 9999 }], { sellerId: A, source: "test" });
    expect((await acmeOf(A)).employees).toBe(9999);
    expect((await acmeOf(B)).employees).toBe(1500);
    expect(await baseDb.account.count({ where: { domain: "acme.example" } })).toBe(2);
  });

  it("A's scope can't read or change B's record", async () => {
    await ingestRows(company(), { sellerId: A, source: "test" });
    await ingestRows(company(), { sellerId: B, source: "test" });
    const b = await acmeOf(B);
    await withScope(only(A), async () => {
      expect(await db.account.findUnique({ where: { id: b.id } })).toBeNull();
      expect((await db.account.updateMany({ where: { id: b.id }, data: { name: "Hijacked" } })).count).toBe(0);
      expect((await db.account.findMany({ where: { domain: "acme.example" } })).map((x) => x.sellerId)).toEqual([A]);
    });
    expect((await acmeOf(B)).name).toBe("Acme Example");
  });

  it("the same person in both clients is two records; an import in B never moves A's contact", async () => {
    await ingestRows(company({ name: "Ravi Kumar", email: "ravi@acme.example" }), { sellerId: A, source: "test" });
    const before = await baseDb.contact.findFirstOrThrow({ where: { email: "ravi@acme.example" } });
    // B imports the same person at a differently named record (no scope, like the API or a job).
    await ingestRows([{ company: "Acme Holdings", domain: "acme-holdings.example", contactName: "Ravi Kumar", email: "ravi@acme.example", title: "CFO" }], { sellerId: B, source: "test" });
    const after = await baseDb.contact.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.accountId).toBe(before.accountId);
    const people = await baseDb.contact.findMany({ where: { email: "ravi@acme.example" }, include: { account: { select: { sellerId: true } } } });
    expect(people.map((p) => p.account.sellerId).sort()).toEqual([A, B]);
  });
});

describe("no default client", () => {
  const saved = process.env.TEST_DEFAULT_CLIENT;
  beforeEach(() => { delete process.env.TEST_DEFAULT_CLIENT; });
  afterEach(() => { process.env.TEST_DEFAULT_CLIENT = saved; });

  it("an import with no client, no run and no signed-in scope is refused (never filed under Manch)", async () => {
    await expect(ingestRows(company(), { source: "test" })).rejects.toThrow(/Pick a client/);
    expect(await baseDb.account.count()).toBe(0);
    expect(await baseDb.importBatch.count()).toBe(0);
  });

  it("inside a run for B (a job, the pipeline) it files under B", async () => {
    await withSeller(B, () => ingestRows(company(), { source: "test" }));
    expect((await acmeOf(B)).sellerId).toBe(B);
    expect((await baseDb.importBatch.findFirstOrThrow()).sellerId).toBe(B);
  });

  it("a signed-in person can't import for a client they aren't assigned to", async () => {
    await withScope(only(A), async () => {
      await expect(ingestRows(company(), { sellerId: B, source: "test" })).rejects.toThrow(/not assigned/);
    });
  });
});

describe("the API acts for one client only", () => {
  it("every generated key reads back to its own client (no separator inside the secret)", async () => {
    for (let i = 0; i < 50; i++) {
      const key = await createClientKey(A, "test");
      const r = await accountsGet(new Request("http://localhost/api/v1/accounts", { headers: { authorization: `Bearer ${key}` } }));
      expect(r.status).toBe(200);
    }
  });

  it("a client key files under its client; naming another client is refused", async () => {
    const keyA = await createClientKey(A, "test");
    const r = await accountsPost(api("accounts", { rows: company() }, { authorization: `Bearer ${keyA}` }));
    expect(r.status).toBe(201);
    expect((await acmeOf(A)).sellerId).toBe(A);
    const wrong = await accountsPost(api("accounts", { clientId: B, rows: company() }, { authorization: `Bearer ${keyA}` }));
    expect(wrong.status).toBe(403);
    expect(await baseDb.account.count({ where: { sellerId: B } })).toBe(0);
    // Listing shows only the key's client.
    await ingestRows(company(), { sellerId: B, source: "test" });
    const list = await (await accountsGet(new Request("http://localhost/api/v1/accounts", { headers: { authorization: `Bearer ${keyA}` } }))).json();
    expect(list.data.map((x: { sellerId: string }) => x.sellerId)).toEqual([A]);
  });

  it("the workspace key must name an existing, active client; revoked or wrong keys are refused", async () => {
    expect((await accountsPost(api("accounts", { rows: company() }))).status).toBe(400);
    expect((await accountsPost(api("accounts", { rows: company() }, { "x-client-id": "nope" }))).status).toBe(404);
    await baseDb.client.update({ where: { id: B }, data: { status: "archived" } });
    expect((await accountsPost(api("accounts", { rows: company() }, { "x-client-id": B }))).status).toBe(403);
    expect((await accountsPost(api("accounts", { rows: company() }, { "x-client-id": A }))).status).toBe(201);
    const keyA = await createClientKey(A, "test");
    await revokeClientKey(A, "test");
    expect((await accountsPost(api("accounts", { rows: company() }, { authorization: `Bearer ${keyA}` }))).status).toBe(401);
    expect((await accountsPost(api("accounts", { rows: company() }, { authorization: `Bearer ${keyA}x` }))).status).toBe(401);
  });

  it("signals land on the caller's record of the company; another client's record is not found", async () => {
    await ingestRows(company(), { sellerId: A, source: "test" });
    await ingestRows(company(), { sellerId: B, source: "test" });
    const keyA = await createClientKey(A, "test");
    const bBefore = await acmeOf(B);
    const r = await signalsPost(api("signals", { domain: "acme.example", type: "pricing_visit" }, { authorization: `Bearer ${keyA}` }));
    expect(r.status).toBe(202);
    expect((await r.json()).accountId).toBe((await acmeOf(A)).id);
    expect((await acmeOf(B)).engagementScore).toBe(bBefore.engagementScore);
    const cross = await signalsPost(api("signals", { accountId: bBefore.id, type: "pricing_visit" }, { authorization: `Bearer ${keyA}` }));
    expect(cross.status).toBe(404);
  });
});

describe("replies attach to the email they answer", () => {
  const sent = async (sellerId: string, email: string, n: number) => {
    await ingestRows(company({ name: `Person ${n}`, email }), { sellerId, source: "test" });
    const c = await baseDb.contact.findFirstOrThrow({ where: { email, account: { sellerId } }, orderBy: { createdAt: "desc" } });
    const d = await baseDb.draft.create({ data: { contactId: c.id, stepOrder: 1, subject: "s", body: "b", claims: [], status: "sent" } });
    const m = await baseDb.message.create({ data: { draftId: d.id, contactId: c.id, mailbox: "out@test.example", status: "delivered", sentAt: new Date(), providerId: `<${d.id}@abm.local>` } });
    return { contact: c, draft: d, message: m };
  };

  it("the thread header picks the exact message, in the right client", async () => {
    const a = await sent(A, "ravi@acme.example", 1);
    await sent(B, "ravi@acme.example", 2);
    const r = await repliesPost(api("replies", { fromEmail: "ravi@acme.example", body: "Interested, let's talk", inReplyTo: `<${a.draft.id}@abm.local>` }, { "x-client-id": A }));
    expect(r.status).toBe(202);
    const out = await r.json();
    expect(out).toMatchObject({ contactId: a.contact.id, messageId: a.message.id });
    expect(await baseDb.reply.count({ where: { contact: { account: { sellerId: B } } } })).toBe(0);
  });

  it("another client's thread id doesn't reach their message; without a thread, an ambiguous sender is refused", async () => {
    const b = await sent(B, "ravi@acme.example", 1);
    // A thread id from B, sent as A: not matched to B; falls back to A's people (none) → not found.
    const r = await repliesPost(api("replies", { fromEmail: "ravi@acme.example", body: "Hi", inReplyTo: `<${b.draft.id}@abm.local>` }, { "x-client-id": A }));
    expect(r.status).toBe(404);
    expect(await baseDb.reply.count()).toBe(0);
    // Two people in A emailed from the same address: no thread → 409, nothing recorded.
    await sent(A, "shared@acme.example", 2);
    const second = await baseDb.account.create({ data: { sellerId: A, name: "Acme Two", domain: "acme-two.example" } });
    const c2 = await baseDb.contact.create({ data: { accountId: second.id, fullName: "Shared Two", email: "shared@acme.example" } });
    const d2 = await baseDb.draft.create({ data: { contactId: c2.id, stepOrder: 1, subject: "s", body: "b", claims: [], status: "sent" } });
    await baseDb.message.create({ data: { draftId: d2.id, contactId: c2.id, mailbox: "out@test.example", status: "delivered", sentAt: new Date() } });
    const amb = await repliesPost(api("replies", { fromEmail: "shared@acme.example", body: "Hi" }, { "x-client-id": A }));
    expect(amb.status).toBe(409);
    expect(await baseDb.reply.count()).toBe(0);
  });
});

describe("background work and visits keep the client", () => {
  it("a visit to A's website counts for A's acme, never B's; with no known client and both holding it, it stays unmatched", async () => {
    await ingestRows(company(), { sellerId: A, source: "test" });
    await ingestRows(company(), { sellerId: B, source: "test" });
    const v = await recordVisit({ url: "https://apollo.io/website-visitors", companyDomain: "acme.example", source: "apollo", sellerId: A });
    expect(v.accountId).toBe((await acmeOf(A)).id);
    const unknown = await recordVisit({ url: "https://apollo.io/website-visitors", companyDomain: "acme.example", source: "apollo" });
    expect(unknown.accountId).toBeNull();
  });

  it("contact lookups need this client's approval, not another client's", async () => {
    await ingestRows(company(), { sellerId: A, source: "test" });
    const b = await baseDb.account.create({ data: { sellerId: B, name: "Acme Example", domain: "acme.example" } });
    await baseDb.prospectSuggestion.create({ data: { sellerId: B, name: "Acme Example", nameKey: "acme example", bucket: "fmcg", score: 50, level: "warm", whyNow: "x", sources: [], accountId: b.id, status: "new" } });
    expect(await contactLookupAllowed("acme.example", A)).toBe(true);
    expect(await contactLookupAllowed("acme.example", B)).toBe(false);
    expect(await withSeller(B, () => contactLookupAllowed("acme.example"))).toBe(false);
  });
});
