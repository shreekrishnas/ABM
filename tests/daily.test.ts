// "Recommended today": ranking, reasons, snooze and reject, learning from rejections, and which clients run.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { setResearchAllowed } from "@/lib/admin/research-clients";
import { buildDailyList, dailySettings, estimateDailyCost, istDate, markDecided, saveDailyList, type RecItem } from "@/lib/discover/recommend";
import { dailyClients, runClientDaily } from "@/lib/discover/daily";
import { newContext } from "@/lib/pipeline/context";
import { MANCH } from "@/lib/seller/manch";

const DAY = 86_400_000;
const now = new Date();

beforeEach(async () => {
  setAdapters(createMockAdapters());
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await setResearchAllowed("manch", true, "test");
  await baseDb.client.createMany({ data: [{ id: "manch", name: "Manch" }, { id: "acme", name: "Acme" }] });
});

const suggestion = (name: string, score: number, extra: Record<string, unknown> = {}) =>
  baseDb.prospectSuggestion.create({
    data: { sellerId: "manch", name, nameKey: name.toLowerCase(), bucket: "fmcg", score, level: score >= 70 ? "hot" : "warm", whyNow: `${name} is expanding`, sources: [{ url: `https://news.example.com/${name}`, quote: `${name} will add 3,000 distributors`, at: new Date(now.getTime() - 2 * DAY).toISOString(), trigger: "market:channel_expansion" }], ...extra },
  });

describe("building the list", () => {
  it("ranks new companies and held accounts with fresh signals, each with its reason and signals", async () => {
    await suggestion("Strong Foods", 85);
    await suggestion("Mild Foods", 40);
    const held = await baseDb.account.create({ data: { name: "Held Co", domain: "held.in", sellerId: "manch", fitScore: 90, intentScore: 60 } });
    await baseDb.evidence.create({ data: { accountId: held.id, key: "trigger", claim: "Held Co announced an SAP S/4HANA migration", sourceUrl: "https://held.in/press/s4", sourceType: "official", publishedAt: new Date(now.getTime() - DAY), status: "verified", confidence: 80, quote: "Held Co announced an SAP S/4HANA migration" } });
    const items = await buildDailyList("manch", dailySettings(), new Map(), now);
    expect(items.map((i) => i.name)).toEqual(expect.arrayContaining(["Strong Foods", "Mild Foods", "Held Co"]));
    const strong = items.find((i) => i.name === "Strong Foods")!;
    const mild = items.find((i) => i.name === "Mild Foods")!;
    expect(items.indexOf(strong)).toBeLessThan(items.indexOf(mild));
    for (const i of items) {
      expect(i.why.length).toBeGreaterThan(5);
      expect(i.signals.length).toBeGreaterThan(0);
      expect(i.estCostUsd).toBeGreaterThan(0);
    }
    expect(items.find((i) => i.name === "Held Co")).toMatchObject({ kind: "account" });
  });

  it("respects the list size, and hides snoozed and rejected items", async () => {
    for (let i = 0; i < 6; i++) await suggestion(`Co ${i}`, 50 + i);
    await baseDb.prospectSuggestion.updateMany({ where: { name: "Co 5" }, data: { snoozedUntil: new Date(now.getTime() + 7 * DAY) } });
    await baseDb.prospectSuggestion.updateMany({ where: { name: "Co 4" }, data: { status: "dismissed", rejectReasonKey: "not_now", decidedAt: now } });
    const items = await buildDailyList("manch", dailySettings({ maxNew: 3 }), new Map(), now);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.name)).not.toContain("Co 5");
    expect(items.map((i) => i.name)).not.toContain("Co 4");
  });

  it("rejections for 'wrong industry' lower similar companies", async () => {
    const a = await suggestion("Same Bucket A", 70);
    const before = (await buildDailyList("manch", dailySettings(), new Map(), now)).find((i) => i.id === a.id)!.score;
    for (let i = 0; i < 3; i++) await suggestion(`Rejected ${i}`, 70, { status: "dismissed", rejectReasonKey: "wrong_industry", decidedAt: now });
    const after = (await buildDailyList("manch", dailySettings(), new Map(), now)).find((i) => i.id === a.id)!.score;
    expect(after).toBeLessThan(before);
  });

  it("acting on an item keeps it in today's list, marked as decided", async () => {
    const s = await suggestion("Decide Me", 70);
    const items = await buildDailyList("manch", dailySettings(), new Map(), now);
    await saveDailyList("manch", istDate(now), items, {});
    await markDecided("manch", s.id, "snoozed 7 days", now);
    const row = await baseDb.dailyRecommendation.findUniqueOrThrow({ where: { sellerId_date: { sellerId: "manch", date: istDate(now) } } });
    expect((row.items as unknown as RecItem[]).find((i) => i.id === s.id)?.decided).toBe("snoozed 7 days");
  });
});

describe("which clients run", () => {
  it("only active clients with live research on (and the Test client on stand-ins)", async () => {
    expect(await dailyClients()).toEqual(["manch"]);
    await baseDb.client.create({ data: { id: "test", name: "Test" } });
    expect(await dailyClients()).toEqual(["manch", "test"]);
    await baseDb.client.update({ where: { id: "manch" }, data: { status: "paused" } });
    const { forgetClientStatus } = await import("@/lib/admin/client-status");
    forgetClientStatus();
    expect(await dailyClients()).toEqual(["test"]);
  });
});

describe("the daily run", () => {
  it("runs once a day per client and saves the list with what it did", async () => {
    await suggestion("Run Co", 80);
    const r = await runClientDaily("manch", newContext(), { budgetMs: 60_000 });
    expect(r).not.toBeNull();
    expect(await baseDb.dailyRecommendation.count({ where: { sellerId: "manch" } })).toBe(1);
    expect(await runClientDaily("manch", newContext(), { budgetMs: 60_000 })).toBeNull();
  });

  it("estimates the day's cost and never above the limit", () => {
    const est = estimateDailyCost(MANCH, dailySettings({ maxUsd: 0.1 }));
    expect(est.usd).toBeLessThanOrEqual(0.1);
    expect(est.lines.length).toBeGreaterThan(0);
  });
});
