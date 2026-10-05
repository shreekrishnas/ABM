import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { processWatchlist, runAccount } from "@/lib/pipeline/orchestrator";
import { newContext } from "@/lib/pipeline/context";
import { recordBounce, recordReply, recordSignal, sendApproved } from "@/lib/pipeline/stages/engagement";
import { eraseContact } from "@/lib/pipeline/gdpr";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { sha256 } from "@/lib/pipeline/crypto";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) {
    await db.sequence.create({
      data: {
        name: `${tier} seq`, tier,
        steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead with trigger" }, { order: 2, channel: "linkedin", dayOffset: 2, instruction: "Connect" }, { order: 3, channel: "email", dayOffset: 5, instruction: "Follow up" }] },
      },
    });
  }
}

async function account(domain: string, people: [string, string, string?][] = [["Asha Mehta", "VP Data"], ["Daniel Okafor", "Head of Data Platform"]], extra: Record<string, unknown> = {}) {
  const res = await ingestRows(
    people.map(([name, title, email]) => ({
      company: domain.split(".")[0], domain, industry: "analytics", employees: 800, country: "US",
      contactName: name, title, email: email ?? `${name.toLowerCase().replace(/\s*\(.*\)/, "").replace(" ", ".")}@${domain}`, ...extra,
    })),
    { source: "test" },
  );
  return res.accountIds[0];
}

beforeAll(() => setAdapters(createMockAdapters()));
beforeEach(reset);

