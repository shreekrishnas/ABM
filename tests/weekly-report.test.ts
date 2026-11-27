// The weekly report and the company page's "At a glance" answers: worth pursuing, why now, who to
// contact, next step. Both are read from stored data only, and only within the clients in view.
import { beforeEach, describe, expect, it } from "vitest";
import { baseDb } from "@/lib/db-base";
import { withScope } from "@/lib/scope";
import { glanceForOne, pickContact } from "@/lib/accounts/glance";
import { changeLine, weeklyReport } from "@/lib/reports/weekly";

const NOW = new Date("2026-11-27T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const manch = { ids: ["manch"], active: "manch", choices: [{ id: "manch", name: "Manch" }], all: false };
let hot = "";

beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.client.createMany({ data: [{ id: "manch", name: "Manch" }, { id: "acme", name: "Acme" }] });
  const a = await baseDb.account.create({ data: { name: "Hot Foods", domain: "hotfoods.in", sellerId: "manch", tier: "T1", fitScore: 82, priorityScore: 91, createdAt: daysAgo(3), intentReading: { score: 70, level: "hot", whyNow: "Opening two plants in 2027", families: ["trigger"], explain: "" } } });
  hot = a.id;
  await baseDb.account.create({ data: { name: "Mild Co", domain: "mild.in", sellerId: "manch", fitScore: 50, priorityScore: 40, createdAt: daysAgo(20) } });
  await baseDb.account.create({ data: { name: "Gone Ltd", sellerId: "manch", stage: "DISQUALIFIED", priorityScore: 99, disqualifyReason: "Too small" } });
  await baseDb.account.create({ data: { name: "Other Client Co", domain: "other.in", sellerId: "acme", priorityScore: 95 } });
  // Buying group: a board member is never picked; the decision maker beats a more senior influencer.
  await baseDb.contact.create({ data: { accountId: a.id, fullName: "Board Person", stakeholderType: "board_member", buyingRole: "decision_maker" } });
  await baseDb.contact.create({ data: { accountId: a.id, fullName: "Vera VP", title: "VP Operations", buyingRole: "influencer", seniority: "vp", state: "ready" } });
  const dm = await baseDb.contact.create({ data: { accountId: a.id, fullName: "Dev Director", title: "Director, Supply Chain", buyingRole: "decision_maker", seniority: "director" } });
  await baseDb.draft.create({ data: { contactId: dm.id, subject: "Two new plants", body: "Hi", claims: [], status: "pending_review", createdAt: daysAgo(1) } });
  await baseDb.twinVersion.create({ data: { accountId: a.id, version: 1, createdAt: daysAgo(2), snapshot: { facts: [], inferences: [], contradictions: [], unknowns: [], changed: ["New trigger: Opening two plants in 2027", "employee_count now verified: 4,800 employees"], negatives: [{ id: "n1", kind: "legal", claim: "A dispute is pending in court", publishedAt: daysAgo(4).toISOString() }] } } });
  await baseDb.webVisit.createMany({ data: [
    { sellerId: "manch", companyName: "Hot Foods", companyDomain: "hotfoods.in", url: "https://manch/x", path: "/pricing", topic: "pricing", source: "apollo", occurredAt: daysAgo(1) },
    { sellerId: "manch", companyName: "Hot Foods", companyDomain: "hotfoods.in", url: "https://manch/y", path: "/", topic: "home", source: "apollo", occurredAt: daysAgo(2) },
    { sellerId: "manch", companyName: "New Visitor", companyDomain: "newvisitor.in", url: "https://manch/z", path: "/", topic: "home", source: "apollo", occurredAt: daysAgo(5) },
    { sellerId: "manch", companyName: "Old Visitor", companyDomain: "old.in", url: "https://manch/z", path: "/", topic: "home", source: "apollo", occurredAt: daysAgo(30) },
    { sellerId: "acme", companyName: "Acme Visitor", companyDomain: "acmev.in", url: "https://acme/z", path: "/", topic: "home", source: "apollo", occurredAt: daysAgo(1) },
  ] });
});

describe("At a glance", () => {
  it("picks the decision maker to contact, never a board member", () => {
    const people = [
      { fullName: "Board Person", stakeholderType: "board_member" as const, buyingRole: "decision_maker" as const, state: "new" as const, seniority: "c_level" },
      { fullName: "Vera VP", stakeholderType: "executive" as const, buyingRole: "influencer" as const, state: "ready" as const, seniority: "vp" },
      { fullName: "Dev Director", stakeholderType: "executive" as const, buyingRole: "decision_maker" as const, state: "new" as const, seniority: "director" },
    ];
    expect(pickContact(people)?.fullName).toBe("Dev Director");
    expect(pickContact([people[0]])).toBeNull();
  });

  it("answers worth pursuing, why now, who and next step from stored data", async () => {
    const a = await baseDb.account.findUniqueOrThrow({ where: { id: hot } });
    const g = await withScope(manch, () => glanceForOne(a));
    expect(g.verdict).toMatchObject({ label: "Strong fit", tone: "good" });
    expect(g.whyNow).toBe("Opening two plants in 2027");
    expect(g.contact).toMatchObject({ name: "Dev Director", role: "Decision maker" });
    expect(g.next).toBe("Review 1 draft waiting in Approvals");
    const gone = await baseDb.account.findFirstOrThrow({ where: { name: "Gone Ltd" } });
    expect((await withScope(manch, () => glanceForOne(gone))).verdict).toMatchObject({ label: "Ruled out", why: "Too small", tone: "stop" });
  });
});

describe("weekly report", () => {
  it("covers this week, this client only, best accounts first", async () => {
    const r = await withScope(manch, () => weeklyReport(NOW));
    expect(r.numbers).toMatchObject({ added: 1, researched: 1, visitors: 2, draftsWaiting: 1, emailsSent: 0, replies: 0 });
    expect(r.top.map((t) => t.name)).toEqual(["Hot Foods", "Mild Co"]); // ruled out and other clients left out
    expect(r.top[0].glance.contact?.name).toBe("Dev Director");
    expect(r.changes).toEqual([{ id: hot, name: "Hot Foods", items: ["Trigger: Opening two plants in 2027", "Employee count (now confirmed): 4,800 employees"], negatives: ["A dispute is pending in court"] }]);
    expect(r.visitors.map((v) => [v.name, v.visits, v.accountId])).toEqual([["Hot Foods", 2, hot], ["New Visitor", 1, null]]);
    expect(r.drafts.map((d) => [d.subject, d.person, d.company])).toEqual([["Two new plants", "Dev Director", "Hot Foods"]]);
  });

  it("writes research changes in plain words", () => {
    expect(changeLine("New owner_function: Head of Data is hiring")).toBe("Owner function: Head of Data is hiring");
    expect(changeLine("revenue now stale: FY2023 revenue")).toBe("Revenue (now stale): FY2023 revenue");
    expect(changeLine("Something else")).toBe("Something else");
  });
});
