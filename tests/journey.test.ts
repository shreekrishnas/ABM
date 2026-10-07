import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { analyzeHeaders, validateRow } from "@/lib/import/fields";
import { applyActivity, classifyReplyRules, eligibleToCall, nextAction, type JourneyState } from "@/lib/journey/engine";
import { parseStage, stageLabel } from "@/lib/journey/stages";
import { ensureJourney, recordActivities } from "@/lib/journey/service";

const D = (s: string) => new Date(`${s}T10:00:00Z`);
const fresh = (): JourneyState => ({ stage: "not_contacted", followUpCount: 0, replyCount: 0, lastEngagementAt: null, lastEngagement: null });
const run = (s: JourneyState, ...acts: Parameters<typeof applyActivity>[1][]) => acts.reduce((st, a) => applyActivity(st, a).next, s);

describe("stage rules (agreed Phase 1 design)", () => {
  it("outreach moves forward and follow-ups are one stage with a counter", () => {
    let s = run(fresh(), { type: "connection_sent", at: D("2026-09-01") }, { type: "connection_accepted", at: D("2026-09-03") });
    expect(s.stage).toBe("connection_accepted");
    s = run(s, { type: "follow_up_sent", at: D("2026-09-05") }, { type: "follow_up_sent", at: D("2026-09-10") });
    expect(s.stage).toBe("follow_up_sent");
    expect(stageLabel(s.stage, s.followUpCount)).toBe("Follow-up Sent (2)");
    s = run(s, { type: "follow_up_sent", at: D("2026-09-15") }, { type: "follow_up_sent", at: D("2026-09-20") }, { type: "follow_up_sent", at: D("2026-09-25") });
    expect(stageLabel(s.stage, s.followUpCount)).toBe("Follow-up Sent (4+)");
    expect(s.lastEngagement).toBe("Follow-up 5 sent");
  });

  it("the reply's meaning sets the stage; every reply counts", () => {
    const base = run(fresh(), { type: "connection_sent", at: D("2026-09-01") }, { type: "connection_accepted", at: D("2026-09-02") });
    const cases: [string, string][] = [
      ["Hi, nice to connect.", "replied_neutral"],
      ["Please share more details.", "details_requested"],
      ["Yes, we are interested.", "interested"],
      ["I will check and inform you.", "nurture"],
      ["We do not have a current requirement.", "not_interested"],
      ["Please contact our production head.", "referred"],
      ["I no longer work there.", "disqualified"],
    ];
    for (const [text, stage] of cases) {
      expect(classifyReplyRules(text).stage).toBe(stage);
      const s = run(base, { type: "reply", at: D("2026-09-04"), text, meaning: classifyReplyRules(text).stage });
      expect(s.stage).toBe(stage);
      expect(s.replyCount).toBe(1);
    }
  });

  it("never moves a qualified person backwards", () => {
    let s = run(fresh(), { type: "connection_sent", at: D("2026-09-01") }, { type: "reply", at: D("2026-09-02"), text: "share details", meaning: "details_requested" }, { type: "details_shared", at: D("2026-09-03") });
    expect(s.stage).toBe("details_shared");
    s = run(s, { type: "follow_up_sent", at: D("2026-09-08") });
    expect(s.stage).toBe("details_shared"); // follow-up counted, stage kept
    expect(s.followUpCount).toBe(1);
    expect(s.lastEngagement).toBe("Follow-up 1 sent");
    s = run(s, { type: "reply", at: D("2026-09-09"), text: "hi", meaning: "replied_neutral" });
    expect(s.stage).toBe("details_shared"); // a neutral reply does not pull them back
    expect(s.replyCount).toBe(2);
    s = run(s, { type: "reply", at: D("2026-09-10"), text: "interested", meaning: "interested" }, { type: "connection_accepted", at: D("2026-09-11") });
    expect(s.stage).toBe("interested");
  });

  it("side stages can recover, closed deals stay closed, a manual stage always wins", () => {
    let s = run(fresh(), { type: "reply", at: D("2026-09-01"), text: "not now", meaning: "nurture" }, { type: "reply", at: D("2026-10-01"), text: "send details", meaning: "details_requested" });
    expect(s.stage).toBe("details_requested");
    s = run(s, { type: "stage_set", at: D("2026-10-02"), stage: "closed_won" }, { type: "reply", at: D("2026-10-03"), text: "thanks", meaning: "not_interested" });
    expect(s.stage).toBe("closed_won");
    expect(run(s, { type: "stage_set", at: D("2026-10-04"), stage: "opportunity" }).stage).toBe("opportunity");
  });

  it("older backfilled activity never replaces a newer last engagement", () => {
    const s = run(fresh(), { type: "follow_up_sent", at: D("2026-09-20") }, { type: "connection_sent", at: D("2026-09-01") });
    expect(s.lastEngagement).toBe("Follow-up 1 sent");
    expect(s.lastEngagementAt?.toISOString().slice(0, 10)).toBe("2026-09-20");
  });

  it("suggests the next action and call eligibility", () => {
    const now = D("2026-10-06");
    expect(nextAction(fresh(), now).text).toBe("Send connection request");
    const fu = { ...fresh(), stage: "follow_up_sent" as const, followUpCount: 2, lastEngagementAt: D("2026-10-04") };
    expect(nextAction(fu, now).text).toBe("Follow-up 3 due 2026-10-09");
    expect(nextAction({ ...fu, lastEngagementAt: D("2026-09-20") }, now).text).toBe("Send follow-up 3");
    expect(nextAction({ ...fu, followUpCount: 4 }, now).text).toMatch(/Nurture or close/);
    const ok = { phone: "+919876543210", suppressed: false, doNotContact: false };
    expect(eligibleToCall(ok, "interested").ok).toBe(true);
    expect(eligibleToCall(ok, "connection_sent").ok).toBe(false);
    expect(eligibleToCall(ok, "not_interested").ok).toBe(false);
    expect(eligibleToCall({ ...ok, phone: null }, "interested").ok).toBe(false);
    expect(eligibleToCall({ ...ok, suppressed: true }, "interested").ok).toBe(false);
    expect(eligibleToCall({ ...ok, companyDisqualified: true }, "interested").ok).toBe(false);
    expect(nextAction(fresh(), now, { disqualifyReason: "Fit 17 below floor 40" }).text).toBe("No outreach — company disqualified (Fit 17 below floor 40)");
  });

  it("parses stage names as people type them", () => {
    expect(parseStage("Replied – Neutral")).toBe("replied_neutral");
    expect(parseStage("follow-up sent (2)")).toBe("follow_up_sent");
    expect(parseStage("Closed - Won")).toBe("closed_won");
    expect(parseStage("8")).toBe("interested");
    expect(parseStage("Nurture or Future")).toBe("nurture");
    expect(parseStage("maybe")).toBeNull();
  });

  it("auto-maps common export headers, including LinkedIn ones", () => {
    const { mapping } = analyzeHeaders(["LinkedIn Profile", "LinkedIn Company", "linkedinUrl", "Invite Sent", "Follow ups", "E-mail"]);
    expect(mapping).toMatchObject({ "LinkedIn Profile": "linkedinUrl", "LinkedIn Company": "companyLinkedin", "Invite Sent": "connectionSent", "Follow ups": "followUps" });
  });

  it("validates LinkedIn activity, company LinkedIn and keywords", () => {
    const headers = ["Company Name", "Company LinkedIn URL", "Keywords", "First Name", "Connection Sent", "Connection Accepted", "Follow-ups Sent", "Last Reply", "Stage"];
    const { mapping } = analyzeHeaders(headers);
    expect(Object.keys(mapping)).toHaveLength(headers.length);
    const ok = validateRow({ "Company Name": "ABC Manufacturing Pvt Ltd", "Company LinkedIn URL": "linkedin.com/company/abc-mfg/", Keywords: "Distributor network; Vendor onboarding", "First Name": "Rahul", "Connection Sent": "20/09/2026", "Connection Accepted": "Yes", "Follow-ups Sent": "2", "Last Reply": "Please share more details." }, mapping);
    expect(ok.ok && ok.row).toMatchObject({ nameKey: "abc manufacturing", companyLinkedin: "https://www.linkedin.com/company/abc-mfg", keywords: ["Distributor network", "Vendor onboarding"], activity: { connectionAccepted: true, followUps: 2 } });
    expect(ok.ok && (ok.row.activity?.connectionSent as Date).toISOString().slice(0, 10)).toBe("2026-09-20");
    const bad = validateRow({ "Company Name": "X", "First Name": "A", Stage: "Maybe later", "Follow-ups Sent": "two", "Company LinkedIn URL": "linkedin.com/in/someone" }, mapping);
    expect(!bad.ok && bad.error).toMatch(/Stage "Maybe later"/);
    expect(!bad.ok && bad.error).toMatch(/Follow-ups Sent/);
    expect(!bad.ok && bad.error).toMatch(/not a company page/);
  });
});

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

