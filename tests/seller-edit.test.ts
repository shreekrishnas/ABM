import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { builtInPack, clearSellerOverrides, ensureSellerPacks, hashPack, loadSeller, packSource, type SellerProfile } from "@/lib/seller";
import { resetToBuiltIn, restoreRevision, saveSellerPack } from "@/lib/seller/edit";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runAccount } from "@/lib/pipeline/orchestrator";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) {
    await db.sequence.create({ data: { name: `${tier}`, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead" }] } } });
  }
  clearSellerOverrides();
}

const current = () => structuredClone(loadSeller("manch").pack);

beforeAll(() => setAdapters(createMockAdapters()));
beforeEach(reset);

describe("saving a seller pack", () => {
  it("a valid edit becomes the active pack with a new version, and lists what changed", async () => {
    const before = loadSeller("manch");
    const p = current();
    p.sender.address = "4th Floor, 12 MG Road, Bengaluru, Karnataka 560001, India";
    p.messaging.cta = "Open to a short call next week?";
    const r = await saveSellerPack("manch", p, "Full postal address");
    expect(r).toMatchObject({ ok: true, changed: ["messaging", "sender"] });
    const after = loadSeller("manch");
    expect(after.pack.sender.address).toContain("MG Road");
    expect(after.version).not.toBe(before.version);
    expect(after.version).toBe(hashPack(p));
    expect(packSource("manch")).toMatchObject({ source: "edited" });
    const rev = await db.sellerPackRevision.findFirstOrThrow();
    expect(rev).toMatchObject({ note: "Full postal address", changed: ["messaging", "sender"] });
  });

  it("refuses invalid packs and explains why, saving nothing", async () => {
    const p = current();
    p.icp.geos.primary = ["India"];
    p.researchQuestions = p.researchQuestions.filter((q) => q.key !== "negative");
    const r = await saveSellerPack("manch", p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(" ")).toMatch(/2-letter country codes/);
    const q = current();
    q.researchQuestions = q.researchQuestions.filter((x) => x.key !== "negative");
    const r2 = await saveSellerPack("manch", q);
    expect(!r2.ok && r2.problems).toContain('research question "negative" is required');
    expect(await db.sellerPackRevision.count()).toBe(0);
  });

  it("refuses unknown fields, a changed id, wrong tier order and no-op saves", async () => {
    const extra = { ...current(), surprise: true };
    expect((await saveSellerPack("manch", extra)).ok).toBe(false);
    expect(await saveSellerPack("manch", { ...current(), id: "other" })).toMatchObject({ ok: false, problems: ['id must stay "manch"'] });
    const t = current();
    t.icp.tierBySize = { T1: 1000, T2: 5000 };
    expect(await saveSellerPack("manch", t)).toMatchObject({ ok: false, problems: ["tier by size: the T1 threshold must be above T2"] });
    expect(await saveSellerPack("manch", current())).toMatchObject({ ok: false, problems: ["Nothing changed"] });
    expect(await saveSellerPack("nobody", current())).toMatchObject({ ok: false });
  });
});

describe("history", () => {
  it("restore makes an older version active again as a new revision; reset goes back to code", async () => {
    const builtIn = builtInPack("manch")!;
    const a = current();
    a.tone = [...a.tone, "No exclamation marks"];
    await saveSellerPack("manch", a, "v1");
    const v1 = await db.sellerPackRevision.findFirstOrThrow({ where: { note: "v1" } });
    const b = current();
    b.bannedClaims = [...b.bannedClaims, "time-to-value under 1 week"];
    await saveSellerPack("manch", b, "v2");
    expect(loadSeller("manch").pack.bannedClaims).toContain("time-to-value under 1 week");

    const r = await restoreRevision(v1.id);
    expect(r).toMatchObject({ ok: true, changed: ["bannedClaims"] });
    expect(loadSeller("manch").pack.bannedClaims).not.toContain("time-to-value under 1 week");
    expect(loadSeller("manch").pack.tone).toContain("No exclamation marks");
    expect(await db.sellerPackRevision.count()).toBe(3);

    expect(await resetToBuiltIn("manch")).toMatchObject({ ok: true });
    expect(loadSeller("manch").pack).toEqual(builtIn);
    expect(packSource("manch").source).toBe("built-in");
    expect(await resetToBuiltIn("manch")).toMatchObject({ ok: false, problems: ["Already using the built-in pack"] });
    expect(await db.sellerPackRevision.count()).toBe(4);
  });

  it("a stored revision that no longer validates is kept out of runs and reported", async () => {
    const bad = current() as unknown as Record<string, unknown>;
    bad.autonomy = "send_everything";
    await db.sellerPackRevision.create({ data: { sellerId: "manch", pack: bad as never, version: "broken", changed: ["autonomy"] } });
    await ensureSellerPacks();
    expect(loadSeller("manch").pack.autonomy).toBe(builtInPack("manch")!.autonomy);
    expect(packSource("manch").rejected?.problems.join(" ")).toMatch(/autonomy/);
  });
});

describe("runs use the saved pack", () => {
  it("facts from a run carry the edited pack's version", async () => {
    const p = current();
    p.messaging.default = "Edited default pitch for this test.";
    const saved = await saveSellerPack("manch", p);
    expect(saved.ok).toBe(true);
    clearSellerOverrides(); // a fresh server process: nothing loaded yet
    const { accountIds } = await ingestRows([{ company: "Strong Edit Co", domain: "strong-edit.com", industry: "fmcg", employees: "1500", country: "IN", contactName: "Meera Rao", email: "meera.rao@strong-edit.com", title: "CIO" }], { source: "csv" });
    await runAccount(accountIds[0]);
    const facts = await db.evidence.findMany({ where: { accountId: accountIds[0] } });
    expect(facts.length).toBeGreaterThan(0);
    expect(new Set(facts.map((f) => f.sellerPackVersion))).toEqual(new Set([saved.ok ? saved.version : ""]));
  });
});

export type { SellerProfile };
