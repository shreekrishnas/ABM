import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { processWatchlist, runAccount } from "@/lib/pipeline/orchestrator";
import { newContext } from "@/lib/pipeline/context";
import { recordBounce, recordOutcome, recordReply, recordSignal, sendApproved } from "@/lib/pipeline/stages/engagement";
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
      company: domain.split(".")[0], domain, industry: "fmcg", employees: 1500, country: "IN",
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
    expect(await db.evidence.count({ where: { accountId: id, key: "partner_network", status: "conflicting" } })).toBe(2);
  });

  it("official source resolves a contradiction", async () => {
    const id = await account("contradiction-official-theta.com");
    await runAccount(id);
    const size = await db.evidence.findMany({ where: { accountId: id, key: "partner_network" } });
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
    await db.account.update({ where: { id }, data: { tier: "T3", tierLocked: true } });
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

  it("winning a deal withdraws unsent drafts; approved drafts for customers are never sent", async () => {
    const id = await account("strong-tau.com");
    await runAccount(id);
    const [first] = await db.draft.findMany({ where: { status: "pending_review" } });
    await db.draft.update({ where: { id: first.id }, data: { status: "approved" } });
    const opp = await db.opportunity.create({ data: { accountId: id, name: "Tau", amountUsd: 1000, stage: "negotiation" } });
    await recordOutcome(opp.id, "won");
    expect(await db.draft.count({ where: { status: { in: ["pending_review", "approved"] } } })).toBe(0);
    expect(await db.reviewItem.count({ where: { type: "draft_approval", status: "open" } })).toBe(0);
    // Even if something re-approves a draft, the pre-send check holds it.
    await db.draft.update({ where: { id: first.id }, data: { status: "approved" } });
    const r = await sendApproved(newContext());
    expect(r.sent).toBe(0);
  });
});

