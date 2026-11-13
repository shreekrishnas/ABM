// The fact buttons on the company page: Looks right, Keep this one, Correct.
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// No web request in tests: an empty cookie jar (nobody signed in).
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }));

import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { checkFactAction, keepFactAction } from "@/app/accounts/[id]/research-actions";
import { correctFact } from "@/lib/brain/feedback";

let accountId = "";
const fact = (claim: string, extra: Record<string, unknown> = {}) =>
  baseDb.evidence.create({ data: { accountId, key: "trigger", claim, sourceUrl: `https://news.example.com/${encodeURIComponent(claim)}`, sourceType: "news", publishedAt: new Date("2026-10-01T00:00:00Z"), status: "probable", confidence: 50, quote: claim, ...extra } });

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  accountId = (await baseDb.account.create({ data: { name: "Fact Co", domain: "factco.in", sellerId: "manch" } })).id;
});

describe("Looks right", () => {
  it("marks the fact checked and verified with high confidence; pressing again undoes it", async () => {
    const f = await fact("Fact Co opened a new plant");
    expect((await checkFactAction(f.id))?.ok).toBe(true);
    const on = await baseDb.evidence.findUniqueOrThrow({ where: { id: f.id } });
    expect(on.checkedAt).not.toBeNull();
    expect(on.status).toBe("verified");
    expect(on.confidence).toBeGreaterThanOrEqual(90);
    await checkFactAction(f.id);
    const off = await baseDb.evidence.findUniqueOrThrow({ where: { id: f.id } });
    expect(off.checkedAt).toBeNull();
  });
});

describe("Keep this one", () => {
  it("keeps one version, retires the other (kept for the record, never deleted)", async () => {
    const a = await fact("Fact Co has 5,000 employees", { status: "conflicting" });
    const b = await fact("Fact Co has 900 employees", { status: "conflicting" });
    expect((await keepFactAction(a.id))?.ok).toBe(true);
    expect(await baseDb.evidence.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "verified" });
    expect(await baseDb.evidence.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ supersededById: a.id });
    expect(await baseDb.evidence.count({ where: { accountId } })).toBe(2);
  });
});

describe("Correct", () => {
  it("the correction is marked as checked by the team and keeps the original date", async () => {
    const f = await fact("Fact Co plans 2 plants");
    await correctFact(f.id, { claim: "Fact Co plans 3 plants", sourceUrl: null, by: "asha@trilliantdigital.com" });
    const fresh = await baseDb.evidence.findFirstOrThrow({ where: { accountId, claim: "Fact Co plans 3 plants" } });
    expect(fresh).toMatchObject({ sourceType: "team", status: "verified" });
    expect(fresh.publishedAt.toISOString()).toBe(f.publishedAt.toISOString());
    const old = await baseDb.evidence.findUniqueOrThrow({ where: { id: f.id } });
    expect(old).toMatchObject({ flagged: true, supersededById: fresh.id });
  });
});
