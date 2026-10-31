import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseDb } from "@/lib/db-base";
import { charge, recordAccountCost, BudgetExceeded } from "@/lib/pipeline/context";
import { MonthlyBudgetExceeded, ensureMonthlyBudget, monthSpendUsd, monthlyStatus } from "@/lib/budget";
import { hit } from "@/lib/rate-limit";
import { recordError, recentErrors } from "@/lib/admin/errors";
import { cachedPages, searchKey, setSearchCache, storePages } from "@/lib/research/search-cache";
import { clearEmailOnlyConflicts } from "@/lib/admin/cleanup";
import { spendByAccount } from "@/lib/admin/health";
import { scopeWhere } from "@/lib/scope";

beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.client.createMany({ data: [{ id: "manch", name: "Manch", monthlyBudgetUsd: 1 }, { id: "acme", name: "Acme" }] });
});
afterEach(() => setSearchCache(false));

describe("monthly spending caps", () => {
  it("counts company costs and account-level costs (lookalikes) together, per account", async () => {
    const a = await baseDb.account.create({ data: { name: "Co", domain: "co.in", sellerId: "manch" } });
    await charge(a.id, "T1", "search", 0.3, "search", 5);
    await recordAccountCost("manch", "search", 0.2, "Lookalike research");
    await recordAccountCost("acme", "llm", 5, "Other account");
    expect(await monthSpendUsd("manch")).toBeCloseTo(0.5);
    expect((await spendByAccount()).get("manch")?.total).toBeCloseTo(0.5);
    expect((await monthlyStatus()).get("acme")).toMatchObject({ cap: null, state: "ok" });
  });

  it("stops paid work once the cap would be passed, and warns at 80%", async () => {
    const a = await baseDb.account.create({ data: { name: "Co", domain: "co.in", sellerId: "manch" } });
    await charge(a.id, "T1", "search", 0.85, "search", 5);
    expect((await monthlyStatus()).get("manch")).toMatchObject({ state: "warn" });
    const err = await charge(a.id, "T1", "search", 0.2, "search", 5).catch((e) => e);
    expect(err).toBeInstanceOf(MonthlyBudgetExceeded);
    expect(err).toBeInstanceOf(BudgetExceeded); // so the pipeline stops the run and tells a person
    await expect(ensureMonthlyBudget("acme", 1000)).resolves.toBeUndefined(); // no cap set
  });

  it("account-level costs stay inside their account", () => {
    expect(scopeWhere("LedgerEntry", ["manch"])).toEqual({ OR: [{ account: { sellerId: { in: ["manch"] } } }, { accountId: null, sellerId: { in: ["manch"] } }] });
  });
});

describe("rate limits", () => {
  it("allows up to the limit in a window, then refuses until the window resets", async () => {
    const t0 = new Date("2026-10-31T10:00:00Z");
    for (let i = 0; i < 3; i++) expect((await hit("login:ip:1.2.3.4", 3, 60_000, t0)).ok).toBe(true);
    const blocked = await hit("login:ip:1.2.3.4", 3, 60_000, new Date(t0.getTime() + 1000));
    expect(blocked).toMatchObject({ ok: false });
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect((await hit("login:ip:1.2.3.4", 3, 60_000, new Date(t0.getTime() + 61_000))).ok).toBe(true);
    expect((await hit("login:ip:5.6.7.8", 3, 60_000, t0)).ok).toBe(true); // other callers unaffected
  });
});

describe("error log", () => {
  it("groups the same failure in the same place into one row with a count", async () => {
    await recordError("pipeline stage 5", new Error("Exa 503: timeout after 25000ms for 7f3a9c2e11"));
    await recordError("pipeline stage 5", new Error("Exa 503: timeout after 26000ms for 8a1b2c3d44"));
    await recordError("lookalike investigation", new Error("other failure"));
    const rows = await recentErrors();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.source === "pipeline stage 5")?.count).toBe(2);
  });
});

