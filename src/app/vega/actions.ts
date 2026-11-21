"use server";

// Vega conversations. Super Admins only in this step; every call re-checks that the person
// covers the client, and conversations belong to one client and one person.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, coversClient, getMe } from "@/lib/me";
import { hit } from "@/lib/rate-limit";
import type { Answer } from "@/lib/assistant/run";
import type { AgentContext } from "@/lib/agent/types";
import type { Proposal } from "@/lib/agent/proposals";

export interface VegaMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  answer: Answer | null;
  tools: { tool: string; ok: boolean }[];
  /** Changes Vega proposed in this answer, with their live status. */
  proposals: Proposal[];
  ms: number | null;
  at: string;
}

const toMessage = (m: { id: string; role: string; content: string; evidence: Prisma.JsonValue; createdAt: Date }, live: Map<string, Proposal> = new Map()): VegaMessage => {
  const ev = m.evidence as { answer?: Answer; toolCalls?: { tool: string; ok: boolean }[]; ms?: number; proposals?: Proposal[] } | null;
  return { id: m.id, role: m.role === "assistant" ? "assistant" : "user", content: m.content, answer: ev?.answer ?? null, tools: (ev?.toolCalls ?? []).map((t) => ({ tool: t.tool, ok: t.ok })), proposals: (ev?.proposals ?? []).map((p) => live.get(p.id) ?? p), ms: ev?.ms ?? null, at: m.createdAt.toISOString() };
};

async function allowed(clientId: string) {
  await (await import("@/lib/integration-keys")).syncIntegrationEnv().catch(() => undefined);
  const me = await getMe();
  if (!me?.superAdmin || !coversClient(me, clientId)) return null;
  return me;
}

export async function loadVegaConversation(clientId: string, id: string): Promise<VegaMessage[] | null> {
  const me = await allowed(clientId);
  if (!me) return null;
  const c = await db.assistantConversation.findFirst({ where: { id, userEmail: me.email, sellerId: clientId }, select: { id: true } });
  if (!c) return null;
  const rows = await db.assistantMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" }, take: 200 });
  const { proposalsByIds } = await import("@/lib/agent/proposals");
  const ids = rows.flatMap((r) => ((r.evidence as { proposals?: Proposal[] } | null)?.proposals ?? []).map((p) => p.id));
  const live = new Map((await proposalsByIds(ids)).map((p) => [p.id, p]));
  return rows.map((r) => toMessage(r, live));
}

export async function askVega(input: { clientId: string; conversationId: string | null; accountId: string | null; question: string }): Promise<{ ok: true; conversationId: string; message: VegaMessage } | { ok: false; error: string }> {
  const me = await allowed(input.clientId);
  if (!me) return { ok: false, error: "Vega is open to Super Admins covering this client (switch to Super Admin first)." };
  const q = input.question.trim();
  if (!q) return { ok: false, error: "Type a question first." };
  if (q.length > 2000) return { ok: false, error: "Please keep it under 2,000 characters." };
  const limited = await hit(`vega:${me.email}`, 20, 600_000).catch(() => null);
  if (limited && !limited.ok) return { ok: false, error: "Too many questions in a short time. Wait a few minutes." };
  const client = await db.client.findUnique({ where: { id: input.clientId }, select: { name: true } });
  if (!client) return { ok: false, error: "Client not found." };

  let convo = input.conversationId ? await db.assistantConversation.findFirst({ where: { id: input.conversationId, userEmail: me.email, sellerId: input.clientId } }) : null;
  if (input.conversationId && !convo) return { ok: false, error: "Conversation not found." };
  if (!convo) convo = await db.assistantConversation.create({ data: { userEmail: me.email, title: q.slice(0, 80), sellerId: input.clientId, accountId: input.accountId } });
  await db.assistantMessage.create({ data: { conversationId: convo.id, role: "user", content: q } });
  await audit(me.email, "vega.question", { target: convo.id, clientId: input.clientId });

  const ctx: AgentContext = { sellerId: input.clientId, actor: me.email, origin: "chat", me, conversationId: convo.id, maxLevel: 0 };
  const { vegaAsk } = await import("@/lib/agent/chat");
  const { answerText } = await import("@/lib/assistant/run");
  try {
    const r = await vegaAsk(convo.id, q, ctx, { clientName: client.name, accountId: input.accountId });
    const saved = await db.assistantMessage.create({
      data: { conversationId: convo.id, role: "assistant", content: answerText(r.answer), actionIds: r.actionIds, evidence: { answer: r.answer, toolCalls: r.toolCalls.map((t) => ({ tool: t.tool, args: t.args, ok: t.ok, rows: t.rows })), ms: r.ms, costUsd: r.costUsd, proposals: r.proposals } as unknown as Prisma.InputJsonValue },
    });
    await db.assistantConversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } });
    return { ok: true, conversationId: convo.id, message: toMessage(saved) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    const { recordError } = await import("@/lib/admin/errors");
    await recordError("vega", e, `conversation ${convo.id}`);
    const aiOff = /OPENROUTER_API_KEY|paused|credit|402|insufficient|quota/i.test(msg);
    return { ok: false, error: aiOff ? "Vega can't answer while the AI is paused, not connected or out of credits. Check Super Admin → System health." : `Vega couldn't answer right now (${msg.slice(0, 160)}). Your question is saved; try again.` };
  }
}

