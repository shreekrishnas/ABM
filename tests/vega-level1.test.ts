import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baseDb } from "@/lib/db-base";
import { runClientLoop, findCandidates } from "@/lib/agent/loop";
import { undoAgentAction } from "@/lib/agent/execute";
import { REGISTRY } from "@/lib/agent/registry";
import { withScope } from "@/lib/scope";

const sellerId = `l1-test-${Date.now()}`;
let accountId = "";

beforeAll(async () => {
  await baseDb.client.create({ data: { id: sellerId, name: "Level 1 test" } });
  const a = await baseDb.account.create({ data: { sellerId, name: "Acme Level1", domain: `acme-l1-${Date.now()}.example`, tier: "T1", priorityScore: 10 } });
  accountId = a.id;
  await baseDb.signal.create({ data: { accountId, type: "pricing_visit", detail: "pricing page", points: 5, source: "test" } });
});

afterAll(async () => {
  await baseDb.agentAction.deleteMany({ where: { sellerId } });
  await baseDb.agentSetting.deleteMany({ where: { sellerId } });
  await baseDb.account.deleteMany({ where: { sellerId } });
  await baseDb.client.deleteMany({ where: { id: sellerId } });
});

describe("Vega Level 1", () => {
  it("does nothing until it is switched on for the client", async () => {
    const r = await runClientLoop(sellerId);
    expect(r.skipped).toMatch(/off/);
    expect(await baseDb.agentAction.count({ where: { sellerId } })).toBe(0);
  });

  it("finds a re-score for a company with a new signal", async () => {
    const c = await withScope({ ids: [sellerId], active: sellerId, choices: [], all: false }, () => findCandidates());
    expect(c.some((x) => x.tool === "rescore" && x.input.accountId === accountId)).toBe(true);
  });

  it("only runs the actions that are allowed, once a day, and logs why", async () => {
    await baseDb.agentSetting.create({ data: { sellerId, enabled: true, allowedTools: ["rescore"], dailyCapUsd: 0 } });
    const first = await runClientLoop(sellerId);
    expect(first.ran.map((r) => `${r.tool}:${r.status}`)).toContain("rescore:done");
    expect(first.ran.every((r) => r.tool === "rescore")).toBe(true);
    const row = await baseDb.agentAction.findFirst({ where: { sellerId, tool: "rescore" } });
    expect(row).toMatchObject({ level: 1, actor: "jarvis@system", origin: "loop", status: "done", reversible: true });
    expect(row?.reason).toMatch(/new signal/);
    const second = await runClientLoop(sellerId);
    expect(second.ran.filter((r) => r.tool === "rescore")).toHaveLength(0);
  });

  it("keeps paid work within the daily limit", async () => {
    await baseDb.agentSetting.update({ where: { sellerId }, data: { allowedTools: ["refresh_research", "prepare_drafts"], dailyCapUsd: 0 } });
    const r = await runClientLoop(sellerId);
    expect(r.ran).toHaveLength(0);
  });

  it("undoes a re-score by putting the previous reading back, once", async () => {
    const row = await baseDb.agentAction.findFirstOrThrow({ where: { sellerId, tool: "rescore", status: "done" } });
    const u = await undoAgentAction(row.id, "sa@example.com");
    expect(u.ok).toBe(true);
    expect((await baseDb.account.findUniqueOrThrow({ where: { id: accountId } })).priorityScore).toBe(10);
    expect((await baseDb.agentAction.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("undone");
    expect(await baseDb.agentAction.count({ where: { sellerId, tool: "undo:rescore" } })).toBe(1);
    expect((await undoAgentAction(row.id, "sa@example.com")).ok).toBe(false);
  });

  it("is paused by the client switch", async () => {
    await baseDb.agentSetting.update({ where: { sellerId }, data: { paused: true } });
    expect((await runClientLoop(sellerId)).skipped).toMatch(/paused/);
  });

  it("registers Level 1 actions as internal-only: none contacts people", () => {
    const l1 = Object.values(REGISTRY).filter((t) => t.level === 1);
    expect(l1.map((t) => t.name).sort()).toEqual(["find_people", "follow_up_task", "prepare_drafts", "refresh_research", "rescore"]);
    expect(l1.every((t) => !t.contactsPeople)).toBe(true);
  });
});
