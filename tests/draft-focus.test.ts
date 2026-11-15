// Emails pitch what the company's signals converge on, read like a person wrote them, and a
// draft still waiting for approval is rewritten when the research changes.
import { describe, expect, it } from "vitest";
import { signalFocus } from "@/lib/outreach/focus";
import { specificityGate } from "@/lib/pipeline/gates";
import { createMockAdapters } from "@/lib/adapters/mock";
import { MANCH } from "@/lib/seller/manch";
import type { DraftInput } from "@/lib/adapters/types";

describe("what the signals converge on", () => {
  it("several pieces pointing at one use case make it the focus, from any mix of sources", () => {
    const f = signalFocus([
      { source: "fact", text: "Test Pharma announced its SAP S/4HANA migration programme" },
      { source: "signal", text: "Hiring: SAP S/4HANA functional lead" },
      { source: "website", text: "Vendor & supplier onboarding vendor onboarding" },
    ], MANCH);
    expect(f).toMatchObject({ useCase: "vendor_onboarding", strong: true, votes: 3 });
    expect(f!.sources.sort()).toEqual(["fact", "signal", "website"]);
    expect(f!.why.length).toBe(3);
  });

  it("one piece of evidence is noted but doesn't change the pitch; unrelated evidence gives nothing", () => {
    const one = signalFocus([{ source: "fact", text: "Test Foods plans to add 3,000 distributors to expand rural reach" }], MANCH);
    expect(one).toMatchObject({ useCase: "distributor_onboarding", strong: false });
    expect(signalFocus([{ source: "fact", text: "Test Co opened a new office cafeteria" }], MANCH)).toBeNull();
  });

  it("the use case with the most agreeing evidence wins", () => {
    const f = signalFocus([
      { source: "fact", text: "Test Co announced an SAP S/4HANA migration" },
      { source: "fact", text: "Test Co will expand distribution to 3,000 new distributors" },
      { source: "signal", text: "Hiring: Head of distributor onboarding for rural reach" },
    ], MANCH);
    expect(f?.useCase).toBe("distributor_onboarding");
  });
});

describe("template phrasing is rejected", () => {
  it("catches the old automated openers", () => {
    expect(specificityGate("I saw that Test Pharma announced its SAP S/4HANA migration programme.", "Test Pharma", ["Test Pharma announced its SAP S/4HANA migration programme"]).pass).toBe(false);
    expect(specificityGate("Test Pharma announced its SAP S/4HANA migration. It looks like your team is hiring.", "Test Pharma", ["Test Pharma announced its SAP S/4HANA migration programme"]).pass).toBe(false);
    expect(specificityGate("Test Pharma announced its SAP S/4HANA migration programme last month.", "Test Pharma", ["Test Pharma announced its SAP S/4HANA migration programme"]).pass).toBe(true);
  });
});

describe("the Test client's stand-in writer", () => {
  it("follows the real shape: their news first, one pain, the focus with proof, one question, a real subject", async () => {
    const m = createMockAdapters();
    const input = {
      firstName: "Asha", title: "Head of Procurement", company: "Test Pharma", stepOrder: 1, instruction: "first email",
      facts: [{ id: "f1", key: "trigger", claim: "Test Pharma announced its SAP S/4HANA migration programme" }],
      sender: { name: "Team Test", company: "Test Co", address: "Bengaluru" },
      seller: { name: "Test Co", pitch: "We verify vendor data at entry.", cta: "Open to a 20-minute call next week?", useCase: "vendor_onboarding" },
      angle: null,
      brief: {
        whyPerson: { name: "Asha", title: "Head of Procurement", role: "Decision maker", cares: [] },
        whyNow: { factId: "f1", claim: "Test Pharma announced its SAP S/4HANA migration programme", quote: null, url: null, publisher: null, date: "2026-10-01", confidence: 80, verified: true },
        support: [], focus: { useCase: "Vendor & supplier onboarding", why: ["Research: SAP S/4HANA migration", "Signal: hiring SAP lead"] },
        whyUs: { useCase: "Vendor & supplier onboarding", pain: "Vendor master duplicates, failed payments from bad bank details", capability: "First-time-right vendor master with PAN/GSTIN/bank verified at entry", proofPoint: "A large bottler cut onboarding from 7 days to 7 hours.", pitch: "We verify vendor data at entry." },
        ask: "Open to a 20-minute call next week?", never: [],
      },
    } as unknown as DraftInput;
    const d = await m.llm.draft(input, 1);
    const body = d.body.split("\n\nTeam Test")[0];
    expect(body).not.toMatch(/I saw that|It looks like|something your team is dealing with/);
    expect(body.split("\n").filter(Boolean)[1]).toMatch(/^Test Pharma announced/);
    expect((body.match(/\?/g) ?? []).length).toBe(1);
    expect(body).toMatch(/7 days to 7 hours/);
    expect(d.subject).not.toMatch(/\+/);
    expect(d.claims[0].factIds).toEqual(["f1"]);
  });
});
