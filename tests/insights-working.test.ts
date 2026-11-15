// "What's working": the numbers come out right from Test data.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { reasonGroup, working } from "@/lib/insights/working";

const now = new Date();
const H = 3_600_000;

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
});

describe("reason groups", () => {
  it("groups the same reason with different details", () => {
    expect(reasonGroup("Too small (430 employees; must be more than 5,000)")).toBe("Too small");
    expect(reasonGroup("Too small (1,200 employees; must be more than 5,000)")).toBe("Too small");
    expect(reasonGroup("Outside target countries (AE; must be IN)")).toBe("Outside target countries");
  });
});

describe("what's working", () => {
  it("counts the funnel, what the team did with drafts, by shape and use case, rejections, stops, cost and wait", async () => {
    const a = await baseDb.account.create({ data: { name: "Test Pharma", domain: "testpharma.in", sellerId: "manch", lastRunAt: now } });
    const b = await baseDb.account.create({ data: { name: "Small Co", domain: "smallco.in", sellerId: "manch" } });
    await baseDb.evidence.create({ data: { accountId: a.id, key: "trigger", claim: "Test Pharma announced an SAP S/4HANA migration", sourceUrl: "https://x.example/1", sourceType: "news", publishedAt: now, status: "verified" } });
    const c = await baseDb.contact.create({ data: { accountId: a.id, fullName: "Asha Rao", email: "asha@testpharma.in", readiness: "ready" } });
    const brief = (shape: string, uc: string) => ({ shape: { key: "news", label: shape, why: "t" }, focus: { useCase: uc, why: [] }, whyUs: { useCase: uc } });
    const mk = (status: string, extra: Record<string, unknown> = {}) => baseDb.draft.create({ data: { contactId: c.id, stepOrder: 1, subject: "s", body: "b", claims: [], status: status as never, createdAt: new Date(now.getTime() - 10 * H), ...extra } });
    await mk("approved", { reviewedAt: new Date(now.getTime() - 8 * H), brief: brief("Their news first", "Vendor onboarding") });
    await mk("approved", { reviewedAt: new Date(now.getTime() - 6 * H), reviewerNote: "Edited by reviewer", brief: brief("Their news first", "Vendor onboarding") });
    await mk("rejected", { reviewedAt: new Date(now.getTime() - 9 * H), reviewerNote: "Too salesy for a CFO", brief: brief("A sharp question first", "Distributor onboarding") });
    await mk("rejected", { reviewerNote: "Withdrawn — company paused" }); // automatic, not the team
    await mk("pending_review", { brief: brief("A peer's result first", "Vendor onboarding") });
    await mk("needs_refresh");
    await baseDb.pipelineEvent.create({ data: { accountId: b.id, stage: 2, step: "orchestrator.stop", outcome: "block", reason: "Too small (430 employees; must be more than 5,000)" } });
    await baseDb.ledgerEntry.create({ data: { accountId: a.id, sellerId: "manch", kind: "llm", amountMicros: 300_000, description: "x", stage: 6 } });

    const w = await working(now);
    expect(w.funnel.map((f) => f.value)).toEqual([2, 1, 1, 5, 2]);
    expect(w.drafts).toMatchObject({ written: 5, approved: 2, approvedAsIs: 1, edited: 1, rejected: 1, pending: 1, replaced: 1 });
    expect(w.rejections).toEqual([{ reason: "Too salesy for a CFO", count: 1 }]);
    expect(w.byShape.find((r) => r.label === "Their news first")).toMatchObject({ total: 2, approved: 2, edited: 1 });
    expect(w.byUseCase.find((r) => r.label === "Distributor onboarding")).toMatchObject({ rejected: 1 });
    expect(w.stops).toEqual([{ reason: "Too small", count: 1 }]);
    expect(w.cost.perApproved).toBeCloseTo(0.15);
    expect(w.wait.medianHours).toBeCloseTo(2); // reviewed after 2h, 4h and 1h (the automatic withdrawal doesn't count)
  });
});