describe("search cache", () => {
  it("reuses a search for 48 hours", async () => {
    setSearchCache(true);
    const key = searchKey(["search", "acme.com", "Acme", "trigger", "main"]);
    expect(await cachedPages(key)).toBeNull();
    await storePages(key, [{ url: "https://n.example/a", title: "Acme expands", text: "Acme expands.", publishedAt: new Date("2026-10-01"), sourceType: "news" }]);
    const hit1 = await cachedPages(key);
    expect(hit1?.[0].publishedAt).toBeInstanceOf(Date);
    expect(await cachedPages(key, new Date(Date.now() + 49 * 3_600_000))).toBeNull();
  });
});

describe("old email conflicts", () => {
  it("closes identity items that were only about the email; keeps ones where the employer disagrees", async () => {
    const a = await baseDb.account.create({ data: { name: "Co", domain: "co.in", sellerId: "manch" } });
    const p1 = await baseDb.contact.create({ data: { accountId: a.id, fullName: "Only Email" } });
    const p2 = await baseDb.contact.create({ data: { accountId: a.id, fullName: "Moved Job" } });
    await baseDb.fieldState.createMany({ data: [
      { contactId: p1.id, field: "email", status: "conflicting" },
      { contactId: p2.id, field: "email", status: "conflicting" },
      { contactId: p2.id, field: "company", status: "conflicting" },
    ] });
    await baseDb.reviewItem.createMany({ data: [
      { type: "identity_conflict", stage: 4, accountId: a.id, contactId: p1.id, reason: "x" },
      { type: "identity_conflict", stage: 4, accountId: a.id, contactId: p2.id, reason: "y" },
    ] });
    expect(await clearEmailOnlyConflicts()).toEqual({ emails: 2, reviews: 1 });
    expect(await baseDb.reviewItem.count({ where: { status: "open" } })).toBe(1);
  });
});

vi.setConfig({ testTimeout: 30_000 });

describe("queue watchdog", () => {
  it("checks at most every 5 minutes and reports a stopped queue it can't restart", async () => {
    const { watchQueue } = await import("@/lib/queue/watchdog");
    await baseDb.account.create({ data: { name: "Waiting", domain: "w.in", sellerId: "manch", pipelineStatus: "queued" } });
    const t0 = new Date();
    expect(await watchQueue(null, t0)).toBe(false); // no address to call: can't restart
    expect((await recentErrors()).some((e) => e.source === "queue watchdog")).toBe(true);
    const lease = await baseDb.jobLease.findUnique({ where: { name: "watchdog" } });
    expect(lease!.expiresAt.getTime()).toBeGreaterThan(t0.getTime());
    // A second check within 5 minutes does nothing (another server already looked).
    await baseDb.errorLog.deleteMany({});
    expect(await watchQueue(null, new Date(t0.getTime() + 60_000))).toBe(false);
    expect(await recentErrors()).toHaveLength(0);
  });

  it("puts a run that was cut off back in the queue, even when nothing else is queued", async () => {
    const { requeueCutOffRuns } = await import("@/lib/queue/drain");
    const old = await baseDb.account.create({ data: { name: "Cut off", domain: "cut.in", sellerId: "manch", pipelineStatus: "running", pipelineStage: 6, lastRunAt: new Date(Date.now() - 20 * 60_000) } });
    const live = await baseDb.account.create({ data: { name: "Still running", domain: "live.in", sellerId: "manch", pipelineStatus: "running", pipelineStage: 4, lastRunAt: new Date() } });
    expect(await requeueCutOffRuns()).toBe(1);
    const a = await baseDb.account.findUniqueOrThrow({ where: { id: old.id } });
    expect(a.pipelineStatus).toBe("queued");
    expect(a.queuedFromStage).toBe(7); // resumes after the last finished step
    expect((await baseDb.account.findUniqueOrThrow({ where: { id: live.id } })).pipelineStatus).toBe("running");
  });
});
