// Background jobs. A long task started from a button (research, scans, searches) is saved as a
// BackgroundJob and run on its own server request, so the button answers at once and the person
// can keep using the app, open other sections and switch clients while it works. The job stays
// with the client it was started for. Finished rows are kept (nothing is deleted).
//
//   button action → startJob() → row "queued" → after reply: POST /api/v1/jobs {id}
//                 → route answers 202 → after(): runJob(id) → "running" → "done" | "failed"

import { after } from "next/server";
import type { BackgroundJob, Prisma } from "@prisma/client";
import { baseDb } from "@/lib/db-base";
import { newContext, type RunContext } from "@/lib/pipeline/context";

export type JobKind = "run_account" | "research_question" | "profile_refresh" | "scan_market" | "daily_run" | "lookalikes" | "discovery_draft" | "discovery_run" | "apollo_fetch" | "reindex";

export interface JobOutcome { ok: boolean; message: string; href?: string | null }

const SAMPLE_CLIENT = "test";
/** A job still "running" after this is treated as cut off (the server allows 5 minutes per request). */
export const JOB_STALE_MS = 6 * 60_000;

/** Same key the queue uses to call its own route. */
const selfToken = () => process.env.ABM_API_KEY?.trim() || process.env.CRON_SECRET?.trim() || "";

/**
 * Save a job and start it after the reply. Refuses a duplicate while the same kind of job for the
 * same company (or client) is still going.
 */
export async function startJob(kind: JobKind, o: { sellerId: string; accountId?: string | null; label: string; params?: Record<string, unknown>; createdBy?: string | null }): Promise<{ ok: boolean; message: string; id?: string }> {
  const running = await baseDb.backgroundJob.findFirst({
    where: { kind, sellerId: o.sellerId, accountId: o.accountId ?? null, status: { in: ["queued", "running"] }, createdAt: { gte: new Date(Date.now() - JOB_STALE_MS) } },
    select: { id: true, createdAt: true },
  });
  if (running) return { ok: false, message: `Already running since ${running.createdAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}. Follow it in the top bar.` };
  let origin: string | null = null;
  try {
    origin = await (await import("@/lib/action-utils")).requestOrigin();
  } catch {
    origin = null; // outside a web request (scheduled work, tests)
  }
  // The app's address travels with the job, so a job that queues companies can start the queue.
  const job = await baseDb.backgroundJob.create({
    data: { kind, sellerId: o.sellerId, accountId: o.accountId ?? null, label: o.label.slice(0, 160), params: { ...(o.params ?? {}), _origin: origin } as Prisma.InputJsonValue, createdBy: o.createdBy ?? null },
  });
  try {
    after(() => kickJob(origin, job.id));
  } catch {
    void kickJob(origin, job.id); // outside a web request: start it now
  }
  return { ok: true, message: `Started: ${o.label}. Keep working; it runs in the background and the top bar tells you when it's done.`, id: job.id };
}

/** Run the job in its own server request; without a key, right here after the reply. */
export async function kickJob(origin: string | null, id: string) {
  const token = selfToken();
  const base = (process.env.APP_URL?.trim() || origin || "").replace(/\/$/, "");
  if (base && token) {
    try {
      const res = await fetch(`${base}/api/v1/jobs`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(10_000) });
      if (res.ok) return;
    } catch {
      /* fall through: run here */
    }
  }
  await runJob(id);
}

