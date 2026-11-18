import { describe, expect, it } from "vitest";
import { accountWhere } from "@/lib/accounts/filters";
import { FLOW_STEPS, flowStepWhere } from "@/lib/flow-steps";
import { closeHref, peekHref } from "@/components/peek/panel";
import { commandCenter } from "@/lib/command-center";
import { db } from "@/lib/db";

const and = (sp: Record<string, string>) => (accountWhere(sp).AND as object[]);

describe("Companies list filters behind Home's numbers", () => {
  it("?flow= adds the nested conditions of every step up to the one asked for", () => {
    expect(flowStepWhere("nope")).toBeNull();
    const q = flowStepWhere("researched") as { AND: unknown[] };
    expect(q.AND).toHaveLength(FLOW_STEPS.findIndex((s) => s.key === "researched") + 1);
    expect(and({ flow: "researched" })).toContainEqual(q);
    expect(and({ flow: "nope" })).toHaveLength(1);
  });

  it("?added= keeps one day's companies and ignores a malformed date", () => {
    const day = and({ added: "2026-11-17" }).find((c) => "createdAt" in c) as { createdAt: { gte: Date; lt: Date } };
    expect(day.createdAt.lt.getTime() - day.createdAt.gte.getTime()).toBe(86_400_000);
    expect(and({ added: "17/11/2026" }).some((c) => "createdAt" in c)).toBe(false);
  });

  it("?stage= still filters by buying stage", () => {
    expect(and({ stage: "ENGAGED" })).toContainEqual({ stage: "ENGAGED" });
  });

  it("each flow filter counts the same companies as Home's funnel", async () => {
    const cc = await commandCenter();
    for (const step of cc.funnel) {
      expect(await db.account.count({ where: accountWhere({ flow: step.key }) }), step.key).toBe(step.value);
    }
  });
});

describe("Home's side-panel links", () => {
  it("opens a decision with ?peek=d_<id> and keeps the page's other settings", () => {
    expect(peekHref("/", { wk: "30", ev: undefined }, "d", "abc")).toBe("/?wk=30&peek=d_abc");
    expect(closeHref("/", { wk: "30", peek: "d_abc" })).toBe("/?wk=30");
    expect(closeHref("/", { peek: "a_1" })).toBe("/");
  });
});
