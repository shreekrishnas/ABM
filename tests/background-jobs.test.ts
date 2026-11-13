// Background jobs: a long task runs on its own; buttons answer at once; jobs stay with their client.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { setResearchAllowed } from "@/lib/admin/research-clients";
import { JOB_STALE_MS, jobsFor, runJob, startJob } from "@/lib/jobs";

const ME = "asha@trilliantdigital.com";

beforeEach(async () => {
  setAdapters(createMockAdapters());
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await setResearchAllowed("manch", true, "test");
  await baseDb.client.createMany({ data: [{ id: "manch", name: "Manch" }, { id: "acme", name: "Acme" }] });
});

const waitFor = async (id: string) => {
  for (let i = 0; i < 100; i++) {
    const j = await baseDb.backgroundJob.findUniqueOrThrow({ where: { id } });
    if (j.status === "done" || j.status === "failed") return j;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("job did not finish");
};

describe("starting and running", () => {
  it("a job is saved for its client, runs, and ends done with a message and a link", async () => {
    const r = await startJob("daily_run", { sellerId: "manch", label: "Build Recommended today", createdBy: ME });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/^Started:/);
    const j = await waitFor(r.id!);
    expect(j).toMatchObject({ status: "done", sellerId: "manch", href: "/discover#recommended" });
    expect(j.message).toMatch(/Recommended today/);
  });

  it("a second press while the same job runs says it's already running", async () => {
    await baseDb.backgroundJob.create({ data: { kind: "scan_market", sellerId: "manch", label: "Scan the market", status: "running", createdBy: ME } });
    const r = await startJob("scan_market", { sellerId: "manch", label: "Scan the market", createdBy: ME });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Already running/);
    // The same kind of job for another client is fine.
    const other = await startJob("scan_market", { sellerId: "acme", label: "Scan the market", createdBy: ME });
    expect(other.ok).toBe(true);
    await waitFor(other.id!);
  });

  it("a failing job is marked failed with a plain reason", async () => {
    const j = await baseDb.backgroundJob.create({ data: { kind: "run_account", sellerId: "manch", accountId: "does-not-exist", label: "Run pipeline: Ghost", createdBy: ME } });
    await runJob(j.id);
    const done = await baseDb.backgroundJob.findUniqueOrThrow({ where: { id: j.id } });
    expect(done.status).toBe("failed");
    expect(done.message).toBeTruthy();
  });

  it("a job runs only once even if started twice", async () => {
    const j = await baseDb.backgroundJob.create({ data: { kind: "daily_run", sellerId: "manch", label: "Build Recommended today", createdBy: ME } });
    await Promise.all([runJob(j.id), runJob(j.id)]);
    expect(await baseDb.runLog.count({ where: { job: { startsWith: "Job · Build Recommended today" } } })).toBe(1);
  });
});

describe("the top-bar list", () => {
  it("shows only the person's own jobs, and a job past the time limit reads as failed", async () => {
    await baseDb.backgroundJob.create({ data: { kind: "scan_market", sellerId: "manch", label: "Mine", status: "done", message: "ok", createdBy: ME } });
    await baseDb.backgroundJob.create({ data: { kind: "scan_market", sellerId: "manch", label: "Someone else's", status: "done", createdBy: "other@trilliantdigital.com" } });
    await baseDb.backgroundJob.create({ data: { kind: "lookalikes", sellerId: "acme", label: "Stuck", status: "running", createdBy: ME, createdAt: new Date(Date.now() - JOB_STALE_MS - 60_000) } });
    const list = await jobsFor(ME);
    expect(list.map((j) => j.label).sort()).toEqual(["Mine", "Stuck"]);
    expect(list.find((j) => j.label === "Stuck")).toMatchObject({ status: "failed", client: "Acme" });
  });
});