describe("pipeline scenarios", () => {
  it("strong evidence → ready → drafts queued for approval", async () => {
    const id = await account("strong-acme.com");
    const r = await runAccount(id);
    expect(r.status).toBe("done");
    const a = await db.account.findUniqueOrThrow({ where: { id } });
    expect(a.tier).toBe("T1");
    const drafts = await db.draft.findMany({ where: { contact: { accountId: id } } });
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((d) => d.status === "pending_review")).toBe(true);
    const claims = drafts[0].claims as { factIds: string[] }[];
    expect(claims.every((c) => c.factIds.length > 0)).toBe(true);
    expect(drafts[0].body).toMatch(/unsubscribe/i);
    const twin = await db.twinVersion.findFirst({ where: { accountId: id } });
    expect(twin).not.toBeNull();
    expect(await db.reviewItem.count({ where: { type: "draft_approval", status: "open" } })).toBe(drafts.length);
  });

  it("re-running a finished account does not duplicate drafts or reviews", async () => {
    const id = await account("strong-beta.com");
    await runAccount(id);
    const before = await db.draft.count();
    await runAccount(id);
    await runAccount(id, { fromStage: 10 });
    expect(await db.draft.count()).toBe(before);
    expect(await db.reviewItem.count({ where: { type: "draft_approval" } })).toBe(before);
  });

  it("layoffs → watchlist for 90 days, no drafts", async () => {
    const id = await account("layoffs-gamma.com");
    const r = await runAccount(id);
    expect(r.status).toBe("blocked");
    const a = await db.account.findUniqueOrThrow({ where: { id } });
    expect(a.stage).toBe("WATCH");
    const w = await db.watchlistEntry.findFirstOrThrow({ where: { accountId: id } });
    expect(Math.round((w.recheckAt.getTime() - Date.now()) / 86_400_000)).toBe(90);
    expect(await db.draft.count()).toBe(0);
  });

  it("acquired → disqualified", async () => {
    const id = await account("acquired-delta.com");
    await runAccount(id);
    expect((await db.account.findUniqueOrThrow({ where: { id } })).stage).toBe("DISQUALIFIED");
  });

  it("no trigger after the follow-up → watch 30 days", async () => {
    const id = await account("weak-eps.com");
    await runAccount(id);
    const a = await db.account.findUniqueOrThrow({ where: { id } });
    expect(a.stage).toBe("WATCH");
    expect(a.followupUsed).toBe(true);
    const w = await db.watchlistEntry.findFirstOrThrow({ where: { accountId: id } });
    expect(Math.round((w.recheckAt.getTime() - Date.now()) / 86_400_000)).toBe(30);
  });

  it("weak evidence uses loop 1 once and then becomes ready", async () => {
    const id = await account("weak-then-found-zeta.com");
    const r = await runAccount(id);
    expect(r.status).toBe("done");
    const ev = await db.evidence.findMany({ where: { accountId: id, key: "trigger" } });
    expect(ev.map((e) => e.pass).sort()).toEqual(["followup", "main"]);
    expect(await db.pipelineEvent.count({ where: { accountId: id, step: "readiness.evidence_quality", reason: { contains: "re-research" } } })).toBe(1);
  });

  it("unresolved contradiction reopens once, then goes to a person", async () => {
    const id = await account("contradiction-unresolved-eta.com");
    await runAccount(id);
    const a = await db.account.findUniqueOrThrow({ where: { id } });
    expect(a.reopenUsed).toBe(true);
    expect(await db.reviewItem.count({ where: { accountId: id, type: "contradiction" } })).toBe(1);
    expect(await db.evidence.count({ where: { accountId: id, key: "size", status: "conflicting" } })).toBe(2);
  });

  it("official source resolves a contradiction", async () => {
    const id = await account("contradiction-official-theta.com");
    await runAccount(id);
    const size = await db.evidence.findMany({ where: { accountId: id, key: "size" } });
    expect(size.filter((e) => e.supersededById).length).toBe(1);
    expect(await db.reviewItem.count({ where: { accountId: id, type: "contradiction" } })).toBe(0);
  });

  it("job change → identity conflict → human review, person not drafted", async () => {
    const id = await account("strong-iota.com", [["Asha Mehta", "VP Data"], ["Lena Fischer (job_change)", "Head of Data", "lena.fischer@strong-iota.com"]]);
    await runAccount(id);
    const lena = await db.contact.findFirstOrThrow({ where: { accountId: id, fullName: { contains: "Lena" } } });
    expect(await db.reviewItem.count({ where: { contactId: lena.id, type: "identity_conflict" } })).toBe(1);
    expect(await db.draft.count({ where: { contactId: lena.id } })).toBe(0);
  });

  it("fit runs before identity: excluded accounts spend nothing", async () => {
    const id = await account("strong-kappa.com");
    await db.account.update({ where: { id }, data: { relationship: "competitor" } });
    await runAccount(id);
    expect(await db.ledgerEntry.count({ where: { accountId: id } })).toBe(0);
    expect((await db.account.findUniqueOrThrow({ where: { id } })).stage).toBe("DISQUALIFIED");
  });

  it("budget cap stops the run and queues a review", async () => {
    const id = await account("strong-lambda.com");
    await db.account.update({ where: { id }, data: { tier: "T3" } });
    await db.ledgerEntry.create({ data: { accountId: id, kind: "llm", amountMicros: 740_000, description: "prior spend", stage: 1 } });
    const r = await runAccount(id);
    expect(r.status).toBe("blocked");
    expect(await db.reviewItem.count({ where: { accountId: id, type: "budget_exceeded" } })).toBe(1);
    const agg = await db.ledgerEntry.aggregate({ where: { accountId: id }, _sum: { amountMicros: true } });
    expect(agg._sum.amountMicros!).toBeLessThanOrEqual(750_000);
  });

  it("duplicate accounts by domain are merged, never deleted", async () => {
    const a1 = await db.account.create({ data: { name: "Mu Inc", domain: "strong-mu.com" } });
    const a2 = await db.account.create({ data: { name: "Mu", domain: "https://www.strong-mu.com/" } });
    const r = await runAccount(a2.id);
    expect(r.status).toBe("blocked");
    expect((await db.account.findUniqueOrThrow({ where: { id: a2.id } })).mergedIntoId).toBe(a1.id);
  });
});

