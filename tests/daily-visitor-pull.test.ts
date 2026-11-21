import { afterEach, describe, expect, it, vi } from "vitest";

const g = globalThis as { seenSeller?: string | null };
vi.mock("@/lib/seller", async (orig) => ({
  ...(await orig<typeof import("@/lib/seller")>()),
  withSeller: vi.fn(async (id: string | null | undefined) => { g.seenSeller = id; throw new Error("Apollo said 401"); }),
}));

import { newContext } from "@/lib/pipeline/context";
import { dailyVisitorPull } from "@/lib/web/apollo-sync";
import { db } from "@/lib/db";

afterEach(() => { delete process.env.APOLLO_API_KEY; });

describe("daily website-visitor pull", () => {
  it("says why it didn't pull when the Apollo key is missing (never a silent null)", async () => {
    const r = await dailyVisitorPull(newContext());
    expect(r.skipped).toMatch(/Apollo key is not set/);
  });

  it("runs the pull inside the owning client and records an error instead of swallowing it", async () => {
    process.env.APOLLO_API_KEY = "k";
    const mode = process.env.ADAPTER_MODE;
    delete process.env.ADAPTER_MODE;
    const r = await dailyVisitorPull(newContext());
    if (mode !== undefined) process.env.ADAPTER_MODE = mode;
    expect(g.seenSeller).toBeTruthy();
    expect(r.error).toMatch(/401/);
    const ev = await db.pipelineEvent.findFirst({ where: { step: "apollo.visitors", outcome: "error" }, orderBy: { createdAt: "desc" } });
    expect(ev?.reason).toMatch(/Daily visitor pull failed.*401/);
  });
});
