import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeCompanyName, normalizeDomain, normalizePhone, phoneCountry, standardizeTitle, inferFunction } from "@/lib/pipeline/normalize";
import { accountEngagement, dataConfidence, personEngagement, researchPriority, scoreFit, stageFromEngagement, tierFor } from "@/lib/pipeline/scoring";
import {
  blockerSupported, bounceBreaker, companyMarks, complianceGate, decideReadiness, emailDomainStatus, evidenceGate, exclusionGate, factGuardrail, factStatus,
  entityGate, findContradictions, isStale, lawfulBasisFor, preSendGate, resolveContradiction,
} from "@/lib/pipeline/gates";
import { CONFIG } from "@/lib/config";
import { seller } from "@/lib/seller";
import { classifyTrigger, matchPersona, pickUseCase } from "@/lib/seller/fit";

const NOW = new Date("2026-10-01T00:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("normalize", () => {
  it("normalizes domains", () => {
    expect(normalizeDomain("https://www.Northwind-Analytics.example/")).toBe("northwind-analytics.example");
    expect(normalizeDomain("WWW.acme.co.uk/path?x=1")).toBe("acme.co.uk");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
  it("strips legal suffixes", () => {
    expect(normalizeCompanyName("Acme Holdings Pvt Ltd")).toBe("Acme Holdings");
    expect(normalizeCompanyName("Globex, Inc.")).toBe("Globex");
    expect(normalizeCompanyName("Co")).toBe("Co");
  });
  it("standardizes titles and infers function", () => {
    expect(standardizeTitle("Hd of Data")).toBe("Head of Data");
    expect(standardizeTitle("sr. data eng")).toBe("Senior Data Engineering");
    expect(standardizeTitle("vp marketing")).toBe("VP Marketing");
    expect(inferFunction("Head of Data Platform")).toBe("data");
    expect(inferFunction("CISO")).toBe("security");
  });
  it("validates email and phone formats", () => {
    expect(isValidEmail("sam@@northwind.example")).toBe(false);
    expect(isValidEmail("asha@northwind-analytics.example")).toBe(true);
    expect(isValidEmail("a..b@x.com")).toBe(false);
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("12")).toBeNull();
    expect(phoneCountry("+44 20 7946 0958")).toBe("GB");
    expect(phoneCountry("+353 1 234 5678")).toBe("IE");
  });
});

describe("scoring", () => {
  it("scores fit against the seller profile on known fields only", () => {
    const full = scoreFit({ industry: "fmcg", employees: 4000, country: "IN", technologies: ["SAP S/4HANA"] });
    expect(full.fit).toBeGreaterThanOrEqual(90);
    expect(full.useCases).toContain("distributor_onboarding");
    const partial = scoreFit({ industry: "beverages", employees: null, country: null });
    expect(partial.fit).toBe(100); // industry + partner network known, both full
    expect(partial.coverage).toBeCloseTo(1 / 4);
    expect(scoreFit({}).fit).toBeNull();
    // Outside Manch's verticals and small → below the fit floor.
    expect(scoreFit({ industry: "robotics research", employees: 150, country: "JP" }).fit!).toBeLessThan(40);
    // Same company in a secondary market scores lower than in India.
    expect(scoreFit({ industry: "fmcg", employees: 4000, country: "AE" }).fit!).toBeLessThan(scoreFit({ industry: "fmcg", employees: 4000, country: "IN" }).fit!);
    // Every component explains itself.
    expect(full.reasons.every((r) => / — /.test(r))).toBe(true);
  });

  it("tiers and priority", () => {
    expect(tierFor(85)).toBe("T1");
    expect(tierFor(65)).toBe("T2");
    expect(tierFor(45)).toBe("T3");
    // Low confidence raises priority at equal fit.
    expect(researchPriority(70, 0.2, 0).score).toBeGreaterThan(researchPriority(70, 0.9, 0).score);
    expect(researchPriority(10, 1, 0).priority).toBe("low");
  });
  it("data confidence weights statuses", () => {
    expect(dataConfidence(["verified", "verified"], 1)).toBe(1);
    expect(dataConfidence(["conflicting"], 1)).toBe(0);
    expect(dataConfidence([], 1)).toBe(0.2);
  });
  it("decays engagement and counts unattributed activity at reduced weight", () => {
    const fresh = { points: 50, occurredAt: NOW, attributed: true, anonymous: false };
    const old = { points: 50, occurredAt: ago(14), attributed: true, anonymous: false };
    const anon = { points: 20, occurredAt: NOW, attributed: false, anonymous: true };
    expect(accountEngagement([fresh], NOW)).toBe(50);
    expect(accountEngagement([old], NOW)).toBe(25);
    expect(accountEngagement([anon], NOW)).toBe(20 * CONFIG.engagement.unattributedWeight);
    expect(personEngagement([anon], NOW)).toBe(0);
  });
  it("buying stage only moves forward and never overrides terminal stages", () => {
    expect(stageFromEngagement("UNAWARE", 80)).toBe("MQA");
    expect(stageFromEngagement("ENGAGED", 5)).toBe("ENGAGED");
    expect(stageFromEngagement("CUSTOMER", 99)).toBe("CUSTOMER");
    expect(stageFromEngagement("WATCH", 15)).toBe("WATCH");
    expect(stageFromEngagement("WATCH", 40)).toBe("ENGAGED");
  });
});

