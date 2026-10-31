// Expanded buying group: the stakeholder map, the search for uncovered groups, and the 3–4
// additional influencers grounded in the account's facts.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { newContext } from "@/lib/pipeline/context";
import { groupOf, stakeholderMap, targetGroups, titleOverlap } from "@/lib/buying-group/stakeholders";
import { expandStakeholders, findHiddenInfluencers, latestInfluencerPlan, vetInfluencers } from "@/lib/buying-group/expand";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

async function company(domain: string, tier: "T1" | "T2" | "T3") {
  const r = await ingestRows([{ company: domain.split(".")[0], domain, industry: "fmcg", employees: 9000, country: "IN", contactName: "Asha Mehta", title: "Chief Information Officer", email: `asha@${domain}` }], { source: "test" });
  return db.account.update({ where: { id: r.accountIds[0] }, data: { tier } });
}

async function fact(accountId: string, claim: string) {
  return db.evidence.create({ data: { accountId, key: "trigger", claim, sourceUrl: `https://news.example.com/${Math.random()}`, sourceType: "news", publishedAt: new Date(), status: "verified" } });
}

beforeEach(async () => {
  setAdapters(createMockAdapters());
  await reset();
});

describe("stakeholder map", () => {
  it("files titles into the most specific group", () => {
    expect(groupOf("Data Governance Lead")).toBe("data");
    expect(groupOf("Head of SAP Centre of Excellence")).toBe("data");
    expect(groupOf("Finance Director")).toBe("finance");
    expect(groupOf("Head of Internal Audit")).toBe("risk_compliance");
    expect(groupOf("Plant Head")).toBe("operations");
    expect(groupOf("VP Channel Sales")).toBe("sales_channel");
    expect(groupOf("Managing Director")).toBe("executive");
    expect(groupOf("Chief Information Officer")).toBe("it_digital");
    expect(groupOf("Receptionist")).toBeNull();
  });

  it("puts the seller's persona groups first, then the groups every enterprise deal has", () => {
    expect(targetGroups(["finance", "procurement"]).slice(0, 4)).toEqual(["finance", "procurement", "executive", "operations"]);
    expect(targetGroups([])).toHaveLength(9);
  });

  it("maps people per group and keeps the board separate", () => {
    const m = stakeholderMap([
      { id: "1", fullName: "A", title: "CFO", buyingRole: "decision_maker", stakeholderType: "executive", discoveredBy: null },
      { id: "2", fullName: "B", title: "Independent Director", buyingRole: "influencer", stakeholderType: "independent_director", discoveredBy: "board_research" },
    ], ["finance", "it_digital"]);
    expect(m.covered).toBe(1);
    expect(m.rows.find((r) => r.group.key === "finance")!.people.map((p) => p.fullName)).toEqual(["A"]);
    expect(m.board.map((p) => p.fullName)).toEqual(["B"]);
  });

  it("spots a proposed role the company already has", () => {
    expect(titleOverlap("Head of Internal Audit", "Internal Audit Head")).toBe(1);
    expect(titleOverlap("Plant Head", "Head of Procurement")).toBe(0);
  });
});