/** Claim and run one job; saves done or failed with a plain message. */
export async function runJob(id: string): Promise<void> {
  const claimed = await baseDb.backgroundJob.updateMany({ where: { id, status: "queued" }, data: { status: "running", startedAt: new Date() } });
  if (!claimed.count) return;
  const job = (await baseDb.backgroundJob.findUnique({ where: { id } }))!;
  const started = new Date();
  let out: JobOutcome;
  try {
    const [{ unscoped }, { withSeller }] = await Promise.all([import("@/lib/scope"), import("@/lib/seller")]);
    const ctx = newContext();
    if (job.sellerId === SAMPLE_CLIENT) ctx.adapters = (await import("@/lib/adapters/mock")).createMockAdapters();
    out = await unscoped(() => withSeller(job.sellerId, () => HANDLERS[job.kind as JobKind](job, ctx)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    out = { ok: false, message: /budget/i.test(msg) ? msg.slice(0, 200) : /403|credit|limit exceeded|paused/i.test(msg) ? "The AI reader is unavailable right now (paused or out of credits)" : `Stopped: ${msg.slice(0, 200)}` };
  }
  await baseDb.backgroundJob.update({ where: { id }, data: { status: out.ok ? "done" : "failed", message: out.message.slice(0, 500), href: out.href ?? null, finishedAt: new Date() } });
  const { recordRun } = await import("@/lib/admin/ops");
  await recordRun(`Job · ${job.label}`.slice(0, 80), started, { ok: out.ok, processed: 1, note: out.message });
}

/** A person's jobs from the last day, newest first; jobs cut off by the server limit read as failed. */
export async function jobsFor(email: string) {
  const rows = await baseDb.backgroundJob.findMany({ where: { createdBy: email, createdAt: { gte: new Date(Date.now() - 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 20 });
  const clients = new Map((await baseDb.client.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return rows.map((r) => {
    const stale = (r.status === "running" || r.status === "queued") && Date.now() - r.createdAt.getTime() > JOB_STALE_MS;
    return {
      id: r.id, kind: r.kind, label: r.label, client: clients.get(r.sellerId) ?? r.sellerId,
      status: stale ? "failed" : r.status, message: stale ? "Stopped: it ran past the server's time limit. Try again." : r.message,
      href: r.href, createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
    };
  });
}

/** The latest job of a kind for a client (or company), for "running in the background since …" notes on pages. */
export async function latestJob(kind: JobKind, sellerId: string, accountId?: string | null) {
  const j = await baseDb.backgroundJob.findFirst({ where: { kind, sellerId, ...(accountId !== undefined ? { accountId } : {}) }, orderBy: { createdAt: "desc" } });
  if (!j) return null;
  const running = (j.status === "running" || j.status === "queued") && Date.now() - j.createdAt.getTime() <= JOB_STALE_MS;
  return { running, createdAt: j.createdAt, status: j.status, message: j.message };
}

// ── What each kind of job does (the same work the buttons used to do while you waited) ──

type Handler = (job: BackgroundJob, ctx: RunContext) => Promise<JobOutcome>;
const P = (job: BackgroundJob) => (job.params ?? {}) as Record<string, unknown>;

const HANDLERS: Record<JobKind, Handler> = {
  async run_account(job, ctx) {
    const { runAccount } = await import("@/lib/pipeline/orchestrator");
    const r = await runAccount(job.accountId!, { fromStage: typeof P(job).fromStage === "number" ? (P(job).fromStage as number) : undefined, ctx });
    const word = r.status === "done" ? "finished" : r.status === "blocked" ? "stopped at a check" : r.status === "skipped" ? "skipped" : "stopped with an error";
    return { ok: r.status !== "error", message: `${job.label.replace(/^Run pipeline: /, "")}: ${word}. ${r.reason}`, href: `/accounts/${job.accountId}` };
  },

  async research_question(job, ctx) {
    const { db } = await import("@/lib/db");
    const key = String(P(job).key);
    const account = await db.account.findUnique({ where: { id: job.accountId! } });
    if (!account) return { ok: false, message: "Company not found" };
    if (ctx.adapters.research.connected === false) return { ok: false, message: "Web research isn't switched on (search and AI keys in Admin → Integrations)" };
    const before = await db.evidence.count({ where: { accountId: account.id, key, flagged: false } });
    const { s06AccountResearch, s07AccountTwin } = await import("@/lib/pipeline/stages/research");
    const a = await s06AccountResearch(account, ctx, { pass: "refresh", keys: [key] });
    await s07AccountTwin(a, ctx, { investigate: false, allowReopen: false });
    const after = await db.evidence.count({ where: { accountId: account.id, key, flagged: false } });
    return { ok: true, message: `${account.name}: ${after > before ? `found ${after - before} new fact${after - before === 1 ? "" : "s"}` : "searched again, nothing new that passes the checks"}`, href: `/accounts/${account.id}` };
  },

  async profile_refresh(job, ctx) {
    const { db } = await import("@/lib/db");
    const account = await db.account.findUnique({ where: { id: job.accountId! } });
    if (!account) return { ok: false, message: "Company not found" };
    const { researchCompanyProfile } = await import("@/lib/profile/run");
    const s = await researchCompanyProfile(account, ctx, { force: true });
    const { rescoreFit } = await import("@/lib/pipeline/fit-research");
    const fresh = await db.account.findUnique({ where: { id: account.id } });
    if (fresh) await rescoreFit(fresh);
    const found = [s.financials && `${s.financials} financial figure${s.financials === 1 ? "" : "s"}`, s.funding && `${s.funding} funding round${s.funding === 1 ? "" : "s"}`, s.technologies && `${s.technologies} technolog${s.technologies === 1 ? "y" : "ies"}`, s.board && `${s.board} board member${s.board === 1 ? "" : "s"}`].filter(Boolean);
    return { ok: true, message: `${account.name} profile: ${found.length ? `found ${found.join(", ")}` : "nothing new"}${s.dropped ? `; ${s.dropped} value${s.dropped === 1 ? "" : "s"} dropped for not matching their source` : ""}`, href: `/accounts/${account.id}` };
  },

  async scan_market(_job, ctx) {
    const { scanMarket } = await import("@/lib/discover/scan");
    const r = await scanMarket(ctx, { budgetMs: 220_000 });
    return { ok: true, message: `Market scan: ${r.searches} searches, ${r.events} buying events, ${r.suggestions} companies suggested, ${r.excluded} outside your targeting rule`, href: "/discover" };
  },

  async daily_run(job, ctx) {
    const { runClientDaily } = await import("@/lib/discover/daily");
    const r = await runClientDaily(job.sellerId, ctx, { force: true, budgetMs: 230_000 });
    return { ok: true, message: `Recommended today: ${r?.items ?? 0} accounts${r?.stopped ? ` (${r.stopped})` : ""}`, href: "/discover#recommended" };
  },

  async lookalikes(job, ctx) {
    const { findLookalikes } = await import("@/lib/discover/lookalike");
    const r = await findLookalikes(String(P(job).website), ctx, job.createdBy);
    if (r.suggested) await kickQueue(job);
    if (!r.found) return { ok: false, message: `No similar companies found for ${r.seed}. Try its main website.`, href: "/import/lookalikes" };
    return { ok: true, message: `Similar to ${r.seed}: ${r.found} found, being researched now`, href: `/import/lookalikes?seed=${encodeURIComponent(r.seed)}` };
  },

  async discovery_draft(job, ctx) {
    const { draftDiscovery } = await import("@/lib/discover/describe");
    const s = await draftDiscovery(String(P(job).brief), job.createdBy, ctx);
    return { ok: true, message: "Search criteria drafted: check and edit them, then search", href: `/import/describe?search=${s.id}` };
  },

  async discovery_run(job, ctx) {
    const { runDiscovery } = await import("@/lib/discover/describe");
    const id = String(P(job).searchId);
    const r = await runDiscovery(id, ctx);
    if (r.queued) await kickQueue(job);
    if (!r.found) return { ok: false, message: "No companies found for these criteria; broaden the industries or add search queries", href: `/import/describe?search=${id}` };
    return { ok: true, message: `Company search: ${r.found} found, ${r.queued} being researched${r.excluded ? `, ${r.excluded} outside your targeting rule` : ""}`, href: `/import/describe?search=${id}` };
  },

  async apollo_fetch(_job, ctx) {
    const { syncApolloVisitors } = await import("@/lib/web/apollo-sync");
    const r = await syncApolloVisitors(ctx, { force: true });
    if (!r) return { ok: false, message: "Apollo isn't on: add its key in Admin → Integrations", href: "/admin/integrations" };
    if (!r.companies) return { ok: false, message: "Apollo returned no visitor companies. Press Check Apollo connection to see why.", href: "/import/apollo" };
    return { ok: true, message: `Website visitors: ${r.companies} compan${r.companies === 1 ? "y" : "ies"}, ${r.recorded} new visit${r.recorded === 1 ? "" : "s"}${r.suggested ? `, ${r.suggested} new waiting for approval` : ""}`, href: "/import/apollo" };
  },

  async reindex(job) {
    const [{ syncBuiltIns, forgetSync }, { clearRetrievalCache }, { sellerFor }] = await Promise.all([import("@/lib/knowledge/rag/store"), import("@/lib/knowledge/rag/retrieve"), import("@/lib/seller")]);
    forgetSync();
    clearRetrievalCache();
    const r = await syncBuiltIns(sellerFor(job.sellerId));
    return { ok: true, message: `Knowledge base up to date: ${r.docs} built-in documents, ${r.embedded} re-embedded`, href: "/settings/knowledge" };
  },
};

/** Companies a job queued for research start in the background queue. */
async function kickQueue(job: BackgroundJob) {
  const { kickDrain } = await import("@/lib/queue/drain");
  await kickDrain((P(job)._origin as string | null) ?? null).catch(() => false);
}