describe("gates", () => {
  it("exclusions cover customers, competitors, partners, open opps and recent losses", () => {
    const base = { relationship: "prospect" as const, doNotContact: false, openOpportunity: false, lastLostAt: null, now: NOW };
    expect(exclusionGate(base).pass).toBe(true);
    expect(exclusionGate({ ...base, relationship: "customer" }).pass).toBe(false);
    expect(exclusionGate({ ...base, relationship: "partner" }).pass).toBe(false);
    expect(exclusionGate({ ...base, openOpportunity: true }).pass).toBe(false);
    expect(exclusionGate({ ...base, lastLostAt: ago(30) }).pass).toBe(false);
    expect(exclusionGate({ ...base, lastLostAt: ago(120) }).pass).toBe(true);
  });
  it("freshness and email-domain identity", () => {
    expect(isStale(ago(121), "title", NOW)).toBe(true);
    expect(isStale(ago(100), "title", NOW)).toBe(false);
    expect(emailDomainStatus("asha@acme.com", "acme.com").status).toBe("probable");
    expect(emailDomainStatus("asha@gmail.com", "acme.com").status).toBe("conflicting");
    expect(emailDomainStatus("asha@eu.acme.com", "acme.com").status).toBe("probable");
  });
  it("evidence gate requires source, type, date and refuses mock in live mode", () => {
    const e = { key: "trigger", claim: "x", sourceUrl: "https://a.com", sourceType: "news", publishedAt: ago(1) };
    expect(evidenceGate(e, "mock").pass).toBe(true);
    expect(evidenceGate({ ...e, sourceUrl: null }, "mock").pass).toBe(false);
    expect(evidenceGate({ ...e, publishedAt: null }, "mock").pass).toBe(false);
    expect(evidenceGate({ ...e, sourceType: "mock" }, "live").pass).toBe(false);
  });
  it("fact status: official or two independent sources verify; one is probable; old is stale", () => {
    const ev = (id: string, url: string, type: string, d: number) => ({ id, key: "trigger", value: null, sourceType: type, sourceUrl: url, publishedAt: ago(d) });
    expect(factStatus([ev("1", "https://acme.com/press", "official", 5)], "trigger", NOW)).toBe("verified");
    expect(factStatus([ev("1", "https://a.com/x", "news", 5)], "trigger", NOW)).toBe("probable");
    expect(factStatus([ev("1", "https://a.com/x", "news", 5), ev("2", "https://b.com/y", "press", 5)], "trigger", NOW)).toBe("verified");
    expect(factStatus([ev("1", "https://a.com/x", "news", 5), ev("2", "https://a.com/y", "news", 5)], "trigger", NOW)).toBe("probable");
    expect(factStatus([ev("1", "https://a.com/x", "official", 200)], "trigger", NOW)).toBe("stale");
  });
  it("contradictions resolve by source strength", () => {
    const items = [
      { id: "a", key: "size", value: "40", sourceType: "news", sourceUrl: "https://n.com", publishedAt: ago(10) },
      { id: "b", key: "size", value: "85", sourceType: "official", sourceUrl: "https://acme.com", publishedAt: ago(5) },
    ];
    expect(findContradictions(items)).toHaveLength(1);
    expect(resolveContradiction(items).winnerId).toBe("b");
    expect(resolveContradiction([items[0], { ...items[0], id: "c", value: "120" }]).winnerId).toBeNull();
  });
  it("a source must name the company", () => {
    expect(companyMarks("Akums Drugs& Pharmaceuticals", "akums.in")).toEqual(["akums"]);
    expect(companyMarks("MANKIND PHARMA", "mankindpharma.com")).toEqual(["mankind", "mankindpharma"]);
    const page = (title: string, text: string) => ({ url: "https://news.example.com/a", title, text });
    expect(entityGate("Torrent Pharmaceuticals", "torrentpharma.com", page("Pharma news", "Torrent Pharma plans to cut its field force")).pass).toBe(true);
    expect(entityGate("Aurobindo Pharma", "aurobindo.com", page("Sector round-up", "Cipla and Lupin report results")).pass).toBe(false);
  });
  it("a blocker's own sentence must say what the blocker means (real cases)", () => {
    const ok = (kind: string, quote: string, name: string, domain: string) => blockerSupported(kind, quote, name, domain);
    // Aurobindo buying companies is not Aurobindo being acquired.
    expect(ok("acquired", "Aurobindo Pharma completes acquisition of US-based Lannett Company - The HinduBusinessLine", "Aurobindo Pharma", "aurobindo.com")).toBe(false);
    expect(ok("acquired", "Aurobindo has completed its $250m acquisition of Lannett in the US following a recent approval from the FTC.", "Aurobindo Pharma", "aurobindo.com")).toBe(false);
    expect(ok("acquired", "Aurobindo arm Apitoria acquires A1 Biochem Labs LLC in $15.25M cash deal", "Aurobindo Pharma", "aurobindo.com")).toBe(false);
    // Mankind absorbing its own subsidiary is not Mankind being acquired.
    expect(ok("acquired", "Mankind Pharma will take over the entire business of Bharat Serums and Vaccines Limited (BSVL) through a voluntary liquidation of the subsidiary", "MANKIND PHARMA", "mankindpharma.com")).toBe(false);
    // Torrent trimming its sales force while merging JB Chemicals is not distress layoffs.
    expect(ok("layoffs", "Torrent Pharmaceuticals is reducing its medical representative force by 400 positions as it integrates JB Chemicals & Pharmaceuticals.", "Torrent Pharmaceuticals", "torrentpharma.com")).toBe(false);
    // Akums' tax demand and Mankind's analyst rating were never blockers.
    expect(ok("bankrupt", "However, a ₹156 crore tax demand looms.", "Akums Drugs& Pharmaceuticals", "akums.in")).toBe(false);
    expect(ok("competitor_signed", "Nandan Kulkarni from Bernstein maintained a Sell rating on Mankind Pharma Ltd.", "MANKIND PHARMA", "mankindpharma.com")).toBe(false);
    // The real thing still counts.
    expect(ok("acquired", "MegaCorp acquires Delta Foods for $2 billion", "Delta Foods", "deltafoods.com")).toBe(true);
    expect(ok("acquired", "Delta Foods has been acquired by MegaCorp", "Delta Foods", "deltafoods.com")).toBe(true);
    expect(ok("bankrupt", "The NCLT admitted an insolvency petition against Delta Foods", "Delta Foods", "deltafoods.com")).toBe(true);
    expect(ok("layoffs", "Delta Foods announced layoffs of 12% of its workforce amid falling sales", "Delta Foods", "deltafoods.com")).toBe(true);
  });
  it("a person's email on the company's other domain is fine", () => {
    expect(emailDomainStatus("sumeet@akums.net", "akums.in").status).toBe("probable");
    expect(emailDomainStatus("ramesh@aurobindousa.com", "aurobindo.com").status).toBe("probable");
    expect(emailDomainStatus("x@othercorp.com", "akums.in").status).toBe("conflicting");
  });
  it("readiness rules in order", () => {
    const person = { identity: { email: "verified" as const, title: "verified" as const, company: "verified" as const }, buyingRole: "decision_maker" as const, lawfulBasis: "x", emailDeliverable: true, suppressed: false };
    const strong = [{ status: "verified" as const, publishedAt: ago(10) }];
    // A blocker counts only when confirmed: two independent sites, or one official source.
    expect(decideReadiness({ negatives: [{ kind: "acquired", publishedAt: ago(10), sourceUrl: "https://a.com/x", sourceType: "news" }, { kind: "acquired", publishedAt: ago(9), sourceUrl: "https://b.org/y", sourceType: "news" }], triggers: strong, followupUsed: false }, person, NOW).outcome).toBe("disqualified");
    expect(decideReadiness({ negatives: [{ kind: "bankrupt", publishedAt: ago(10), sourceUrl: "https://acme.com/ir", sourceType: "official" }], triggers: strong, followupUsed: false }, person, NOW).outcome).toBe("disqualified");
    const rumour = decideReadiness({ negatives: [{ kind: "bankrupt", publishedAt: ago(10), sourceUrl: "https://a.com/x", sourceType: "news" }], triggers: strong, followupUsed: false }, person, NOW);
    expect(rumour.outcome).toBe("human_review");
    expect(rumour.blocker).toBe(true);
    // Two articles on the same site are one source.
    expect(decideReadiness({ negatives: [{ kind: "acquired", publishedAt: ago(10), sourceUrl: "https://a.com/x", sourceType: "news" }, { kind: "acquired", publishedAt: ago(9), sourceUrl: "https://www.a.com/y", sourceType: "news" }], triggers: strong, followupUsed: false }, person, NOW).outcome).toBe("human_review");
    expect(decideReadiness({ negatives: [{ kind: "layoffs", publishedAt: ago(10), sourceUrl: "https://a.com/x", sourceType: "news" }, { kind: "layoffs", publishedAt: ago(9), sourceUrl: "https://b.org/y", sourceType: "news" }], triggers: strong, followupUsed: false }, person, NOW).outcome).toBe("watch");
    expect(decideReadiness({ negatives: [{ kind: "layoffs", publishedAt: ago(10), sourceUrl: "https://a.com/x", sourceType: "news" }], triggers: strong, followupUsed: false }, person, NOW).outcome).toBe("ready");
    expect(decideReadiness({ negatives: [{ kind: "layoffs", publishedAt: ago(200) }], triggers: strong, followupUsed: false }, person, NOW).outcome).toBe("ready");
    expect(decideReadiness({ negatives: [], triggers: [], followupUsed: false }, person, NOW).outcome).toBe("targeted_re_research");
    expect(decideReadiness({ negatives: [], triggers: [], followupUsed: true }, person, NOW).outcome).toBe("watch");
    expect(decideReadiness({ negatives: [], triggers: [{ status: "probable", publishedAt: ago(5) }, { status: "probable", publishedAt: ago(6) }], followupUsed: false }, person, NOW).outcome).toBe("ready");
    expect(decideReadiness({ negatives: [], triggers: [{ status: "verified", publishedAt: ago(120) }], followupUsed: true }, person, NOW).outcome).toBe("watch");
    expect(decideReadiness({ negatives: [], triggers: strong, followupUsed: false }, { ...person, identity: { ...person.identity, title: "conflicting" } }, NOW).outcome).toBe("human_review");
    expect(decideReadiness({ negatives: [], triggers: strong, followupUsed: false }, { ...person, lawfulBasis: null }, NOW).outcome).toBe("human_review");
    expect(decideReadiness({ negatives: [], triggers: strong, followupUsed: false }, { ...person, buyingRole: "influencer" }, NOW).outcome).toBe("human_review");
  });
  it("fact guardrail rejects uncited, unknown, unusable and stale claims", () => {
    const facts = [
      { id: "f1", status: "verified" as const, publishedAt: ago(10), key: "trigger" },
      { id: "f2", status: "conflicting" as const, publishedAt: ago(10), key: "size" },
      { id: "f3", status: "verified" as const, publishedAt: ago(100), key: "trigger" },
    ];
    expect(factGuardrail([{ text: "ok", factIds: ["f1"] }], facts, NOW).pass).toBe(true);
    expect(factGuardrail([], facts, NOW).pass).toBe(false);
    expect(factGuardrail([{ text: "x", factIds: [] }], facts, NOW).pass).toBe(false);
    expect(factGuardrail([{ text: "x", factIds: ["nope"] }], facts, NOW).pass).toBe(false);
    expect(factGuardrail([{ text: "x", factIds: ["f2"] }], facts, NOW).pass).toBe(false);
    expect(factGuardrail([{ text: "x", factIds: ["f3"] }], facts, NOW).pass).toBe(false);
  });
  it("compliance, lawful basis, pre-send and bounce breaker", () => {
    expect(complianceGate(`Hi\n${seller().sender.address}\nReply unsubscribe`).pass).toBe(true);
    expect(complianceGate("Hi").pass).toBe(false);
    expect(lawfulBasisFor("DE")).toBe(CONFIG.lawfulBasis.EU);
    expect(lawfulBasisFor("US")).toContain("CAN-SPAM");
    expect(lawfulBasisFor("JP")).toBeNull();
    const ok = { suppressed: false, lawfulBasis: "x", mailboxSentToday: 0, mailboxCap: 40, globalSentToday: 0, contactPaused: false, breakerTripped: false };
    expect(preSendGate(ok).pass).toBe(true);
    expect(preSendGate({ ...ok, mailboxSentToday: 40 }).pass).toBe(false);
    expect(preSendGate({ ...ok, suppressed: true }).pass).toBe(false);
    expect(bounceBreaker(10, 5).pass).toBe(true); // too few sends to judge
    expect(bounceBreaker(100, 3).pass).toBe(false);
    expect(bounceBreaker(100, 2).pass).toBe(true);
  });
});

