import { describe, expect, it } from "vitest";
import { fitClauses } from "@/lib/brain/rules";

describe("why-now text", () => {
  it("keeps whole reasons and never cuts one mid-sentence", () => {
    const a = "Acme selected an ERP partner (2026-09-10)";
    const b = "Acme plans to add 1,000 distributors this year (2026-09-10)";
    const c = "Asha Rao (Head of Procurement) replied on LinkedIn with Sender 1";
    expect(fitClauses(`${a}; and ${b}`, 300)).toBe(`${a}; and ${b}`);
    expect(fitClauses(`${a}; and ${b}; and ${c}`, a.length + b.length + 10)).toBe(`${a}; and ${b}`);
    expect(fitClauses("word ".repeat(100).trim(), 40).endsWith("…")).toBe(true);
    expect(fitClauses("word ".repeat(100).trim(), 40).length).toBeLessThanOrEqual(40);
  });
});

describe("why-now reasons for display", async () => {
  const { whyNowReasons, whyNowShort } = await import("@/lib/why-now");
  it("splits reasons, writes dates plainly and drops dangling dashes", () => {
    expect(whyNowReasons("acme selected an ERP partner (2026-09-10); and Asha replied on LinkedIn with Sender 1 —")).toEqual(["Acme selected an ERP partner (10 Sept)", "Asha replied on LinkedIn with Sender 1"]);
    expect(whyNowShort("a; and b; and c")).toEqual({ first: "A", more: 2 });
    expect(whyNowReasons(null)).toEqual([]);
  });
});
