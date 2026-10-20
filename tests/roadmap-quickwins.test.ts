import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { similarity } from "@/lib/discover/similarity";
import { decideHandoff } from "@/lib/pipeline/stages/engagement";
import { correctFact } from "@/lib/brain/feedback";
const tag = Math.random().toString(36).slice(2, 8);

describe("why similar", () => {
  it("scores shared traits and ignores unknowns", () => {
    const seed = { industry: "Logistics", employees: 2000, country: "IN" };
    const close = similarity(seed, { industry: "Logistics", employees: 3000, country: "IN", whyNow: "Similar to X: Same profile in Apollo (Logistics)", sources: [] });
    expect(close.score).toBe(100);
    const far = similarity(seed, { industry: "Banking", employees: 90000, country: "US", whyNow: "Similar to X: peer", sources: [] });
    expect(far.score).toBe(0);
    const unknown = similarity(seed, { industry: null, employees: null, country: "IN", whyNow: "x", sources: [{ url: "u" }] });
    expect(unknown.score).toBe(100); // only country + evidence known, both match
    expect(unknown.traits.find((t) => t.label === "Size")?.match).toBeNull();
    expect(similarity(null, { industry: null, employees: null, country: null, whyNow: "", sources: [] }).score).toBeNull();
  });
});

describe("hand-off decisions and fact corrections", () => {
  it("sending a hand-off back returns the account to nurture with a re-check date", async () => {
    const a = await db.account.create({ data: { name: `Back Co ${tag}`, nameKey: `back co ${tag}`, stage: "MQA" } });
    const h = await db.handoff.create({ data: { accountId: a.id, trigger: "manual", briefing: { whyNow: "x", facts: [], unknowns: [], engaged: [] } } });
    await decideHandoff(h.id, { decision: "sent_back", reason: "Not ready yet", by: "rep@x.com", recheckDays: 30 });
    const after = await db.handoff.findUniqueOrThrow({ where: { id: h.id } });
    expect(after.status).toBe("sent_back");
    expect(after.decisionReason).toBe("Not ready yet");
    expect((await db.account.findUniqueOrThrow({ where: { id: a.id } })).stage).toBe("WATCH");
    expect(await db.watchlistEntry.count({ where: { accountId: a.id, status: "waiting" } })).toBe(1);
    await expect(decideHandoff(h.id, { decision: "accepted", reason: null, by: "rep@x.com" })).rejects.toThrow(/already/i);
  });

  it("correcting a fact keeps a verified replacement and retires the old one", async () => {
    const a = await db.account.create({ data: { name: `Fact Co ${tag}`, nameKey: `fact co ${tag}` } });
    const e = await db.evidence.create({ data: { accountId: a.id, key: "trigger", claim: "Opened 3 plants", sourceUrl: "https://news.example/a", sourceType: "news", publishedAt: new Date() } });
    await db.twinVersion.create({ data: { accountId: a.id, version: 1, snapshot: { facts: [{ id: e.id, key: "trigger", claim: e.claim, status: "probable", sourceUrl: e.sourceUrl, sourceType: "news", publishedAt: new Date().toISOString() }], inferences: [], contradictions: [], negatives: [], changed: [], unknowns: [], noNegativeNews: true } } });
    await correctFact(e.id, { claim: "Opened 2 plants in Pune", sourceUrl: null, by: "rep@x.com" });
    const old = await db.evidence.findUniqueOrThrow({ where: { id: e.id } });
    expect(old.status).toBe("invalid");
    const fresh = await db.evidence.findUniqueOrThrow({ where: { id: old.supersededById! } });
    expect(fresh.claim).toBe("Opened 2 plants in Pune");
    expect(fresh.status).toBe("verified");
    const twin = await db.twinVersion.findFirstOrThrow({ where: { accountId: a.id } });
    expect((twin.snapshot as { facts: { claim: string }[] }).facts[0].claim).toBe("Opened 2 plants in Pune");
  });
});
