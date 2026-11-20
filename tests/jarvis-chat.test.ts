import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// A scripted model: first it asks for open approvals, then it answers from the result.
const replies: string[] = [];
vi.mock("@/lib/adapters/live/http", () => ({
  fetchJson: vi.fn(async (_label: string, _url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
    (globalThis as { lastSystem?: string }).lastSystem = body.messages[0].content;
    return { choices: [{ message: { content: replies.shift() ?? "{}" } }], usage: { cost: 0 } };
  }),
}));

import { jarvisAsk } from "@/lib/agent/chat";
import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import type { AgentContext } from "@/lib/agent/types";

describe("JARVIS conversation", () => {
  const sellerId = `jarvis-chat-${Date.now()}`;
  let conversationId = "";
  beforeEach(async () => {
    process.env.OPENROUTER_API_KEY = "test";
    const c = await db.assistantConversation.create({ data: { userEmail: "sa@example.com", title: "t", sellerId } });
    conversationId = c.id;
  });
  afterAll(async () => {
    await baseDb.agentAction.deleteMany({ where: { sellerId } });
    await db.assistantConversation.deleteMany({ where: { sellerId } });
  });
  const ctx = (): AgentContext => ({ sellerId, actor: "sa@example.com", origin: "chat", me: { superAdmin: true, superAdminClients: null, clients: [] }, conversationId, maxLevel: 0 });

  it("looks things up through the shared engine and answers from the result", async () => {
    replies.push(
      JSON.stringify({ tools: [{ tool: "open_approvals", args: { limit: 3 } }], answer: null }),
      JSON.stringify({ tools: [], answer: { title: "Waiting", summary: "Nothing is waiting.", facts: [], confirmed: ["0 open"], possible: [], unknown: [], recommendedAction: null, references: [] } }),
    );
    const r = await jarvisAsk(conversationId, "What is waiting?", ctx(), { clientName: "Test" });
    expect(r.answer.title).toBe("Waiting");
    expect(r.toolCalls.map((t) => t.tool)).toEqual(["open_approvals"]);
    expect(r.actionIds.length).toBe(1);
    const logged = await baseDb.agentAction.findMany({ where: { sellerId, conversationId } });
    expect(logged.some((a) => a.tool === "open_approvals" && a.status === "done")).toBe(true);
  });

  it("tells the model it only proposes changes, marks outside text and lists the tools", async () => {
    replies.push(JSON.stringify({ tools: [], answer: { title: "x", summary: "y", facts: [], confirmed: [], possible: [], unknown: [], recommendedAction: null, references: [] } }));
    await jarvisAsk(conversationId, "Research Acme", ctx(), { clientName: "Test" });
    const sys = (globalThis as { lastSystem?: string }).lastSystem ?? "";
    expect(sys).toMatch(/never run by you/);
    expect(sys).toMatch(/NEVER say it is done/);
    expect(sys).toMatch(/<untrusted_source>/);
    expect(sys).toMatch(/account_overview/);
  });

  it("refuses a tool that would change data, without running it", async () => {
    replies.push(
      JSON.stringify({ tools: [{ tool: "start_research", args: {} }], answer: null }),
      JSON.stringify({ tools: [], answer: { title: "Not yet", summary: "I can't do that yet.", facts: [], confirmed: [], possible: [], unknown: [], recommendedAction: null, references: [] } }),
    );
    const r = await jarvisAsk(conversationId, "Research Acme", ctx(), { clientName: "Test" });
    expect(r.toolCalls[0]).toMatchObject({ tool: "start_research", ok: false });
    expect(r.answer.title).toBe("Not yet");
  });
});
