import { describe, expect, it } from "vitest";
import { MANCH } from "@/lib/seller/manch";
import { BRAIN_SECTIONS, readSection, readiness, starterPack, writeSection } from "@/lib/seller/brain";
import { validatePack } from "@/lib/seller/schema";

describe("Account Brain editor", () => {
  it("reading then writing every section leaves a valid pack unchanged in meaning", () => {
    let p = structuredClone(MANCH);
    for (const s of BRAIN_SECTIONS) p = writeSection(p, s.key, readSection(p, s.key));
    expect(validatePack(p)).toEqual([]);
    expect(p.competitors).toEqual(MANCH.competitors);
    expect(p.triggers.map((t) => t.key)).toEqual(MANCH.triggers.map((t) => t.key));
    expect(p.triggers[0].useCase).toBe(MANCH.triggers[0].useCase);
  });

  it("add, replace and remove competitors", () => {
    const items = readSection(MANCH, "competitors");
    items[0] = { name: "NewCo", category: "MDM", angle: "Faster to go live" };
    items.push({ name: "Another", category: "Workflow", angle: "Built for partners" });
    items.splice(1, 1);
    const p = writeSection(MANCH, "competitors", items);
    expect(p.competitors[0].name).toBe("NewCo");
    expect(p.competitors.at(-1)?.name).toBe("Another");
    expect(p.competitors).toHaveLength(MANCH.competitors.length);
  });

  it("removing a use case drops every reference to it, so the pack stays valid", () => {
    const keep = readSection(MANCH, "useCases").slice(1);
    const p = writeSection(MANCH, "useCases", keep);
    const gone = MANCH.useCases[0].key;
    expect(p.useCases.some((u) => u.key === gone)).toBe(false);
    expect(p.icp.industries.some((i) => i.useCases.includes(gone))).toBe(false);
    expect(p.triggers.some((t) => t.useCase === gone)).toBe(false);
    expect(gone in p.messaging.byUseCase).toBe(false);
    expect(validatePack(p).filter((x) => x.includes(gone))).toEqual([]);
  });

  it("a new account starts as a draft and becomes ready once the essentials are filled", () => {
    let p = starterPack("acme", "Acme");
    expect(readiness(p).ready).toBe(false);
    p = writeSection(p, "overview", [{ name: "Acme", website: "https://acme.example", hq: "Pune, India", founded: 2015, summary: "Logistics software", positioning: "Fastest to deploy", tone: ["Plain and short"], cta: "Worth a call?", defaultMessage: "Acme runs your fleet.", address: "1 MG Road, Pune" }]);
    p = writeSection(p, "targeting", [{ countries: ["in"], secondaryCountries: [], minEmployees: 200, midEmployees: 500, sweetSpot: 1000 }]);
    p = writeSection(p, "useCases", [{ name: "Fleet tracking", pains: "No live view of trucks", outcome: "Live tracking in a week" }]);
    p = writeSection(p, "industries", [{ label: "Logistics", tier: "primary", match: ["logistics", "freight"], useCases: ["Fleet tracking"] }]);
    p = writeSection(p, "personas", [{ role: "decision_maker", titles: ["Head of Operations"], functions: ["operations"], why: "Owns delivery times" }]);
    p = writeSection(p, "triggers", [{ label: "New warehouse", keywords: ["new warehouse"], why: "More trucks to track" }]);
    expect(validatePack(p)).toEqual([]);
    expect(readiness(p)).toEqual({ ready: true, missing: [] });
    expect(p.icp.geos.primary).toEqual(["IN"]);
    expect(p.icp.industries[0].useCases).toEqual(["fleet_tracking"]);
  });
});
