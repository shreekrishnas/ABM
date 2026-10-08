import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runAccount } from "@/lib/pipeline/orchestrator";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { readIntent, scoreIntent, type IntentSignal } from "@/lib/brain/intent";
import { specificityGate } from "@/lib/pipeline/gates";
import { prospectTrack } from "@/lib/journey/track";
import { replay } from "@/lib/brain/bus";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) await db.sequence.create({ data: { name: tier, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead" }] } } });
}
beforeEach(async () => {
  setAdapters(createMockAdapters());
  await reset();
});

const sig = (family: IntentSignal["family"], strength: number, label: string = family): IntentSignal => ({ family, strength, label, at: new Date(), refs: [] });

describe("intent engine", () => {
  it("one loud signal is never hot; independent families converging are", () => {
    const one = scoreIntent([sig("trigger", 1), sig("trigger", 1)]);
    expect(one.level).not.toBe("hot");
    expect(one.score).toBeLessThanOrEqual(45);
    const many = scoreIntent([sig("trigger", 0.9, "Announced S/4HANA migration"), sig("conversation", 0.9, "Asha is interested on LinkedIn"), sig("hiring", 0.7, "Hiring a master-data lead")]);
    expect(many.level).toBe("hot");
    expect(many.families).toEqual(expect.arrayContaining(["trigger", "conversation", "hiring"]));
    expect(many.whyNow).toContain("Asha is interested on LinkedIn");
    expect(many.whyNow).toContain("S/4HANA");
  });

  it("negative news pulls intent down", () => {
    const pos = [sig("trigger", 0.9), sig("conversation", 0.9), sig("hiring", 0.7)];
    expect(scoreIntent([...pos, sig("negative", -0.9)]).score).toBeLessThan(scoreIntent(pos).score);
  });

  it("reads real signals: research facts, a LinkedIn reply and engagement", async () => {
    const campaign = await db.campaign.create({ data: { name: "Q4" } });
    const sender = await db.senderProfile.create({ data: { name: "Sender 1 — Priya" } });
    const r = await ingestRows([{ "Company Name": "Strong Intent Foods", "Company Website": "strong-intent.com", Industry: "fmcg", "Employee Size": "4000", Country: "IN", "First Name": "Asha", "Last Name": "Mehta", "Job Title": "Head of Master Data", "Connection Sent": "2026-09-20", "Last Reply": "Yes, interested — can you share details?", "Last Reply Date": "2026-10-05" }], { source: "csv", campaignId: campaign.id, senderId: sender.id });
    const id = r.accountIds[0];
    await runAccount(id);
    const reading = await readIntent(id);
    expect(reading.families).toEqual(expect.arrayContaining(["trigger", "conversation"]));
    expect(reading.signals.find((s) => s.family === "conversation")?.label).toContain("Asha Mehta");
    expect((await db.account.findUniqueOrThrow({ where: { id } })).intentReading).not.toBeNull();
    expect((await replay({ accountId: id })).some((s) => s.type === "intent.scored")).toBe(true);
  });
});

describe("specificity critic", () => {
  const facts = ["Kaveri Foods will add 3,000 rural distributors across Karnataka this year"];
  it("rejects stock phrases and emails with nothing specific", () => {
    expect(specificityGate("Hi Ravi, I hope this email finds you well. Kaveri Foods could streamline your operations.", "Kaveri Foods", facts).pass).toBe(false);
    expect(specificityGate("Hi Ravi, Kaveri Foods is growing fast. Worth a call?", "Kaveri Foods", facts).reason).toMatch(/Too generic/);
    expect(specificityGate("Hi Ravi, adding 3,000 rural distributors across Karnataka is a big onboarding lift for Kaveri Foods.", "Kaveri Foods", facts).pass).toBe(true);
  });
});

describe("prospect journey", () => {
  it("shows one person's whole track: data checks, brain decisions, email versions, LinkedIn — newest first", async () => {
    const campaign = await db.campaign.create({ data: { name: "Q4" } });
    const sender = await db.senderProfile.create({ data: { name: "Sender 1 — Priya" } });
    const r = await ingestRows([{ "Company Name": "Strong Track Foods", "Company Website": "strong-track.com", Industry: "fmcg", "Employee Size": "4000", Country: "IN", "First Name": "Ravi", "Last Name": "Kumar", "Job Title": "Head of Master Data", "Email": "ravi.kumar@strong-track.com", "Connection Sent": "2026-09-20", "Connection Accepted": "2026-09-22" }], { source: "csv", campaignId: campaign.id, senderId: sender.id });
    await runAccount(r.accountIds[0]);
    const c = await db.contact.findFirstOrThrow({ where: { accountId: r.accountIds[0], fullName: "Ravi Kumar" } });
    const t = await prospectTrack(c.id);
    const kinds = new Set(t.items.map((i) => i.kind));
    for (const k of ["people", "data", "brain", "email", "linkedin"]) expect(kinds).toContain(k);
    expect(t.items.some((i) => i.title.startsWith("Brain decided"))).toBe(true);
    expect(t.items.some((i) => i.title.startsWith("Accepted the LinkedIn connection"))).toBe(true);
    expect(t.reached).toMatchObject({ Added: true, Contacted: true, Drafted: true });
    for (let i = 1; i < t.items.length; i++) expect(t.items[i - 1].at.getTime()).toBeGreaterThanOrEqual(t.items[i].at.getTime());
  });
});
