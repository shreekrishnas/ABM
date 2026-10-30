import { describe, expect, it } from "vitest";
import { attention } from "@/lib/crm/opportunities";

const now = new Date("2026-10-30T12:00:00Z");
const deal = (o: Partial<Parameters<typeof attention>[0]>) => ({ stage: "proposal" as const, closeDate: new Date("2026-11-30"), ownerId: "u1", updatedAt: now, ...o });

describe("deals that need a person", () => {
  it("flags a passed close date, a missing one, a missing owner and a deal gone quiet", () => {
    expect(attention(deal({ closeDate: new Date("2026-10-29") }), now)).toMatch(/Close date passed/);
    expect(attention(deal({ closeDate: null }), now)).toBe("No close date set");
    expect(attention(deal({ ownerId: null }), now)).toBe("No owner");
    expect(attention(deal({ updatedAt: new Date("2026-10-01") }), now)).toBe("No change in 29 days");
    expect(attention(deal({}), now)).toBeNull();
  });
  it("closed deals never need attention", () => {
    expect(attention(deal({ stage: "won", closeDate: null }), now)).toBeNull();
    expect(attention(deal({ stage: "lost", ownerId: null }), now)).toBeNull();
  });
});
