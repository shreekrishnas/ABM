import { describe, expect, it } from "vitest";
import { DECISION_KIND, asDecisionFilter, decisionKind, typesFor } from "@/lib/decisions";

describe("decision center", () => {
  it("puts emails and replies with approvals, rule and check problems with exceptions", () => {
    expect(decisionKind("draft_approval")).toBe("approval");
    expect(decisionKind("needs_human_reply")).toBe("approval");
    expect(decisionKind("proposed_rejection")).toBe("exception");
    expect(decisionKind("identity_conflict")).toBe("exception");
    expect(decisionKind("something_new")).toBe("exception");
  });

  it("splits every review type into exactly one filter", () => {
    const all = Object.keys(DECISION_KIND).sort();
    const ex = typesFor("exception") ?? [];
    const ap = typesFor("approval") ?? [];
    expect([...ex, ...ap].sort()).toEqual(all);
    expect(ex.some((t) => ap.includes(t))).toBe(false);
    expect(typesFor("all")).toBeUndefined();
  });

  it("reads the filter from the URL, defaulting to all", () => {
    expect(asDecisionFilter("exception")).toBe("exception");
    expect(asDecisionFilter("approval")).toBe("approval");
    expect(asDecisionFilter(undefined)).toBe("all");
    expect(asDecisionFilter("nonsense")).toBe("all");
  });
});
