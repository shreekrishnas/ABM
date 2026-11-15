// Alerts for things that quietly stop the platform: the AI key limit, a missed daily check, silent visitors.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { systemAlerts } from "@/lib/admin/alerts";

const now = new Date("2026-11-15T12:00:00Z");
const H = 3_600_000;
const prevKey = process.env.APOLLO_API_KEY;

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.runLog.create({ data: { job: "Daily check", startedAt: new Date(now.getTime() - 10 * H), finishedAt: new Date(now.getTime() - 10 * H), ok: true } });
});
afterEach(() => { if (prevKey === undefined) delete process.env.APOLLO_API_KEY; else process.env.APOLLO_API_KEY = prevKey; });

describe("system alerts", () => {
  it("all quiet: nothing to report", async () => {
    expect(await systemAlerts(now)).toEqual([]);
  });

  it("the AI key limit shows with its numbers and how to fix it, and clears once AI calls go through", async () => {
    const err = await baseDb.errorLog.create({ data: { source: "pipeline stage 6", message: 'OpenRouter 403: {"error":{"message":"Key limit exceeded (monthly limit). $5.03 of $5.00 used; resets 2026-12-01"}}', count: 2, firstSeen: new Date(now.getTime() - 5 * H), lastSeen: new Date(now.getTime() - 4 * H), fingerprint: "k1" } as never });
    const a = (await systemAlerts(now)).find((x) => x.key === "ai_blocked");
    expect(a?.detail).toMatch(/\$5\.03 of \$5\.00 used/);
    expect(a?.fix).toMatch(/OpenRouter/);
    const acct = await baseDb.account.create({ data: { name: "Test Co", domain: "testco.in", sellerId: "test" } });
    for (let i = 0; i < 3; i++) await baseDb.ledgerEntry.create({ data: { accountId: acct.id, kind: "llm", amountMicros: 1000, description: "call", stage: 6, createdAt: new Date(err.lastSeen.getTime() + (i + 2) * 60_000) } as never });
    expect((await systemAlerts(now)).some((x) => x.key === "ai_blocked")).toBe(false);
  });

  it("a daily check that hasn't run for over a day is flagged", async () => {
    await baseDb.runLog.deleteMany({});
    await baseDb.runLog.create({ data: { job: "Daily check", startedAt: new Date(now.getTime() - 40 * H), finishedAt: new Date(now.getTime() - 40 * H), ok: true } });
    expect((await systemAlerts(now)).map((x) => x.key)).toContain("daily_missed");
  });

  it("website visitors silent for two weeks are flagged when Apollo is on", async () => {
    process.env.APOLLO_API_KEY = "dummy";
    await baseDb.webVisit.create({ data: { companyName: "Old Co", url: "https://apollo.io/website-visitors", path: "/", topic: "general", source: "apollo", occurredAt: new Date("2026-10-31T10:00:00Z") } });
    const a = (await systemAlerts(now)).find((x) => x.key === "visitors_quiet");
    expect(a?.detail).toMatch(/31 Oct/);
  });
});
