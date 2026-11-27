// Company profile: a funding round, board seat or result is kept only when its sentence is about this
// company. Production showed Vedanta Limited with funding rounds of Vedanta Biosciences (AXA, Gates
// Foundation, Pfizer): the page said "Vedanta" somewhere, which was enough to pass.
import { describe, expect, it } from "vitest";
import { namesThisCompany } from "@/lib/pipeline/gates";

describe("namesThisCompany", () => {
  it("rejects a namesake whose longer name starts with the same word", () => {
    const r = namesThisCompany("Vedanta Limited", "vedantalimited.com", "Vedanta Biosciences raised $106.5M in a Series E led by AXA IM Alts and The AMR Action Fund.");
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/different company \(Vedanta Biosciences\)/);
    expect(namesThisCompany("Vedanta Limited", "vedantalimited.com", "Vedanta Bio, a Cambridge biotech, closed its round.").pass).toBe(false);
  });

  it("keeps sentences about the company itself", () => {
    for (const t of [
      "Vedanta Ltd raised ₹3,000 crore through NCDs, the company said.",
      "Vedanta Raises $1 Billion From Global Investors",
      "Mining major Vedanta has appointed Priya Agarwal to its board.",
      "Shares of Vedanta rose 3% after the results.",
      "Vedanta's board approved the fund raise.",
      "The deal was announced on vedantalimited.com on Monday.",
    ]) expect(namesThisCompany("Vedanta Limited", "vedantalimited.com", t)).toMatchObject({ pass: true });
  });

  it("keeps multi-word names and rejects sentences that don't name the company", () => {
    expect(namesThisCompany("SwiftMove Logistics Pvt Ltd", null, "SwiftMove Logistics closed a $74M Series B led by Peak Growth Partners.").pass).toBe(true);
    expect(namesThisCompany("Hot Foods Ltd", null, "Another startup raised $5M from Sequoia.").pass).toBe(false);
  });
});