describe("seller intelligence (Manch)", () => {
  const sp = seller();
  it("maps titles to Manch buying roles", () => {
    expect(matchPersona("Head of Master Data Governance", sp)?.role).toBe("champion");
    expect(matchPersona("Chief Procurement Officer", sp)?.role).toBe("decision_maker");
    expect(matchPersona("CIO", sp)?.role).toBe("decision_maker");
    expect(matchPersona("SAP CoE Lead", sp)?.role).toBe("champion");
    expect(matchPersona("Head of Compliance", sp)?.role).toBe("influencer");
    expect(matchPersona("Financial Controller", sp)?.role).toBe("budget_owner");
    expect(matchPersona("Graphic Designer", sp)).toBeNull();
  });
  it("classifies buying triggers and picks the use case to lead with", () => {
    expect(classifyTrigger("Kaveri Foods announced its SAP S/4HANA migration programme", sp)?.key).toBe("erp_migration");
    expect(classifyTrigger("plans to add 3,000 distributors to expand rural reach", sp)?.key).toBe("channel_expansion");
    expect(pickUseCase("quick commerce", "workforce_scale", sp)).toBe("gig_onboarding");
    expect(pickUseCase("fmcg", null, sp)).toBe("distributor_onboarding");
    expect(pickUseCase("nbfc", "compliance_mandate", sp)).toBe("regulated_kyc");
  });
});


