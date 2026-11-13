// The brief behind an email: strongest fresh trigger, one proof point, one ask; never-say rules; helpers.
import { describe, expect, it } from "vitest";
import { buildDraftBrief, fixInstruction, isSellerSentence, pickLeadTrigger, type BriefFact } from "@/lib/outreach/brief";
import { MANCH } from "@/lib/seller/manch";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const fact = (id: string, key: string, extra: Partial<BriefFact> = {}): BriefFact => ({ id, key, claim: `${id} claim`, status: "probable", publishedAt: d("2026-10-01"), ...extra });

describe("lead trigger", () => {
  it("picks the most confident trigger, then the most recent, then verified", () => {
    const facts = [fact("a", "trigger", { confidence: 60 }), fact("b", "trigger", { confidence: 85 }), fact("c", "owner_function", { confidence: 99 })];
    expect(pickLeadTrigger(facts)?.id).toBe("b");
    const tie = [fact("old", "trigger", { confidence: 70, eventDate: d("2025-01-01") }), fact("new", "trigger", { confidence: 70, eventDate: d("2026-09-01") })];
    expect(pickLeadTrigger(tie)?.id).toBe("new");
  });
  it("no usable trigger, no lead", () => {
    expect(pickLeadTrigger([fact("x", "owner_function"), fact("y", "trigger", { status: "stale" })])).toBeNull();
  });
});

describe("the brief", () => {
  const writing = null;
  it("has why now with its source, at most two supporting facts, one proof point and one ask", () => {
    const facts = [fact("t1", "trigger", { confidence: 80, quote: "Acme will add 3,000 distributors", sourceUrl: "https://acme.in/press/x", status: "verified" }), fact("s1", "owner_function"), fact("s2", "partner_network"), fact("s3", "tooling")];
    const b = buildDraftBrief({ contact: { firstName: "Asha", title: "CIO", buyingRole: "decision_maker" }, facts, sp: MANCH, writing, useCase: MANCH.useCases[0].key, angle: null, proofPoint: "Onboarding from 7 days to 7 hours", pitch: MANCH.messaging.default })!;
    expect(b.whyNow).toMatchObject({ factId: "t1", url: "https://acme.in/press/x", verified: true, confidence: 80 });
    expect(b.support).toHaveLength(2);
    expect(b.whyUs.proofPoint).toBe("Onboarding from 7 days to 7 hours");
    expect(b.ask.length).toBeGreaterThan(5);
    expect(b.whyPerson.role).toBe("Decision maker");
    for (const banned of MANCH.bannedClaims) expect(b.never).toContain(banned);
    expect(b.never.join(" ")).toMatch(/visited our website/);
  });
  it("no trigger, no brief (no email)", () => {
    expect(buildDraftBrief({ contact: { firstName: null, title: null, buyingRole: "unknown" }, facts: [fact("x", "owner_function")], sp: MANCH, writing: null, useCase: null, angle: null, proofPoint: null, pitch: "" })).toBeNull();
  });
});

describe("our own sentences and fix instructions", () => {
  it("a sentence naming us or repeating our pitch is ours, not a claim about the prospect", () => {
    expect(isSellerSentence("Manch verifies PAN, GSTIN and bank accounts in real time.", "Manch", [])).toBe(true);
    expect(isSellerSentence("We cut partner onboarding from 7 days to 7 hours with validated data.", "Manch", ["Partner onboarding from 7 days to 7 hours with validated data"])).toBe(true);
    expect(isSellerSentence("Acme is adding 3,000 distributors in East India.", "Manch", ["Partner onboarding from 7 days to 7 hours"])).toBe(false);
  });
  it("a failed check becomes an instruction listing the facts it may cite", () => {
    const fix = fixInstruction('Claim without a cited fact: "Acme is growing fast"', [{ id: "f1", claim: "x" }, { id: "f2", claim: "y" }]);
    expect(fix).toMatch(/cite one of these fact ids \(f1, f2\)/);
    expect(fixInstruction("States a guess as fact — rephrase as a question", [])).toMatch(/ask it as a question/);
  });
});
