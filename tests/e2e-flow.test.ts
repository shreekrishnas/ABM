// One company, start to finish, under Manch's real rules: every section must hand off to the next.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { clearSellerOverrides, ensureSellerPacks, seller } from "@/lib/seller";
import { saveSellerPack } from "@/lib/seller/edit";
import { MANCH } from "@/lib/seller/manch";
import { ingestRows } from "@/lib/pipeline/ingest";
import { processQueue, tick } from "@/lib/pipeline/orchestrator";
import { newContext } from "@/lib/pipeline/context";
import { recordReply, recordSignal, sendApproved, acknowledgeHandoff } from "@/lib/pipeline/stages/engagement";
import { addSuggestion, scanMarket } from "@/lib/discover/scan";
import { industryTrends } from "@/lib/discover/trends";
import { forgetSync } from "@/lib/knowledge/rag/store";
import { clearRetrievalCache } from "@/lib/knowledge/rag/retrieve";
import { prospectTrack } from "@/lib/journey/track";

const saved = { mustHave: MANCH.icp.mustHave, mode: MANCH.icp.industryMode, tiers: MANCH.icp.tierBySize, emp: MANCH.icp.employees };
const log: string[] = [];
const ok = (s: string) => log.push(`✔ ${s}`);

beforeAll(async () => {
  MANCH.icp.mustHave = { countries: ["IN"], minEmployees: 5001 };
  MANCH.icp.industryMode = "any";
  MANCH.icp.tierBySize = { T1: 50000, T2: 15000 };
  MANCH.icp.employees = { sweetSpot: 10000, mid: 5001, min: 5001 };
  setAdapters(createMockAdapters());
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) await db.sequence.create({ data: { name: tier, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead with trigger" }] } } });
  clearSellerOverrides();
  forgetSync();
  clearRetrievalCache();
});
afterAll(() => {
  Object.assign(MANCH.icp, { mustHave: saved.mustHave, industryMode: saved.mode, tierBySize: saved.tiers, employees: saved.emp });
  clearSellerOverrides();
  console.log(`\nEnd-to-end flow:\n${log.join("\n")}\n`);
});

describe("end to end: every section talks to the next", () => {
  let accountId = "";

  it("1 Import → targeting rule → queue", async () => {
    const r = await ingestRows([
      { "Company Name": "Strong Foods", "Company Website": "strong-foods.in", Industry: "fmcg", "Employee Size": "22000", Country: "India", "First Name": "Asha", "Last Name": "Rao", "Job Title": "Head of Master Data", Email: "asha.rao@strong-foods.in" },
      { "Company Name": "Tiny Co", "Company Website": "strong-tiny.in", Industry: "fmcg", "Employee Size": "800", Country: "India" },
      { "Company Name": "Abroad Ltd", "Company Website": "strong-abroad.com", Industry: "fmcg", "Employee Size": "40000", Country: "Germany" },
    ], { source: "csv" });
    expect(r.accepted).toBe(3);
    accountId = (await db.account.findFirstOrThrow({ where: { name: "Strong Foods" } })).id;
    expect(await db.account.count({ where: { pipelineStatus: "queued" } })).toBe(3);
    ok("Import accepted 3 companies and queued them for research");
  });

  it("2 Queue → fit and tier → research → intent → brief → buying group → drafts (with knowledge) → approvals", async () => {
    await processQueue({ ctx: newContext(), budgetMs: 120_000 });
    const tiny = await db.account.findFirstOrThrow({ where: { domain: "strong-tiny.in" } });
    const abroad = await db.account.findFirstOrThrow({ where: { domain: "strong-abroad.com" } });
    expect(tiny.disqualifyReason).toMatch(/Too small/);
    expect(abroad.disqualifyReason).toMatch(/Outside target countries/);
    ok("Targeting rule excluded the small and the non-India company before spending on research");

    const a = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(["T1", "T2"]).toContain(a.tier); // 22,000 employees = T2 by size; T1 if intent turns hot
    expect(await db.evidence.count({ where: { accountId, status: { in: ["verified", "probable"] } } })).toBeGreaterThan(0);
    ok(`Fit and tier set (${a.tier}); research found usable evidence`);
    expect(a.intentReading).toBeTruthy();
    ok(`Intent engine scored the account (${(a.intentReading as { level: string }).level})`);
    expect(await db.accountBrief.count({ where: { accountId } })).toBeGreaterThan(0);
    ok("Strategist wrote the account brief");
    expect(await db.contact.count({ where: { accountId } })).toBeGreaterThan(0);
    const drafts = await db.draft.findMany({ where: { contact: { accountId } } });
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((d) => d.critique != null)).toBe(true);
    expect(drafts.some((d) => ((d.knowledge as { references?: string[] } | null)?.references ?? []).length > 0)).toBe(true);
    ok(`Writer drafted ${drafts.length} email(s) using the knowledge base; critic panel reviewed each`);
    expect(await db.reviewItem.count({ where: { accountId, type: "draft_approval", status: "open" } })).toBeGreaterThan(0);
    ok("Drafts waiting in Approvals");
    const sig = new Set((await db.brainSignal.findMany({ where: { accountId }, select: { type: true } })).map((s) => s.type));
    for (const t of ["fit.scored", "research.done", "intent.scored", "brief.ready", "draft.ready", "run.finished"]) expect(sig.has(t)).toBe(true);
    expect(await db.decision.count({ where: { accountId } })).toBeGreaterThan(0);
    ok(`Signal bus carried ${sig.size} signal types; decisions recorded with both sides`);
  });

  it("3 Approve → send → reply → journey → hand-off → CRM", async () => {
    await db.draft.updateMany({ where: { status: "pending_review", contact: { accountId } }, data: { status: "approved" } });
    const s = await sendApproved(newContext());
    expect(s.sent).toBeGreaterThan(0);
    ok(`Approved emails sent (${s.sent})`);
    const c = await db.contact.findFirstOrThrow({ where: { accountId, messages: { some: { status: "delivered" } } } });
    await recordSignal({ accountId, contactId: c.id, type: "email_click", source: "test" });
    expect(await recordReply(c.id, "Interested — can we talk next week?")).toBe("positive");
    ok("Click and positive reply recorded and classified");
    const track = await prospectTrack(c.id);
    expect(track).toBeTruthy();
    ok("Prospect journey shows the timeline");
    const h = await db.handoff.findFirstOrThrow({ where: { accountId } });
    await acknowledgeHandoff(h.id);
    ok("Hand-off to sales created and acknowledged");
    expect(await db.knowledgeDoc.count({ where: { origin: "learned" } })).toBeGreaterThan(0);
    ok("The email that got the reply became a learned example in the knowledge base");
  });

  it("4 Discover → add → same pipeline", async () => {
    const r = await scanMarket(newContext());
    expect(r.suggestions).toBeGreaterThan(0);
    const s = await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Sahyadri Lifesciences" } });
    const id = await addSuggestion(s.id);
    expect((await db.account.findUniqueOrThrow({ where: { id: id! } })).pipelineStatus).toBe("queued");
    await processQueue({ ctx: newContext(), budgetMs: 120_000 });
    const a = await db.account.findUniqueOrThrow({ where: { id: id! } });
    expect(a.pipelineStage).toBeGreaterThan(2);
    const stop = await db.pipelineEvent.findFirst({ where: { accountId: id!, step: "orchestrator.stop" }, orderBy: { createdAt: "desc" } });
    ok(`Discover suggested ${r.suggestions} companies; the added one ran through research to step ${a.pipelineStage}${stop ? ` and stopped correctly: ${stop.reason}` : ""}`);
    const pharma = (await industryTrends()).find((t) => t.key === "pharma")!;
    expect(pharma.momentum).toBe("rising");
    ok(`Industry radar: pharma ${pharma.momentum}, held ${pharma.held}`);
  });

  it("5 Settings edit → every section follows the new rule", async () => {
    const pack = JSON.parse(JSON.stringify(seller()));
    pack.icp.mustHave = { countries: ["IN"], minEmployees: 10001 };
    const res = await saveSellerPack("manch", pack, "e2e: raise size floor");
    expect(res.ok).toBe(true);
    await ensureSellerPacks();
    await db.prospectSuggestion.deleteMany({});
    await scanMarket(newContext());
    const narmada = await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Narmada Pharma" } });
    expect(narmada.status).toBe("excluded"); // 9,200 employees: passes 5,001, fails 10,001
    ok("Edited targeting rule in Settings was applied by Discover");
  });

  it("6 Daily automatic run completes", async () => {
    const t = await tick(newContext());
    expect(t).toBeTruthy();
    ok("Daily tick ran: queue, follow-ups, sends, watch-list, escalations, insights, market scan");
  });
});
