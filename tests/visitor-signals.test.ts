import { describe, expect, it } from "vitest";
import { MIN_VISITOR_SIGNALS, visitorSignals } from "@/lib/discover/visitors";

const v = (day: string, topic = "general", url = "https://x.com/", title: string | null = null) => ({ occurredAt: new Date(`${day}T10:00:00Z`), topic, url, title });

describe("website visitors only go to approval with 2+ buying signals", () => {
  it("a single visit is just a visitor", () => {
    expect(visitorSignals([v("2026-11-10")]).length).toBeLessThan(MIN_VISITOR_SIGNALS);
  });
  it("two visits on the same day are still just one visit's worth", () => {
    expect(visitorSignals([v("2026-11-10"), v("2026-11-10")]).length).toBeLessThan(MIN_VISITOR_SIGNALS);
  });
  it("coming back on another day and looking at pricing counts as two signals", () => {
    const s = visitorSignals([v("2026-11-10", "pricing", "https://x.com/pricing"), v("2026-11-14")]);
    expect(s.length).toBeGreaterThanOrEqual(MIN_VISITOR_SIGNALS);
    expect(s.join(" ")).toMatch(/2 different days/);
    expect(s.join(" ")).toMatch(/pricing/);
  });
  it("a pricing visit plus matching news counts as two signals", () => {
    const s = visitorSignals([v("2026-11-10", "pricing", "https://x.com/pricing")], [{ title: "Acme announces SAP S/4HANA migration" }]);
    expect(s).toHaveLength(2);
  });
});
