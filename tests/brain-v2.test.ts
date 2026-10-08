import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as dnsPromises } from "node:dns";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runAccount } from "@/lib/pipeline/orchestrator";
import { sendApproved } from "@/lib/pipeline/stages/engagement";
import { newContext } from "@/lib/pipeline/context";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { DisconnectedSender, MxVerifier } from "@/lib/adapters/live/email";
import { SELLERS, loadSeller, packVersion, withSeller } from "@/lib/seller";
import { validatePack } from "@/lib/seller/schema";
import { MANCH } from "@/lib/seller/manch";
import { bannedClaimGate, needsHumanApproval, quoteGate } from "@/lib/pipeline/gates";
import { replay } from "@/lib/brain/bus";
import { generateInsights } from "@/lib/brain/insights";
import type { SellerProfile } from "@/lib/seller/types";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) await db.sequence.create({ data: { name: tier, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead with trigger" }] } } });
}

async function account(domain: string, extra: Record<string, unknown> = {}, sellerId?: string) {
  const r = await ingestRows([{ company: domain.split(".")[0], domain, industry: "fmcg", employees: 1500, country: "IN", contactName: "Asha Mehta", title: "VP Data", email: `asha.mehta@${domain}`, ...extra }], { source: "test" });
  if (sellerId) await db.account.update({ where: { id: r.accountIds[0] }, data: { sellerId } });
  return r.accountIds[0];
}

// A second seller: same shape, different identity. Adding it needs no core change.
const ACME: SellerProfile = {
  ...MANCH,
  id: "acme",
  name: "Acme Ledger",
  sender: { company: "Acme Ledger", name: "Team Acme", address: "1 Market Street, Pune, India" },
  messaging: { cta: "Worth a short call?", byUseCase: Object.fromEntries(MANCH.useCases.map((u) => [u.key, "Acme Ledger closes the books in days, not weeks."])), default: "Acme Ledger closes the books in days, not weeks." },
  proofPoints: [{ text: "A listed retailer closes its month in 3 days with Acme Ledger.", source: "acme.example/case" }],
  bannedClaims: ["zero errors"],
};

beforeEach(async () => {
  setAdapters(createMockAdapters());
  SELLERS.acme = ACME;
  await reset();
});
afterEach(() => {
  delete SELLERS.acme;
  setAdapters(createMockAdapters());
  vi.restoreAllMocks();
});

describe("seller packs", () => {
  it("every pack is valid and has a stable version hash", () => {
    for (const p of Object.values(SELLERS)) expect(validatePack(p)).toEqual([]);
    expect(packVersion(MANCH)).toMatch(/^[0-9a-f]{12}$/);
    expect(validatePack({ ...MANCH, id: "bad", researchQuestions: MANCH.researchQuestions.filter((q) => q.key !== "negative") })).toContain('research question "negative" is required');
  });

  it("no seller-specific words in core code", () => {
    const root = path.resolve(__dirname, "../src/lib");
    const allowed = /(^|\/)(seller\/|seed\.ts$|adapters\/mock\.ts$|import\/fields\.ts$|pipeline\/normalize\.ts$)/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const full = path.join(dir, f);
        const rel = path.relative(root, full);
        if (statSync(full).isDirectory()) walk(full);
        else if (f.endsWith(".ts") && !allowed.test(rel) && /\bManch\b|\bMDM\b|S\/4HANA/.test(readFileSync(full, "utf8"))) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it("a run takes its identity from the account's seller and stamps every output with it", async () => {
    const id = await account("strong-acme.com", {}, "acme");
    await runAccount(id);
    const v = packVersion(ACME);
    const draft = await db.draft.findFirstOrThrow({ where: { contact: { accountId: id } } });
    expect(draft.body).toContain("1 Market Street, Pune, India");
    expect(draft.body).not.toContain("Manch");
    expect(draft).toMatchObject({ sellerId: "acme", sellerPackVersion: v });
    expect(await db.evidence.count({ where: { accountId: id, sellerId: { not: "acme" } } })).toBe(0);
    expect((await db.accountBrief.findFirstOrThrow({ where: { accountId: id } })).sellerId).toBe("acme");
    const signals = await replay({ accountId: id });
    expect(new Set(signals.map((s) => s.sellerId))).toEqual(new Set(["acme"]));
    // The default seller is untouched outside the run.
    expect(await withSeller("manch", async () => loadSeller(undefined).pack.id)).toBe("manch");
  });

  it("an unknown seller stops the run before any work", async () => {
    const id = await account("strong-ghost.com", {}, "ghost");
    const r = await runAccount(id);
    expect(r.status).toBe("error");
    expect(await db.evidence.count({ where: { accountId: id } })).toBe(0);
  });
});

describe("main brain and signal bus", () => {
  it("publishes a replayable run: context, plan, judged evidence, brief, drafts, finish", async () => {
    const id = await account("strong-bus.com");
    await runAccount(id);
    const types = (await replay({ accountId: id })).map((s) => s.type);
    for (const t of ["seller.context", "run.planned", "fit.scored", "research.done", "evidence.judged", "brief.ready", "readiness.decided", "draft.critiqued", "draft.ready", "run.finished"]) expect(types).toContain(t);
    expect(types[0]).toBe("seller.context");
    expect(types.at(-1)).toBe("run.finished");
  });

  it("when the strategist says strong but the evidence is weak, the weaker verdict wins and both sides are recorded", async () => {
    const a = createMockAdapters();
    const brief = a.llm.accountBrief.bind(a.llm);
    a.llm.accountBrief = async (input) => ({ ...(await brief(input)), verdict: "strong", verdictWhy: "Big company in a primary vertical" });
    setAdapters(a);
    const id = await account("weak-conflict.com");
    await runAccount(id);
    expect((await replay({ accountId: id })).some((s) => s.type === "verdict.conflict")).toBe(true);
    const d = await db.decision.findFirstOrThrow({ where: { accountId: id, module: "main_brain", choice: { contains: "weaker verdict" } } });
    expect(d.caseFor).toContain("Strategist");
    expect(d.caseAgainst).toContain("Evidence judge");
  });
});

describe("truth before speed", () => {
  it("a fact needs an exact quote that is really on its page", () => {
    const page = { title: "Kaveri Foods to add 3,000 distributors", text: "Kaveri Foods said on Monday it will add 3,000 rural distributors this year." };
    expect(quoteGate("it will add 3,000 rural distributors this year", page, "live").pass).toBe(true);
    expect(quoteGate("it will add 5,000 rural distributors this year", page, "live").reason).toBe("Quote does not appear on the source page");
    expect(quoteGate(null, page, "live").pass).toBe(false);
    expect(quoteGate(null, page, "mock").pass).toBe(true);
  });

  it("every stored fact carries its supporting quote", async () => {
    const id = await account("strong-quotes.com");
    await runAccount(id);
    const facts = await db.evidence.findMany({ where: { accountId: id } });
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.filter((f) => (f.quote ?? "").length <= 5).map((f) => [f.key, f.quote, f.claim])).toEqual([]);
  });

  it("banned claims are caught by code, for every seller and per seller", () => {
    expect(bannedClaimGate("We guarantee a 3x ROI", []).pass).toBe(false);
    expect(bannedClaimGate("Acme gives you zero errors", ["zero errors"]).pass).toBe(false);
    expect(bannedClaimGate("Worth a short call?", ["zero errors"]).pass).toBe(true);
  });
});

describe("critic panel and rewriter", () => {
  it("rewrites the email itself until every critic passes, and records why", async () => {
    const a = createMockAdapters();
    const seen: (string[] | undefined)[] = [];
    const draft = a.llm.draft.bind(a.llm);
    a.llm.draft = async (input, attempt) => {
      seen.push(input.revise?.issues);
      const d = await draft(input, attempt);
      return attempt === 1 ? { ...d, body: d.body.replace("Hi", "Hi — our revolutionary platform is here.") } : d;
    };
    setAdapters(a);
    const id = await account("strong-critic.com");
    await runAccount(id);
    const d = await db.draft.findFirstOrThrow({ where: { contact: { accountId: id } } });
    expect(d.rewrites).toBe(1);
    expect(d.body).not.toContain("revolutionary");
    expect(seen[1]?.join(" ")).toMatch(/revolutionary/);
    expect(d.status).toBe("pending_review");
    const dec = await db.decision.findFirstOrThrow({ where: { draftId: d.id } });
    expect(dec.caseAgainst).toContain("1 rewrite");
    expect(dec.evidenceFor.length).toBeGreaterThan(0);
  });

  it("a draft still failing after the loop cap is held for a person, never sent", async () => {
    const a = createMockAdapters();
    const draft = a.llm.draft.bind(a.llm);
    a.llm.draft = async (input, attempt) => {
      const d = await draft(input, attempt);
      return { ...d, body: d.body.replace("Hi", "Hi — results guaranteed.") };
    };
    setAdapters(a);
    const id = await account("strong-banned.com");
    await runAccount(id);
    const d = await db.draft.findFirstOrThrow({ where: { contact: { accountId: id } } });
    expect(d.status).toBe("blocked");
    expect(d.rewrites).toBe(2);
    expect(d.blockReason).toMatch(/Banned claim/);
    expect(await db.reviewItem.count({ where: { draftId: d.id, type: "guardrail_failed" } })).toBe(1);
  });

  it("autonomy level is a code fence", async () => {
    expect(needsHumanApproval("T1", "review_all")).toBe(true);
    expect(needsHumanApproval("T3", "auto_t3")).toBe(false);
    expect(needsHumanApproval("T1", "auto_t3")).toBe(true);
    SELLERS.acme = { ...ACME, autonomy: "auto_all" };
    const id = await account("strong-auto.com", {}, "acme");
    await runAccount(id);
    const d = await db.draft.findFirstOrThrow({ where: { contact: { accountId: id } } });
    expect(d.status).toBe("approved");
    expect((await db.decision.findFirstOrThrow({ where: { draftId: d.id } })).autonomy).toBe("acted");
  });
});

describe("email channel", () => {
  it("with no mailbox connected, approved emails are held, not 'sent'", async () => {
    SELLERS.acme = { ...ACME, autonomy: "auto_all" };
    const id = await account("strong-held.com", {}, "acme");
    await runAccount(id);
    const a = createMockAdapters();
    a.email = new DisconnectedSender();
    const approved = await db.draft.count({ where: { status: "approved" } });
    expect(approved).toBeGreaterThan(0);
    const r = await sendApproved({ ...newContext(), adapters: a });
    expect(r).toMatchObject({ sent: 0, held: approved });
    expect(await db.message.count()).toBe(0);
  });

  it("the free MX check proves the domain, not the mailbox", async () => {
    vi.spyOn(dnsPromises, "resolveMx").mockImplementation(async (d: string) => {
      if (d === "nomail.example") throw Object.assign(new Error("none"), { code: "ENODATA" });
      return [{ exchange: "mx.kaveri.example", priority: 10 }];
    });
    const v = new MxVerifier();
    expect(await v.verify("asha@kaveri.example")).toMatchObject({ deliverable: true, status: "probable" });
    expect(await v.verify("asha@nomail.example")).toMatchObject({ deliverable: false, status: "invalid" });
    expect(await v.verify("not-an-email")).toMatchObject({ deliverable: false });
  });
});

describe("learning", () => {
  it("learns from reviewer edits first, labels small samples tentative, and only proposes changes", async () => {
    const id = await account("strong-learn.com");
    await runAccount(id);
    const d = await db.draft.findFirstOrThrow({ where: { contact: { accountId: id } } });
    for (let i = 0; i < 4; i++) {
      await db.draft.create({ data: { contactId: d.contactId, stepOrder: 10 + i, subject: "s", body: "b", claims: [], useCase: "vendor_onboarding", status: "rejected", reviewedAt: new Date(), reviewerNote: "Too generic" } });
    }
    const i = await generateInsights();
    expect(i.stats.reviewer.byUseCase.find((r) => r.label === "vendor_onboarding")).toMatchObject({ n: 4, tentative: true });
    const p = await db.proposal.findFirstOrThrow({ where: { area: "messaging" } });
    expect(p).toMatchObject({ status: "proposed", tentative: true });
    expect(await db.reviewItem.count({ where: { type: "other", reason: { contains: "Tentative proposal" } } })).toBe(1);
  });
});
