import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { ingestRows } from "@/lib/pipeline/ingest";
import { contactFromToken, contactToken, recordVisit, tagLinks, topicOf, unknownVisitors, visitSummary } from "@/lib/web/visits";
import { bannedClaimGate } from "@/lib/pipeline/gates";
import { nextBestAction, priorityFor, timingScore, valueScore, type ActionState } from "@/lib/brain/priority";
import { scanMarket } from "@/lib/discover/scan";
import { newContext } from "@/lib/pipeline/context";
import { POST as track } from "@/app/api/v1/track/route";
import { GET as script } from "@/app/api/v1/track/script/route";

beforeEach(async () => {
  setAdapters(createMockAdapters());
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
});

async function company() {
  const r = await ingestRows([{ "Company Name": "Kaveri Foods", "Company Website": "kaverifoods.in", "First Name": "Asha", "Last Name": "Rao", "Job Title": "CIO", Email: "asha@kaverifoods.in" }], { source: "csv" });
  const accountId = r.accountIds[0];
  const contact = await db.contact.findFirstOrThrow({ where: { accountId } });
  return { accountId, contactId: contact.id };
}

describe("website visits", () => {
  it("knows what a page is about", () => {
    expect(topicOf("https://manch.example/pricing").key).toBe("pricing");
    expect(topicOf("https://manch.example/customers/hccb").key).toBe("case_study");
    expect(topicOf("https://manch.example/book-a-demo").key).toBe("demo");
    expect(topicOf("https://manch.example/blog/sap-s4hana-migration-checklist").key).toBe("erp_migration");
    expect(topicOf("https://manch.example/about").key).toBe("general");
  });

  it("person tokens can't be forged", () => {
    const t = contactToken("abc123");
    expect(contactFromToken(t)).toBe("abc123");
    expect(contactFromToken("abc123.forged000000000")).toBeNull();
    expect(contactFromToken("other." + t.split(".")[1])).toBeNull();
  });

  it("a known company's pricing visit becomes a pricing signal, once per page per day", async () => {
    const { accountId } = await company();
    const a = await recordVisit({ url: "https://manch.example/pricing", title: "Pricing", companyDomain: "kaverifoods.in", source: "reverse_ip" });
    expect(a.accountId).toBe(accountId);
    expect(a.signalled).toBe(true);
    const b = await recordVisit({ url: "https://manch.example/pricing", title: "Pricing", companyDomain: "kaverifoods.in", source: "reverse_ip" });
    expect(b.signalled).toBe(false);
    const sig = await db.signal.findMany({ where: { accountId } });
    expect(sig).toHaveLength(1);
    expect(sig[0].type).toBe("pricing_visit");
    const acc = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(acc.priorityScore).not.toBeNull();
    expect((acc.intentReading as { families: string[] }).families).toContain("engagement");
  });

  it("a tracked link identifies the person, and later anonymous visits from that browser stay theirs", async () => {
    const { accountId, contactId } = await company();
    await recordVisit({ url: "https://manch.example/customers/hccb?abm=x", visitorId: "browser12345", token: contactToken(contactId), source: "email_link" });
    const later = await recordVisit({ url: "https://manch.example/pricing", visitorId: "browser12345", source: "tracking_script" });
    expect(later.contactId).toBe(contactId);
    expect(later.accountId).toBe(accountId);
    const s = await visitSummary({ contactId });
    expect(s.total).toBe(2);
    expect(s.interest).toMatch(/pricing/i);
  });

  it("unknown companies from a visitor tool are listed for Discover", async () => {
    await recordVisit({ url: "https://manch.example/pricing", companyName: "Nilgiri Dairy", companyDomain: "nilgiridairy.in", source: "reverse_ip" });
    await recordVisit({ url: "https://manch.example/about", companyName: "Nilgiri Dairy", companyDomain: "nilgiridairy.in", source: "reverse_ip" });
    const v = await unknownVisitors();
    expect(v[0]).toMatchObject({ name: "Nilgiri Dairy", visits: 2, strong: true });
  });

  it("links to our site get the person's token at send time; other links don't", () => {
    process.env.TRACK_ORIGINS = "https://manch.example";
    const out = tagLinks("See https://manch.example/case/hccb and https://other.example/x", "c1");
    expect(out).toMatch(/manch\.example\/case\/hccb\?abm=c1\./);
    expect(out).toMatch(/other\.example\/x(\s|$)/);
    delete process.env.TRACK_ORIGINS;
  });

  it("an email may never mention that someone visited our site", () => {
    expect(bannedClaimGate("I noticed you visited our pricing page last week.", []).pass).toBe(false);
    expect(bannedClaimGate("Saw you were on our website.", []).pass).toBe(false);
    expect(bannedClaimGate("Your distributor expansion in East India stood out.", []).pass).toBe(true);
  });

  it("tracking endpoint and script", async () => {
    const { accountId } = await company();
    void accountId;
    const res = await track(new Request("http://app.test/api/v1/track", { method: "POST", headers: { origin: "https://manch.example" }, body: JSON.stringify({ url: "https://manch.example/pricing", title: "Pricing", visitorId: "abcdefgh1234" }) }));
    expect(res.status).toBe(204);
    expect(await db.webVisit.count()).toBe(1);
    const bad = await track(new Request("http://app.test/api/v1/track", { method: "POST", headers: { origin: "https://manch.example" }, body: JSON.stringify({ url: "https://manch.example/x", visitorId: "<script>" }) }));
    expect(bad.status).toBe(400);
    const js = await (await script(new Request("http://app.test/api/v1/track/script"))).text();
    expect(js).toContain("http://app.test/api/v1/track");
  });
});

