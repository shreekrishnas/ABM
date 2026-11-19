import { describe, expect, it } from "vitest";
import { humanize, personStage } from "@/lib/labels";

describe("humanize", () => {
  it("uses the known word for common codes", () => {
    expect(humanize("c_level")).toBe("C-level");
    expect(humanize("decision_maker")).toBe("Decision maker");
    expect(humanize("email_open")).toBe("Email opened");
    expect(humanize("mock-provider")).toBe("Sample data");
  });
  it("spaces and capitalises anything else, and leaves empty values empty", () => {
    expect(humanize("pending_review")).toBe("Pending review");
    expect(humanize("PROPOSED_REJECTION")).toBe("Proposed rejection");
    expect(humanize(null)).toBeUndefined();
    expect(humanize("")).toBeUndefined();
  });
});

describe("person stage tile", () => {
  it("prefers the journey stage, then says Email only once an email went out", () => {
    expect(personStage("Replied", 3)).toBe("Replied");
    expect(personStage(null, 1)).toBe("Email only");
    expect(personStage(null, 0)).toBe("Not contacted yet");
  });
});