describe("engagement", () => {
  async function readyAndSent(domain: string) {
    const id = await account(domain);
    await runAccount(id);
    await db.draft.updateMany({ where: { status: "pending_review" }, data: { status: "approved" } });
    await sendApproved(newContext());
    return id;
  }

  it("sends each draft exactly once", async () => {
    await readyAndSent("strong-nu.com");
    const sent = await db.message.count();
    expect(sent).toBeGreaterThan(0);
    await sendApproved(newContext());
    expect(await db.message.count()).toBe(sent);
  });

  it("anonymous visits move the account score; MQA triggers a handoff that pauses automation", async () => {
    const id = await readyAndSent("strong-xi.com");
    const contact = await db.contact.findFirstOrThrow({ where: { accountId: id, state: "in_sequence" } });
    await recordSignal({ accountId: id, type: "pricing_visit", source: "tracking" });
    const after = await db.account.findUniqueOrThrow({ where: { id } });
    expect(after.engagementScore).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) await recordSignal({ accountId: id, contactId: contact.id, type: "email_click", source: "email_provider" });
    await recordSignal({ accountId: id, contactId: contact.id, type: "event_attended", source: "crm" });
    await recordSignal({ accountId: id, contactId: contact.id, type: "pricing_visit", source: "tracking" });
    const a = await db.account.findUniqueOrThrow({ where: { id } });
    expect(a.stage).toBe("MQA");
    expect(await db.handoff.count({ where: { accountId: id } })).toBe(1);
    expect(await db.enrollment.count({ where: { contact: { accountId: id }, status: "active" } })).toBe(0);
  });

  it("routes replies: positive hands off, unsubscribe suppresses, unclear goes to a person", async () => {
    const id = await readyAndSent("strong-omicron.com");
    const other = await readyAndSent("strong-upsilon.com");
    const c1 = await db.contact.findFirstOrThrow({ where: { accountId: id, state: "in_sequence" } });
    const c2 = await db.contact.findFirstOrThrow({ where: { accountId: other, state: "in_sequence" } });
    expect(await recordReply(c2.id, "Please unsubscribe me")).toBe("unsubscribe");
    expect(await db.suppression.count({ where: { value: c2.email!.toLowerCase() } })).toBe(1);
    expect(await recordReply(c1.id, "Hmm what?")).toBe("needs_human");
    expect(await db.reviewItem.count({ where: { type: "needs_human_reply" } })).toBe(1);
    expect(await recordReply(c1.id, "Interested, let's talk")).toBe("positive");
    expect(await db.handoff.count({ where: { accountId: id, trigger: "positive_reply" } })).toBe(1);
  });

  it("hard bounce invalidates and suppresses the email", async () => {
    await readyAndSent("strong-pi.com");
    const m = await db.message.findFirstOrThrow();
    await recordBounce(m.id, "hard");
    const c = await db.contact.findUniqueOrThrow({ where: { id: m.contactId } });
    expect(c.state).toBe("suppressed");
    expect(await db.suppression.count({ where: { value: c.email!.toLowerCase() } })).toBe(1);
  });

  it("watchlist re-check sends the account back to research with counters reset", async () => {
    const id = await account("layoffs-rho.com");
    await runAccount(id);
    await db.watchlistEntry.updateMany({ where: { accountId: id }, data: { recheckAt: new Date(Date.now() - 1000) } });
    const res = await processWatchlist(newContext());
    expect(res).toHaveLength(1);
    expect(await db.researchPlan.count({ where: { accountId: id, reason: "refresh" } })).toBe(1);
  });

  it("GDPR erasure deletes the person and keeps a hashed suppression", async () => {
    const id = await readyAndSent("strong-sigma.com");
    const c = await db.contact.findFirstOrThrow({ where: { accountId: id, email: { not: null } } });
    await eraseContact(c.id);
    expect(await db.contact.findUnique({ where: { id: c.id } })).toBeNull();
    expect(await db.suppression.count({ where: { value: `sha256:${sha256(c.email!)}` } })).toBe(1);
    expect(await db.suppression.count({ where: { value: c.email!.toLowerCase() } })).toBe(0);
  });
});