const list = [
  { "Company Name": "ABC Manufacturing", "Company Website": "abc-mfg.example", "First Name": "Rahul", "Last Name": "Sharma", "Job Title": "Head of Production", "Person LinkedIn URL": "https://www.linkedin.com/in/rahul-sharma", Phone: "+91 98765 43210" },
  { "Company Name": "ABC Manufacturing", "Company Website": "abc-mfg.example", "First Name": "Neha", "Last Name": "Iyer", "Job Title": "Procurement Manager", "Person LinkedIn URL": "https://www.linkedin.com/in/neha-iyer" },
  { "Company Name": "Delta Beverages", "Company LinkedIn URL": "https://www.linkedin.com/company/delta-beverages", "First Name": "Vikram", "Last Name": "Rao", Email: "vikram@deltabeverages.example" },
];

describe("import: companies, people and sender journeys", () => {
  let campaign: string, s1: string, s2: string;
  beforeAll(() => setAdapters(createMockAdapters()));
  beforeEach(async () => {
    await reset();
    campaign = (await db.campaign.create({ data: { name: "Q4 Distributor Onboarding" } })).id;
    s1 = (await db.senderProfile.create({ data: { name: "Sender 1" } })).id;
    s2 = (await db.senderProfile.create({ data: { name: "Sender 2" } })).id;
  });

  it("creates linked records and a Not Contacted journey per person", async () => {
    const r = await ingestRows(list, { source: "csv", filename: "list.csv", campaignId: campaign, senderId: s1 });
    expect(r.accepted).toBe(3);
    expect(await db.account.count()).toBe(2);
    expect(await db.contact.count()).toBe(3);
    const journeys = await db.journey.findMany();
    expect(journeys).toHaveLength(3);
    expect(journeys.every((j) => j.stage === "not_contacted" && j.senderId === s1 && j.campaignId === campaign)).toBe(true);
    const rahul = await db.contact.findFirstOrThrow({ where: { firstName: "Rahul" }, include: { account: true } });
    expect(rahul.account.name).toBe("ABC Manufacturing");
    expect(rahul.lastName).toBe("Sharma");
  });

  it("the same list for Sender 2 reuses people and never touches Sender 1's journey", async () => {
    await ingestRows(list, { source: "csv", filename: "s1.csv", campaignId: campaign, senderId: s1 });
    const withActivity = list.map((r, i) => (i === 0 ? { ...r, "Connection Sent": "2026-09-20", "Connection Accepted": "2026-09-22", "Follow-ups Sent": "1", "Last Reply": "Yes, we are interested." } : r));
    await ingestRows(withActivity, { source: "csv", filename: "s2.csv", campaignId: campaign, senderId: s2 });
    expect(await db.contact.count()).toBe(3);
    expect(await db.journey.count()).toBe(6);
    const rahul = await db.contact.findFirstOrThrow({ where: { firstName: "Rahul" }, include: { journeys: true } });
    const j1 = rahul.journeys.find((j) => j.senderId === s1)!;
    const j2 = rahul.journeys.find((j) => j.senderId === s2)!;
    expect(j1.stage).toBe("not_contacted");
    expect(j1.replyCount).toBe(0);
    expect(j2.stage).toBe("interested");
    expect(j2.followUpCount).toBe(1);
    expect(j2.replyCount).toBe(1);
  });

  it("CSV activity updates add only what is new; re-uploading changes nothing", async () => {
    await ingestRows(list, { source: "csv", campaignId: campaign, senderId: s1 });
    const week2 = list.map((r, i) => (i === 1 ? { ...r, "Connection Sent": "2026-09-20", "Connection Accepted": "Yes", "Follow-ups Sent": "2", "Last Follow-up Date": "2026-09-30", "Last Reply": "Please share more details.", "Last Reply Date": "2026-10-01" } : r));
    await ingestRows(week2, { source: "csv", campaignId: campaign, senderId: s1 });
    const neha = async () => db.journey.findFirstOrThrow({ where: { contact: { firstName: "Neha" } }, include: { events: true } });
    const a = await neha();
    expect(a.stage).toBe("details_requested");
    expect([a.followUpCount, a.replyCount]).toEqual([2, 1]);
    // Dated follow-ups keep their date; the reply stays the latest engagement.
    expect(a.lastEngagement).toBe("Replied: Please share more details.");
    const events = a.events.length;
    const again = await ingestRows(week2, { source: "csv", campaignId: campaign, senderId: s1 });
    const b = await neha();
    expect(b.events.length).toBe(events);
    expect([b.stage, b.followUpCount, b.replyCount]).toEqual(["details_requested", 2, 1]);
    expect(again.accepted).toBe(3);
  });

  it("matches companies by LinkedIn URL and name, and people by LinkedIn URL before email", async () => {
    await ingestRows(list, { source: "csv", campaignId: campaign, senderId: s1 });
    await ingestRows(
      [
        // Same company found by its LinkedIn page; adds the website it was missing.
        { "Company Name": "Delta Beverages Pvt. Ltd.", "Company LinkedIn URL": "https://linkedin.com/company/delta-beverages", "Company Website": "deltabeverages.example", "First Name": "Vikram", "Last Name": "Rao", Email: "vikram.rao@deltabeverages.example" },
        // Same name, no website → the existing company.
        { "Company Name": "ABC Manufacturing Ltd", "First Name": "Rahul", "Last Name": "Sharma", "Person LinkedIn URL": "linkedin.com/in/rahul-sharma", Email: "rahul@abc-mfg.example" },
        // Same name but a DIFFERENT website → a different company.
        { "Company Name": "ABC Manufacturing", "Company Website": "abc-other.example", "First Name": "Priya" },
      ],
      { source: "csv", campaignId: campaign, senderId: s1 },
    );
    expect(await db.account.count()).toBe(3);
    const delta = await db.account.findFirstOrThrow({ where: { linkedinUrl: "https://www.linkedin.com/company/delta-beverages" } });
    expect(delta.domain).toBe("deltabeverages.example");
    expect(await db.contact.count({ where: { firstName: "Rahul" } })).toBe(1);
    expect((await db.contact.findFirstOrThrow({ where: { firstName: "Rahul" } })).email).toBe("rahul@abc-mfg.example");
    expect(await db.contact.count({ where: { firstName: "Vikram" } })).toBe(1); // email changed, matched by name in the company
  });

  it("a later upload that adds the missing website clears the old blockers", async () => {
    const { runAccount } = await import("@/lib/pipeline/orchestrator");
    await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
    for (const tier of ["T1", "T2", "T3"] as const) await db.sequence.create({ data: { name: tier, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead" }] } } });
    const row = { "Company Name": "Strong Beta Foods", "Company LinkedIn URL": "linkedin.com/company/strong-beta", Industry: "fmcg", "Employee Size": "3000", Country: "IN", "First Name": "Asha", "Last Name": "Mehta", "Job Title": "VP Data", "Person LinkedIn URL": "linkedin.com/in/asha-strong-beta" };
    const first = await ingestRows([row], { source: "csv", campaignId: campaign, senderId: s1 });
    await runAccount(first.accountIds[0]);
    expect(await db.reviewItem.count({ where: { status: "open", type: { in: ["lawful_basis_missing", "identity_conflict", "no_usable_person"] } } })).toBeGreaterThan(0);
    await ingestRows([{ ...row, "Company Website": "strong-beta.com", Email: "asha.mehta@strong-beta.com" }], { source: "csv", campaignId: campaign, senderId: s1 });
    await runAccount(first.accountIds[0], { fromStage: 2 });
    expect((await db.account.findUniqueOrThrow({ where: { id: first.accountIds[0] } })).domain).toBe("strong-beta.com");
    expect(await db.reviewItem.count({ where: { status: "open", type: { in: ["lawful_basis_missing", "identity_conflict", "no_usable_person"] } } })).toBe(0);
  });

  it("two people with the same name but different LinkedIn URLs stay separate", async () => {
    await ingestRows(
      [
        { "Company Name": "ABC Manufacturing", "First Name": "Amit", "Last Name": "Shah", "Person LinkedIn URL": "linkedin.com/in/amit-shah-1" },
        { "Company Name": "ABC Manufacturing", "First Name": "Amit", "Last Name": "Shah", "Person LinkedIn URL": "linkedin.com/in/amit-shah-2" },
        { "Company Name": "ABC Manufacturing", "First Name": "Amit", "Last Name": "Shah" },
      ],
      { source: "csv", campaignId: campaign, senderId: s1 },
    );
    expect(await db.contact.count({ where: { firstName: "Amit" } })).toBe(2);
  });

  it("follow-ups without a date take the row's latest real date, so they land before the reply", async () => {
    await ingestRows([{ ...list[0], "Connection Sent": "2026-09-18", "Connection Accepted": "2026-09-19", "Follow-ups Sent": "2", "Last Reply": "I will check and inform you.", "Last Reply Date": "2026-10-02" }], { source: "csv", campaignId: campaign, senderId: s1 });
    const j = await db.journey.findFirstOrThrow({ include: { events: { orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] } } });
    expect(j.events.map((e) => e.type)).toEqual(["connection_sent", "connection_accepted", "follow_up_sent", "follow_up_sent", "reply"]);
    expect(j.stage).toBe("nurture");
    expect(j.lastEngagement).toBe("Replied: I will check and inform you.");
  });

  it("duplicate rows in one file become one person", async () => {
    const r = await ingestRows([list[0], { ...list[0], Phone: "+91 90000 00000" }], { source: "csv", campaignId: campaign, senderId: s1 });
    expect(r.accepted).toBe(2);
    expect(await db.contact.count()).toBe(1);
    expect(await db.journey.count()).toBe(1);
  });

  it("manual and bulk updates write the timeline and respect the stage rules", async () => {
    await ingestRows(list, { source: "csv", campaignId: campaign, senderId: s1 });
    const rahul = await db.contact.findFirstOrThrow({ where: { firstName: "Rahul" } });
    const { journey } = await ensureJourney(rahul.id, campaign, s1);
    await recordActivities(journey.id, [{ type: "connection_sent", at: D("2026-09-01") }, { type: "connection_accepted", at: D("2026-09-02") }], "bulk");
    await recordActivities(journey.id, [{ type: "reply", at: D("2026-09-03"), text: "Please contact our production head.", meaning: "referred" }], "agent");
    const j = await db.journey.findUniqueOrThrow({ where: { id: journey.id }, include: { events: { orderBy: { createdAt: "asc" } } } });
    expect(j.stage).toBe("referred");
    expect(j.events.map((e) => e.type)).toEqual(["imported", "connection_sent", "connection_accepted", "reply"]);
    expect(j.events.at(-1)?.source).toBe("agent");
    // A second sender's journey for the same person is separate.
    const other = await ensureJourney(rahul.id, campaign, s2);
    expect(other.created).toBe(true);
    expect(other.journey.stage).toBe("not_contacted");
  });
});
