import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { REGISTRY, factLabel } from "@/lib/agent/registry";
import { authorize, type PolicyDeps } from "@/lib/agent/policy";
import { idempotencyKey, runAgentTool } from "@/lib/agent/execute";
import { SYSTEM_ACTOR, type AgentContext, type AgentTool } from "@/lib/agent/types";
import { baseDb } from "@/lib/db-base";
import { withScope } from "@/lib/scope";
import { db } from "@/lib/db";

const allow: PolicyDeps = { aiPaused: async () => false, budgetOk: async () => true, suppressed: async () => false };
const admin = (clients: string[] | null = null) => ({ superAdmin: true, superAdminClients: clients, clients: [] });
const ctx = (over: Partial<AgentContext> = {}): AgentContext => ({ sellerId: "client-a", actor: "sa@example.com", origin: "chat", me: admin(), maxLevel: 0, ...over });
const t = (over: Partial<AgentTool> = {}): AgentTool => ({ name: "t", description: "d", input: z.object({}), level: 0, minRole: "viewer", reversible: false, run: async () => "ok", ...over });

describe("tool registry", () => {
  it("every tool has a name, an input schema, a level and a description", () => {
    const tools = Object.values(REGISTRY);
    expect(tools.length).toBeGreaterThanOrEqual(21);
    for (const tool of tools) {
      expect(tool.input.safeParse).toBeTypeOf("function");
      expect([0, 1, 2, 3]).toContain(tool.level);
      expect(tool.description.length).toBeGreaterThan(10);
    }
    expect(Object.values(REGISTRY).every((x) => x.level <= 1)).toBe(true);
    expect(REGISTRY.account_overview && REGISTRY.open_approvals && REGISTRY.recent_actions).toBeTruthy();
  });
});

describe("policy gate", () => {
  it("lets a Super Admin read for a client they cover", async () => {
    expect(await authorize(t(), {}, ctx(), allow)).toEqual({ ok: true });
  });
  it("refuses people who aren't Super Admin, and clients they don't cover", async () => {
    expect(await authorize(t(), {}, ctx({ me: { superAdmin: false, superAdminClients: [], clients: [{ id: "client-a", role: "owner" }] } }), allow)).toMatchObject({ ok: false, code: "not_allowed_user" });
    expect(await authorize(t(), {}, ctx({ me: admin(["client-b"]) }), allow)).toMatchObject({ ok: false, code: "other_client" });
  });
  it("refuses anything above read-only in this step", async () => {
    expect(await authorize(t({ level: 1 }), {}, ctx(), allow)).toMatchObject({ ok: false, code: "level" });
  });
  it("checks AI pause and budget before costly work, and suppression before contacting people", async () => {
    const costly = t({ level: 1, estimateCostUsd: () => 0.5 });
    expect(await authorize(costly, {}, ctx({ maxLevel: 1 }), { ...allow, aiPaused: async () => true })).toMatchObject({ code: "ai_paused" });
    expect(await authorize(costly, {}, ctx({ maxLevel: 1 }), { ...allow, budgetOk: async () => false })).toMatchObject({ code: "budget" });
    expect(await authorize(t({ level: 3, contactsPeople: true }), {}, ctx({ maxLevel: 3 }), { ...allow, suppressed: async () => true })).toMatchObject({ code: "suppressed" });
  });
});

describe("executor", () => {
  const sellerId = `jarvis-test-${Date.now()}`;
  afterAll(async () => { await baseDb.agentAction.deleteMany({ where: { sellerId } }); delete REGISTRY.__write_test; });

  it("logs a read with its real outcome", async () => {
    const out = await runAgentTool("open_approvals", { limit: 2 }, ctx({ sellerId }), "test read", allow);
    expect(out.status).toBe("done");
    const row = await baseDb.agentAction.findUnique({ where: { id: out.actionId! } });
    expect(row).toMatchObject({ status: "done", tool: "open_approvals", level: 0, sellerId });
  });

  it("refuses without logging, and reports bad input as failed", async () => {
    const before = await baseDb.agentAction.count({ where: { sellerId } });
    expect((await runAgentTool("open_approvals", {}, ctx({ sellerId, me: null }), "x", allow)).status).toBe("refused");
    expect((await runAgentTool("account_overview", { accountId: 5 }, ctx({ sellerId }), "x", allow)).status).toBe("failed");
    expect(await baseDb.agentAction.count({ where: { sellerId } })).toBe(before);
  });

  it("runs a changing action once for the same trigger, even if asked twice", async () => {
    let runs = 0;
    REGISTRY.__write_test = t({ name: "__write_test", level: 1, run: async () => ++runs });
    const c = ctx({ sellerId, actor: SYSTEM_ACTOR, origin: "event", maxLevel: 1, trigger: "evt-1" });
    const a = await runAgentTool("__write_test", {}, c, "test", allow);
    const b = await runAgentTool("__write_test", {}, c, "test", allow);
    expect(runs).toBe(1);
    expect(b).toMatchObject({ reused: true, actionId: a.actionId });
    expect(idempotencyKey(c, "x", { b: 1, a: 2 })).toBe(idempotencyKey(c, "x", { a: 2, b: 1 }));
  });

  it("keeps actions inside their client", async () => {
    await withScope({ ids: ["some-other-client"], active: "some-other-client", choices: [], all: false }, async () => {
      expect(await db.agentAction.count({ where: { sellerId } })).toBe(0);
    });
  });
});

describe("fact labels", () => {
  const now = new Date("2026-11-20");
  it("says which facts can be relied on", () => {
    expect(factLabel({ status: "verified", key: "industry", publishedAt: new Date("2026-10-01") }, now)).toBe("verified");
    expect(factLabel({ status: "probable", key: "industry", publishedAt: new Date("2026-10-01") }, now)).toBe("inferred");
    expect(factLabel({ status: "verified", key: "industry", publishedAt: new Date("2024-01-01") }, now)).toBe("stale");
    expect(factLabel({ status: "verified", key: "industry", publishedAt: new Date("2026-10-01"), supersededById: "x" }, now)).toBe("outdated");
  });
});