describe("additional influencers", () => {
  it("keeps only proposals tied to a held fact, never an obvious buyer, never a role already mapped", () => {
    const { kept, dropped } = vetInfluencers(
      [
        { title: "Head of SAP Centre of Excellence", searchTitles: ["SAP CoE Lead", "CFO"], group: "data", why: "x".repeat(25), factIds: ["f1"] },
        { title: "Chief Financial Officer", searchTitles: ["CFO"], group: "finance", why: "x".repeat(25), factIds: ["f1"] },
        { title: "Head of Treasury", searchTitles: ["Treasury Head"], group: "finance", why: "x".repeat(25), factIds: ["nope"] },
        { title: "Internal Audit Head", searchTitles: ["Internal Audit Head"], group: "risk_compliance", why: "x".repeat(25), factIds: ["f1"] },
        { title: "Plant Head", searchTitles: ["Plant Head"], group: "nowhere", why: "x".repeat(25), factIds: ["f1"] },
      ],
      [{ id: "f1" }],
      ["Head of Internal Audit"],
      4,
    );
    expect(kept.map((k) => k.title)).toEqual(["Head of SAP Centre of Excellence"]);
    expect(kept[0].searchTitles).toEqual(["SAP CoE Lead"]); // the obvious title is stripped from the search
    expect(dropped.map((d) => d.reason)).toEqual([
      "an obvious executive buyer, not an additional influencer",
      "not tied to a fact we hold",
      "already mapped (Head of Internal Audit)",
      'unknown group "nowhere"',
    ]);
  });

  it("proposes four grounded roles for a T1 company, finds a person for each and records why", async () => {
    const a = await company("brightfoods.in", "T1");
    const f1 = await fact(a.id, "brightfoods announced an SAP S/4HANA migration across its plants");
    await fact(a.id, "brightfoods is opening two new manufacturing plants in Gujarat");
    const out = await findHiddenInfluencers(a, newContext());
    expect(out.roles.map((r) => r.title)).toEqual(["Head of SAP Centre of Excellence", "Head of Internal Audit", "Plant Head", "Accounts Payable Lead"]);
    expect(out.dropped.map((d) => d.title).sort()).toEqual(["Chief Financial Officer", "Head of Treasury"]);
    expect(out.roles.every((r) => r.found.length === 1)).toBe(true);
    const people = await db.contact.findMany({ where: { accountId: a.id, discoveredBy: "influencer_search" } });
    expect(people).toHaveLength(4);
    expect(people.every((p) => p.buyingRole === "influencer")).toBe(true);
    const coe = people.find((p) => p.title?.includes("Centre of Excellence"))!;
    // The reason says why, and quotes the fact it rests on.
    expect(coe.influenceReason).toMatch(/^Runs the programme the facts describe.*\. Based on: “brightfoods (announced an SAP|is opening two)/);
    expect(people.some((p) => p.influenceReason!.includes(f1.claim.slice(0, 40)))).toBe(true);
    const plan = await latestInfluencerPlan(a.id);
    expect(plan!.roles).toHaveLength(4);
    // Asked again within 90 days: not repeated (and not charged) unless forced.
    expect((await findHiddenInfluencers(a, newContext())).reason).toMatch(/last 90 days/);
  });

  it("T3 companies don't get influencer proposals, and nothing is proposed without facts", async () => {
    const t3 = await company("smallco.in", "T3");
    expect((await findHiddenInfluencers(t3, newContext())).reason).toMatch(/T3/);
    const t1 = await company("nofacts.in", "T1");
    expect((await findHiddenInfluencers(t1, newContext())).reason).toBe("No facts yet");
  });
});

describe("stakeholder search", () => {
  it("T1 searches the six most important uncovered groups, two people each, filed into the right group", async () => {
    const a = await company("widenet.in", "T1");
    const out = await expandStakeholders(a, newContext());
    expect(out.searched).toHaveLength(6);
    expect(out.searched).not.toContain("it_digital"); // already covered by the imported CIO
    const found = await db.contact.findMany({ where: { accountId: a.id, discoveredBy: "stakeholder_search" } });
    expect(found.length).toBe(12);
    for (const p of found) expect(out.searched).toContain(groupOf(p.title));
  });

  it("T2 searches four groups with one person each; T3 doesn't search", async () => {
    const t2 = await company("midnet.in", "T2");
    const r2 = await expandStakeholders(t2, newContext());
    expect(r2.searched).toHaveLength(4);
    expect(r2.added).toBe(4);
    const t3 = await company("tinynet.in", "T3");
    expect((await expandStakeholders(t3, newContext())).searched).toEqual([]);
  });

  it("never looks people up at a company a person hasn't approved", async () => {
    const a = await company("pendingco.in", "T1");
    await db.prospectSuggestion.create({ data: { sellerId: a.sellerId, origin: "lookalike", name: "pendingco", nameKey: "pendingco", domain: "pendingco.in", bucket: "lookalike", score: 50, level: "warm", whyNow: "", sources: [], status: "new", accountId: a.id } });
    const { approvalGated } = await import("@/lib/discover/approval");
    const base = createMockAdapters();
    setAdapters({ ...base, provider: approvalGated(base.provider) });
    const out = await expandStakeholders(a, newContext());
    expect(out.reason).toBe("company not approved for contact lookups");
    expect(await db.contact.count({ where: { accountId: a.id, discoveredBy: "stakeholder_search" } })).toBe(0);
  });
});