const refresh = async () => (await import("next/cache")).revalidatePath("/vega");

/** Level 1 controls for one client. Every change is in the audit log. */
export async function saveVegaSettings(input: { clientId: string; enabled: boolean; paused: boolean; allowedTools: string[]; dailyCapUsd: number }): Promise<{ ok: boolean; message: string }> {
  const me = await allowed(input.clientId);
  if (!me) return { ok: false, message: "Super Admins covering this client only." };
  const { L1_TOOLS } = await import("@/lib/agent/loop");
  const { L2_OPTIONAL } = await import("@/lib/agent/events");
  const tools = input.allowedTools.filter((t) => (L1_TOOLS as readonly string[]).includes(t) || (L2_OPTIONAL as readonly string[]).includes(t));
  const cap = Math.max(0, Math.min(50, Number(input.dailyCapUsd) || 0));
  const before = await db.agentSetting.findUnique({ where: { sellerId: input.clientId } });
  const after = { enabled: input.enabled, paused: input.paused, allowedTools: tools, dailyCapUsd: cap };
  await db.agentSetting.upsert({ where: { sellerId: input.clientId }, create: { sellerId: input.clientId, ...after }, update: after });
  await audit(me.email, "vega.settings", { target: input.clientId, clientId: input.clientId, before: before ? { enabled: before.enabled, paused: before.paused, allowedTools: before.allowedTools, dailyCapUsd: before.dailyCapUsd } : null, after });
  await refresh();
  return { ok: true, message: input.enabled ? (input.paused ? "Saved. Vega is paused." : "Saved. Vega will do the allowed work on its own for this client.") : "Saved. Vega won't act on its own." };
}

/** Run one Level 1 pass now for this client (same rules and limits as the scheduled run). */
export async function runVegaNow(clientId: string): Promise<{ ok: boolean; message: string }> {
  const me = await allowed(clientId);
  if (!me) return { ok: false, message: "Super Admins covering this client only." };
  const { runClientLoop } = await import("@/lib/agent/loop");
  const r = await runClientLoop(clientId);
  await audit(me.email, "vega.run_now", { target: clientId, clientId });
  await refresh();
  if (r.skipped) return { ok: false, message: r.skipped };
  const done = r.ran.filter((x) => x.status === "done").length;
  return { ok: true, message: r.ran.length ? `Did ${done} thing${done === 1 ? "" : "s"}${r.ran.length > done ? `; ${r.ran.length - done} didn't go through` : ""}. $${r.capLeftUsd.toFixed(2)} of today's limit left.` : "Nothing needed doing right now." };
}

export async function undoVegaAction(clientId: string, actionId: string): Promise<{ ok: boolean; message: string }> {
  const me = await allowed(clientId);
  if (!me) return { ok: false, message: "Super Admins covering this client only." };
  const row = await db.agentAction.findFirst({ where: { id: actionId, sellerId: clientId }, select: { id: true } });
  if (!row) return { ok: false, message: "Action not found." };
  const { undoAgentAction } = await import("@/lib/agent/execute");
  const r = await undoAgentAction(actionId, me.email);
  if (r.ok) await audit(me.email, "vega.undo", { target: actionId, clientId });
  await refresh();
  return r;
}

/**
 * Level 3: approve the emails the person ticked. Vega only prepared the list; each draft goes
 * through the normal approval path on its own (still pending, evidence still current, compliance
 * footer), so one failing item never approves or blocks the others. At most 25 at a time.
 */
// Manual approvals happen in Approvals (/review), the one workspace for every decision; Vega's
// list links there instead of approving from its own panel.

/** The person confirms a change Vega proposed in chat. Everything is checked again now. */
export async function confirmVegaProposal(clientId: string, proposalId: string): Promise<{ ok: boolean; message: string; status: string }> {
  const me = await allowed(clientId);
  if (!me) return { ok: false, message: "Super Admins covering this client only.", status: "refused" };
  const { confirmProposal } = await import("@/lib/agent/proposals");
  const { withScope } = await import("@/lib/scope");
  const r = await withScope({ ids: [clientId], active: clientId, choices: [], all: false }, () => confirmProposal(proposalId, { sellerId: clientId, actor: me.email, me }));
  await audit(me.email, "vega.confirm", { target: proposalId, clientId, after: { status: r.status } });
  await refresh();
  return r;
}

export async function dismissVegaProposal(clientId: string, proposalId: string): Promise<{ ok: boolean }> {
  const me = await allowed(clientId);
  if (!me) return { ok: false };
  const { dismissProposal } = await import("@/lib/agent/proposals");
  const ok = await dismissProposal(proposalId, clientId);
  if (ok) await audit(me.email, "vega.dismiss", { target: proposalId, clientId });
  return { ok };
}
