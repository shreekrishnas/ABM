import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const replies: string[] = [];
vi.mock("@/lib/adapters/live/http", () => ({
  fetchJson: vi.fn(async () => ({ choices: [{ message: { content: replies.shift() ?? "{}" } }], usage: { cost: 0 } })),
}));

import { vegaAsk } from "@/lib/agent/chat";
import { confirmProposal, dismissProposal, proposeAction, outcomeText } from "@/lib/agent/proposals";
import { baseDb } from "@/lib/db-base";
import { withScope } from "@/lib/scope";
import type { AgentContext } from "@/lib/agent/types";
import type { PolicyDeps } from "@/lib/agent/policy";

const sellerId = `chatact-${Date.now()}`;
let accountId = "";
let conversationId = "";
const me = { superAdmin: true, superAdminClients: null, clients: [] };
const allow: PolicyDeps = { aiPaused: async () => false, budgetOk: async () => true };
const scope = <T,>(fn: () => Promise<T>) => withScope({ ids: [sellerId], active: sellerId, choices: [], all: false }, fn);
const ctx = (): AgentContext => ({ sellerId, actor: "sa@example.com", origin: "chat", me, conversationId, maxLevel: 0 });
const answer = (title: string) => JSON.stringify({ tools: [], answer: { title, summary: "s", facts: [], confirmed: [], possible: [], unknown: [], recommendedAction: null, references: [] } });

beforeAll(async () => {
  process.env.OPENROUTER_API_KEY = "test";
  await baseDb.client.create({ data: { id: sellerId, name: "Chat acts test" } });
  accountId = (await baseDb.account.create({ data: { sellerId, name: "Gamma Co", domain: `gamma-${Date.now()}.example`, tier: "T1", pipelineStatus: "done" } })).id;
});
beforeEach(async () => { conversationId = (await baseDb.assistantConversation.create({ data: { userEmail: "sa@example.com", title: "t", sellerId } })).id; });
afterAll(async () => {
  await baseDb.agentAction.deleteMany({ where: { sellerId } });
  await baseDb.assistantConversation.deleteMany({ where: { sellerId } });
  await baseDb.account.deleteMany({ where: { sellerId } });
  await baseDb.client.deleteMany({ where: { id: sellerId } });
});

describe("Vega chat that acts after you confirm", () => {
  it("turns 'research Gamma' into a proposal and runs nothing", async () => {
    replies.push(JSON.stringify({ tools: [{ tool: "refresh_research", args: { accountId } }], answer: null }), answer("Proposed"));
    const r = await scope(() => vegaAsk(conversationId, "Research Gamma again", ctx(), { clientName: "T" }));
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ tool: "refresh_research", status: "awaiting_approval", reversible: true });
    expect(r.proposals[0].summary).toMatch(/Research again Gamma Co/);
    expect((await baseDb.account.findUniqueOrThrow({ where: { id: accountId } })).pipelineStatus).toBe("done");
  });

  it("runs a confirmed proposal once, with an honest 'queued' outcome", async () => {
    const p = await scope(() => proposeAction("refresh_research", { accountId }, ctx(), "test", allow));
    if (!p.ok) throw new Error(p.message);
    const first = await scope(() => confirmProposal(p.proposal.id, { sellerId, actor: "sa@example.com", me }, allow));
    expect(first).toMatchObject({ ok: true });
    expect(first.message).toMatch(/^Queued/);
    expect((await baseDb.account.findUniqueOrThrow({ where: { id: accountId } })).pipelineStatus).toBe("queued");
    const again = await scope(() => confirmProposal(p.proposal.id, { sellerId, actor: "sa@example.com", me }, allow));
    expect(again.message).toBe("Already done");
    await baseDb.account.update({ where: { id: accountId }, data: { pipelineStatus: "done" } });
  });

  it("never runs a dismissed or expired proposal", async () => {
    const p = await scope(() => proposeAction("rescore", { accountId }, ctx(), "test", allow));
    if (!p.ok) throw new Error(p.message);
    expect(await dismissProposal(p.proposal.id, sellerId)).toBe(true);
    expect((await scope(() => confirmProposal(p.proposal.id, { sellerId, actor: "sa@example.com", me }, allow))).ok).toBe(false);
    const q = await scope(() => proposeAction("rescore", { accountId }, ctx(), "test", allow));
    if (!q.ok) throw new Error(q.message);
    const later = new Date(Date.now() + 25 * 3_600_000);
    expect((await scope(() => confirmProposal(q.proposal.id, { sellerId, actor: "sa@example.com", me }, allow, later))).message).toMatch(/more than a day old/);
  });

  it("refuses up front what could not run: over budget, someone who isn't a Super Admin, event-only reactions", async () => {
    expect(await scope(() => proposeAction("refresh_research", { accountId }, ctx(), "t", { ...allow, budgetOk: async () => false }))).toMatchObject({ ok: false });
    expect(await scope(() => proposeAction("rescore", { accountId }, { ...ctx(), me: { superAdmin: false, superAdminClients: [], clients: [] } }, "t", allow))).toMatchObject({ ok: false });
    expect(await scope(() => proposeAction("opt_out_everywhere", { accountId, contactId: accountId, why: "x" }, ctx(), "t", allow))).toMatchObject({ ok: false });
  });

  it("reports each email's own result when approving", () => {
    const t = outcomeText("approve_drafts", "done", { approved: 1, of: 2, results: [{ who: "A (X)", ok: true, message: "ok" }, { who: "B (Y)", ok: false, message: "Draft is no longer pending" }] });
    expect(t).toMatch(/Approved 1 of 2/);
    expect(t).toMatch(/B \(Y\): Draft is no longer pending/);
  });
});