describe("phase 1: freshness gate and automatic retry", () => {
  it("an approved email whose fact went stale is held at send, never sent, and asks for a fresh version", async () => {
    const id = await account("strong-fresh.com");
    await runAccount(id);
    const d = await db.draft.findFirstOrThrow({ where: { contact: { accountId: id }, status: "pending_review" } });
    await db.draft.update({ where: { id: d.id }, data: { status: "approved" } });
    const factIds = (d.claims as { factIds: string[] }[]).flatMap((c) => c.factIds);
    await db.evidence.updateMany({ where: { id: { in: factIds } }, data: { publishedAt: new Date(Date.now() - 400 * 86_400_000) } });

    const r = await sendApproved(newContext());
    expect(await db.message.count({ where: { draftId: d.id } })).toBe(0);
    expect(r.held).toBeGreaterThan(0);
    const held = await db.draft.findUniqueOrThrow({ where: { id: d.id } });
    expect(held.status).toBe("needs_refresh");
    expect(held.blockReason).toMatch(/stale/i);
    expect(await db.reviewItem.count({ where: { draftId: d.id, type: "draft_refresh", status: "open" } })).toBe(1);
    const a = await db.account.findUniqueOrThrow({ where: { id } });
    expect(a.pipelineStatus).toBe("queued");
    expect(a.queuedFromStage).toBe(5);
  });

  it("a retired fact fails the check; a fresh one passes", async () => {
    const id = await account("strong-retired.com");
    await runAccount(id);
    const d = await db.draft.findFirstOrThrow({ where: { contact: { accountId: id } } });
    const { checkDraftEvidence } = await import("@/lib/pipeline/freshness");
    expect((await checkDraftEvidence(d)).ok).toBe(true);
    const fid = (d.claims as { factIds: string[] }[])[0].factIds[0];
    const other = await db.evidence.findFirstOrThrow({ where: { accountId: id, id: { not: fid } } });
    await db.evidence.update({ where: { id: fid }, data: { supersededById: other.id } });
    expect((await checkDraftEvidence(d)).ok).toBe(false);
  });

  it("a replacement for a held draft always goes to a person and links back", async () => {
    const id = await account("strong-replace.com");
    await runAccount(id);
    const d = await db.draft.findFirstOrThrow({ where: { contact: { accountId: id }, status: "pending_review" } });
    await db.draft.update({ where: { id: d.id }, data: { status: "needs_refresh" } });
    await runAccount(id, { fromStage: 11 });
    const next = await db.draft.findFirstOrThrow({ where: { contactId: d.contactId, stepOrder: d.stepOrder, id: { not: d.id } } });
    expect(next.replacesId).toBe(d.id);
    expect(next.status).toBe("pending_review");
  });

  it("an unsubscribe while an email is approved stops it", async () => {
    const id = await account("strong-unsub.com");
    await runAccount(id);
    const d = await db.draft.findFirstOrThrow({ where: { contact: { accountId: id }, status: "pending_review" } });
    await db.draft.update({ where: { id: d.id }, data: { status: "approved" } });
    await recordReply(d.contactId, "Please unsubscribe me");
    await sendApproved(newContext());
    expect(await db.message.count({ where: { draftId: d.id, status: "delivered" } })).toBe(0);
  });

  it("a temporary API failure is retried later from the failed stage, without duplicates", async () => {
    const id = await account("strong-retry.com");
    const ad = createMockAdapters();
    const orig = ad.research.search.bind(ad.research);
    let failures = 2;
    ad.research.search = async (...args: Parameters<typeof orig>) => {
      if (failures > 0) { failures--; throw new Error("Exa 429 Too Many Requests"); }
      return orig(...args);
    };
    setAdapters(ad);
    try {
      const { processQueue, RETRY } = await import("@/lib/pipeline/orchestrator");
      const first = await runAccount(id);
      expect(first.reason).toMatch(/Retrying/);
      let a = await db.account.findUniqueOrThrow({ where: { id } });
      expect(a.pipelineStatus).toBe("queued");
      expect(a.retryCount).toBe(1);
      expect(a.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
      // Not due yet: the queue skips it.
      expect((await processQueue({ ctx: newContext() })).processed).toBe(0);
      // Later: second failure, then success.
      await processQueue({ ctx: newContext(new Date(Date.now() + 2 * RETRY.baseMs)) });
      a = await db.account.findUniqueOrThrow({ where: { id } });
      expect(a.retryCount).toBe(2);
      await processQueue({ ctx: newContext(new Date(Date.now() + 10 * RETRY.baseMs)) });
      a = await db.account.findUniqueOrThrow({ where: { id } });
      expect(a.pipelineStatus).toBe("done");
      expect(a.retryCount).toBe(0);
      const drafts = await db.draft.findMany({ where: { contact: { accountId: id } } });
      expect(new Set(drafts.map((d) => `${d.contactId}:${d.stepOrder}`)).size).toBe(drafts.length);
    } finally {
      setAdapters(createMockAdapters());
    }
  });

  it("gives up after the retry limit and asks a person; permanent errors are not retried", async () => {
    const { isTransient } = await import("@/lib/pipeline/orchestrator");
    expect(isTransient("OpenRouter 503 Service Unavailable")).toBe(true);
    expect(isTransient("fetch failed")).toBe(true);
    expect(isTransient("Seller pack invalid: name required")).toBe(false);
    const id = await account("strong-giveup.com");
    await db.account.update({ where: { id }, data: { retryCount: 3 } });
    const ad = createMockAdapters();
    ad.research.search = async () => { throw new Error("Exa 429 Too Many Requests"); };
    setAdapters(ad);
    try {
      await runAccount(id);
    } finally {
      setAdapters(createMockAdapters());
    }
    const a = await db.account.findUniqueOrThrow({ where: { id } });
    expect(a.pipelineStatus).toBe("error");
    expect(await db.reviewItem.count({ where: { accountId: id, type: "retry_exhausted" } })).toBe(1);
  });
});

describe("phase 2: buying-group coordination", () => {
  const people: [string, string, string?][] = [["Asha Mehta", "VP Data"], ["Daniel Okafor", "Head of Data Platform"], ["Priya Nair", "Data Platform Lead"]];

  it("plans the company: role order, staggered starts, only the first person drafted on day one", async () => {
    const id = await account("strong-plan.com", people);
    await runAccount(id);
    const plan = await db.contact.findMany({ where: { accountId: id, planOrder: { not: null } }, orderBy: { planOrder: "asc" } });
    expect(plan.length).toBeGreaterThan(1);
    const rank = (r: string) => { const i = ["champion", "decision_maker"].indexOf(r); return i < 0 ? 9 : i; };
    for (let i = 1; i < plan.length; i++) expect(rank(plan[i].buyingRole)).toBeGreaterThanOrEqual(rank(plan[i - 1].buyingRole));
    expect(plan[0].planStartAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(plan[1].planStartAt!.getTime() - plan[0].planStartAt!.getTime()).toBeGreaterThanOrEqual(3 * 86_400_000);
    const drafts = await db.draft.findMany({ where: { contact: { accountId: id }, stepOrder: 1 } });
    expect(drafts.map((d) => d.contactId)).toEqual([plan[0].id]);
    const later = await db.enrollment.findFirstOrThrow({ where: { contactId: plan[1].id } });
    expect(later.nextDueAt!.getTime()).toBe(plan[1].planStartAt!.getTime());
    // Re-running keeps the plan.
    await runAccount(id, { fromStage: 11 });
    const again = await db.contact.findMany({ where: { accountId: id, planOrder: { not: null } }, orderBy: { planOrder: "asc" } });
    expect(again.map((c) => c.planStartAt!.getTime())).toEqual(plan.map((c) => c.planStartAt!.getTime()));
  });

  it("sends at most one email per company per day", async () => {
    const id = await account("strong-cap.com", people);
    await runAccount(id);
    const plan = await db.contact.findMany({ where: { accountId: id, planOrder: { not: null } }, orderBy: { planOrder: "asc" } });
    await db.draft.updateMany({ where: { contact: { accountId: id } }, data: { status: "approved" } });
    const first = await db.draft.findFirstOrThrow({ where: { contactId: plan[0].id } });
    await db.draft.create({ data: { contactId: plan[1].id, stepOrder: 1, subject: first.subject, body: first.body, claims: first.claims as object, status: "approved" } });
    await db.enrollment.updateMany({ where: { contactId: plan[1].id }, data: { status: "active" } });
    const r = await sendApproved(newContext());
    expect(await db.message.count({ where: { contact: { accountId: id }, status: "delivered" } })).toBe(1);
    expect(r.reasons.some((x) => /Company limit/.test(x))).toBe(true);
  });

  it("a decision maker's 'not now' pauses the whole company; the re-check resumes it", async () => {
    const id = await account("strong-notnow.com", people);
    await runAccount(id);
    const contacts = await db.contact.findMany({ where: { accountId: id, planOrder: { not: null } }, orderBy: { planOrder: "asc" } });
    const dm = contacts[contacts.length - 1];
    await db.contact.update({ where: { id: dm.id }, data: { buyingRole: "decision_maker" } });
    const ad = createMockAdapters();
    ad.llm.classifyReply = async () => "not_now";
    setAdapters(ad);
    try {
      await recordReply(dm.id, "Not this quarter, check back later");
    } finally {
      setAdapters(createMockAdapters());
    }
    const a = await db.account.findUniqueOrThrow({ where: { id } });
    expect(a.outreachPausedUntil!.getTime()).toBeGreaterThan(Date.now() + 30 * 86_400_000);
    expect(await db.enrollment.count({ where: { contact: { accountId: id }, status: "active" } })).toBe(0);
    expect(await db.draft.count({ where: { contact: { accountId: id }, status: { in: ["pending_review", "approved"] } } })).toBe(0);
    // The pause also holds at send time.
    const { companyHold, resumeCompany } = await import("@/lib/pipeline/coordination");
    expect(await companyHold(contacts[0], new Date())).toMatch(/paused/i);
    const n = await resumeCompany(id, newContext());
    expect(n).toBeGreaterThan(0);
    expect((await db.account.findUniqueOrThrow({ where: { id } })).outreachPausedUntil).toBeNull();
  });

  it("an objection pauses colleagues and asks a person; an unsubscribe affects only that person", async () => {
    const id = await account("strong-object.com", people);
    await runAccount(id);
    const contacts = await db.contact.findMany({ where: { accountId: id, planOrder: { not: null } }, orderBy: { planOrder: "asc" } });
    const ad = createMockAdapters();
    ad.llm.classifyReply = async () => "unsubscribe";
    setAdapters(ad);
    await recordReply(contacts[1].id, "Remove me");
    expect((await db.account.findUniqueOrThrow({ where: { id } })).outreachPausedUntil).toBeNull();
    expect(await db.enrollment.count({ where: { contactId: contacts[0].id, status: "active" } })).toBe(1);
    ad.llm.classifyReply = async () => "objection";
    try {
      await recordReply(contacts[0].id, "We already use another vendor");
    } finally {
      setAdapters(createMockAdapters());
    }
    expect((await db.account.findUniqueOrThrow({ where: { id } })).outreachPauseReason).toMatch(/objection/);
    expect(await db.enrollment.count({ where: { contact: { accountId: id }, status: "active" } })).toBe(0);
    expect(await db.reviewItem.count({ where: { accountId: id, type: "needs_human_reply", status: "open" } })).toBe(1);
  });
});

describe("phase 2: new people per week", () => {
  it("holds a third new person when two started this week", async () => {
    const id = await account("strong-week.com", [["A One", "VP Data"], ["B Two", "Head of Data Platform"], ["C Three", "Data Platform Lead"]]);
    const cs = await db.contact.findMany({ where: { accountId: id }, orderBy: { createdAt: "asc" } });
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    for (const c of cs.slice(0, 2)) {
      const d = await db.draft.create({ data: { contactId: c.id, stepOrder: 1, subject: "s", body: "b", claims: [], status: "sent" } });
      await db.message.create({ data: { draftId: d.id, contactId: c.id, mailbox: "out@company.test", status: "delivered", sentAt: twoDaysAgo } });
    }
    const { companyHold } = await import("@/lib/pipeline/coordination");
    expect(await companyHold(cs[2], new Date())).toMatch(/new people/);
    expect(await companyHold(cs[0], new Date())).toBeNull(); // already started: follow-ups continue
  });
});

describe("LinkedIn → email bridge", () => {
  async function journeyFor(contactId: string) {
    const { ensureJourney } = await import("@/lib/journey/service");
    const campaign = await db.campaign.upsert({ where: { name: "LI test" }, create: { name: "LI test" }, update: {} });
    const sender = await db.senderProfile.upsert({ where: { name: "Sender LI" }, create: { name: "Sender LI" }, update: {} });
    return (await ensureJourney(contactId, campaign.id, sender.id)).journey;
  }

  it("a positive LinkedIn reply logged by the team pauses that person's email, withdraws drafts and hands off", async () => {
    const id = await account("strong-li.com");
    await runAccount(id);
    const d = await db.draft.findFirstOrThrow({ where: { contact: { accountId: id }, status: "pending_review" } });
    const j = await journeyFor(d.contactId);
    const { recordActivities } = await import("@/lib/journey/service");
    await recordActivities(j.id, [{ type: "reply", at: new Date(), text: "Yes, let's talk next week", meaning: "interested" }], "manual");
    expect((await db.draft.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("rejected");
    expect(await db.enrollment.count({ where: { contactId: d.contactId, status: "active" } })).toBe(0);
    expect(await db.handoff.count({ where: { accountId: id } })).toBe(1);
    expect(await sendApproved(newContext()).then(() => db.message.count({ where: { contactId: d.contactId } }))).toBe(0);
  });

  it("a request for details pauses only that person; imported history never hands off", async () => {
    const id = await account("strong-li2.com");
    await runAccount(id);
    const d = await db.draft.findFirstOrThrow({ where: { contact: { accountId: id }, status: "pending_review" } });
    const j = await journeyFor(d.contactId);
    const { recordActivities } = await import("@/lib/journey/service");
    await recordActivities(j.id, [{ type: "reply", at: new Date(), text: "Can you send details?", meaning: "details_requested" }], "manual");
    expect((await db.contact.findUniqueOrThrow({ where: { id: d.contactId } })).state).toBe("paused");
    expect(await db.handoff.count({ where: { accountId: id } })).toBe(0);
    await recordActivities(j.id, [{ type: "reply", at: new Date(), text: "Interested", meaning: "interested" }], "csv");
    expect(await db.handoff.count({ where: { accountId: id } })).toBe(0);
  });
});

describe("command center", () => {
  it("funnel steps are nested, and paused or failed companies need attention", async () => {
    const id = await account("strong-cc.com");
    await runAccount(id);
    await account("weak-cc2.com");
    const { pauseCompany } = await import("@/lib/pipeline/coordination");
    await pauseCompany(id, 14, "objection from Asha", newContext());
    const { commandCenter } = await import("@/lib/command-center");
    const cc = await commandCenter();
    for (let i = 1; i < cc.funnel.length; i++) expect(cc.funnel[i].value).toBeLessThanOrEqual(cc.funnel[i - 1].value);
    expect(cc.funnel[0].value).toBe(2);
    expect(cc.kpis.find((k) => k.key === "risk")!.value).toBeGreaterThanOrEqual(1);
    expect(cc.attention.some((a) => a.kind === "Outreach paused" && /objection/.test(a.detail))).toBe(true);
    expect(cc.kpis.every((k) => k.href && k.define)).toBe(true);
  });
});
