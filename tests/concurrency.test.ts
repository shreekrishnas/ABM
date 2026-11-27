import { describe, expect, it } from "vitest";
import { mapLimit } from "@/lib/concurrency";

describe("mapLimit", () => {
  it("keeps the order and never runs more than the limit at once", async () => {
    let running = 0, peak = 0;
    const out = await mapLimit(Array.from({ length: 50 }, (_, i) => i), 4, async (n) => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, (n % 5) + 1));
      running--;
      return n * 2;
    });
    expect(out).toEqual(Array.from({ length: 50 }, (_, i) => i * 2));
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("handles an empty list", async () => {
    expect(await mapLimit([], 4, async (n: number) => n)).toEqual([]);
  });
});