describe("AI answers: lengths are trimmed, never a failure", () => {
  it("a quote over 400 characters is shortened at a word and the fact is kept", async () => {
    const { OpenRouterLLM } = await import("@/lib/adapters/live/openrouter");
    const llm = new OpenRouterLLM("test-key");
    const long = "Aurobindo Pharma said it will expand its distributor network across India " + "and add new partners in every state ".repeat(14);
    (llm as unknown as { call: () => Promise<string> }).call = async () => JSON.stringify({ items: [{ page: 0, claim: "Aurobindo Pharma is expanding its distributor network", quote: long, kind: null }] });
    const out = await llm.extractEvidence([{ url: "https://news.example.com/a", sourceType: "news", publishedAt: new Date(), title: "Aurobindo", text: long }], "trigger");
    expect(out).toHaveLength(1);
    expect(out[0].quote!.length).toBeLessThanOrEqual(400);
    expect(long.startsWith(out[0].quote!)).toBe(true);
  });
  it("bad news that isn't a real blocker is dropped", async () => {
    const { OpenRouterLLM } = await import("@/lib/adapters/live/openrouter");
    const llm = new OpenRouterLLM("test-key");
    (llm as unknown as { call: () => Promise<string> }).call = async () => JSON.stringify({ items: [{ page: 0, claim: "Akums Drugs faces a tax demand", quote: "However, a ₹156 crore tax demand looms.", kind: "not_a_blocker" }] });
    const out = await llm.extractEvidence([{ url: "https://news.example.com/a", sourceType: "news", publishedAt: new Date(), title: "Akums", text: "However, a ₹156 crore tax demand looms." }], "negative");
    expect(out).toHaveLength(0);
  });
});
