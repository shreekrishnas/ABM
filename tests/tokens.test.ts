import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error plain ESM script without types
import { checkDesignCss, countArbitrary } from "../scripts/check-tokens.mjs";
import { METRICS } from "@/lib/metrics";
import { commandCenter } from "@/lib/command-center";

describe("design tokens (D12) and the metric registry (D9)", () => {
  it("design.css uses tokens only, and raw values elsewhere never go up", () => {
    expect(checkDesignCss()).toEqual([]);
    const base = JSON.parse(readFileSync(new URL("../scripts/token-baseline.json", import.meta.url), "utf8"));
    const now = countArbitrary();
    expect(now.hex).toBeLessThanOrEqual(base.hex);
    expect(now.px).toBeLessThanOrEqual(base.px);
  });

  it("every headline number takes its name and definition from the registry", async () => {
    const cc = await commandCenter();
    const labels = Object.values(METRICS).map((m) => m.label);
    for (const k of cc.kpis) {
      expect(labels).toContain(k.label);
      expect(Object.values(METRICS).find((m) => m.label === k.label)?.define).toBe(k.define);
    }
    expect(cc.kpis.map((k) => k.label)).toContain("Emails to approve");
  });
});