describe("priority and next best action", () => {
  it("value and timing", () => {
    expect(valueScore(5000)).toBe(30);
    expect(valueScore(50000)).toBe(74);
    expect(valueScore(null)).toBe(35);
    const now = new Date();
    expect(timingScore({ signals: [{ family: "trigger", label: "x", strength: 1, at: now, refs: [] }] }, now)).toBe(100);
    expect(timingScore({ signals: [] }, now)).toBe(0);
  });

  it("combines the four parts with the pack's weights", () => {
    const now = new Date();
    const p = priorityFor({ fitScore: 80, employees: 50000 }, { score: 70, signals: [{ family: "trigger", label: "x", strength: 1, at: now, refs: [] }] }, now);
    expect(p.parts).toMatchObject({ intent: 70, fit: 80, value: 74, timing: 100 });
    expect(p.score).toBe(Math.round((70 * 40 + 80 * 30 + 74 * 20 + 100 * 10) / 100));
  });

  it("next best action follows the state", () => {
    const base: ActionState = { tier: "T2", level: "warm", stage: "ENGAGED", pipelineStatus: "done", disqualified: false, openHandoff: false, pendingDrafts: 0, people: 2, reachable: 2, emailed: true, replied: false, linkedinConnected: false, strongVisit: false, visitor: null };
    expect(nextBestAction({ ...base, openHandoff: true }).text).toBe("Pick up the hand-off");
    expect(nextBestAction({ ...base, pendingDrafts: 2 }).text).toBe("Approve 2 emails");
    expect(nextBestAction({ ...base, strongVisit: true, visitor: "Asha Rao" }).text).toBe("Call Asha Rao");
    expect(nextBestAction({ ...base, people: 0 }).text).toBe("Find the right people");
    expect(nextBestAction({ ...base, level: "hot", tier: "T1" }).text).toBe("Send a LinkedIn connection");
    expect(nextBestAction(base).text).toBe("Let the sequence run");
    expect(nextBestAction({ ...base, stage: "MQA", strongVisit: true }).text).toBe("Sales is working it");
  });
});

describe("Discover: hiring signals", () => {
  it("job posts for the roles that own the problem become hiring events", async () => {
    await scanMarket(newContext());
    const e = await db.marketEvent.findFirstOrThrow({ where: { company: "Indus Tyres" } });
    expect(e.triggerKey).toBe("hiring");
    const s = await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Indus Tyres" } });
    expect(s.families).toContain("hiring");
  });
});
