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
  if (!me) return { ok: false, error: "Vega is not available for your account." };
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
    return { ok: false, error: aiOff ? "Vega is not available right now." : "Vega couldn't answer right now. Your question is saved; try again." };
  }
}

/** Recent conversations with Vega for this client (the panel's history list). */
export async function listVegaConversations(clientId: string): Promise<{ id: string; title: string; updatedAt: string }[]> {
  const me = await allowed(clientId);
  if (!me) return [];
  const rows = await db.assistantConversation.findMany({ where: { userEmail: me.email, sellerId: clientId }, orderBy: { updatedAt: "desc" }, take: 12, select: { id: true, title: true, updatedAt: true } });
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

/**
 * "This week": counted straight from the records, no AI (works while AI is paused, costs nothing).
 * Covers the clients this Super Admin covers; platform-wide items only for those covering every client.
 */
export async function vegaThisWeek(input: { clientId: string; conversationId: string | null }): Promise<{ ok: true; conversationId: string; message: VegaMessage } | { ok: false; error: string }> {
  const me = await allowed(input.clientId);
  if (!me) return { ok: false, error: "Vega is not available for your account." };
  let convo = input.conversationId ? await db.assistantConversation.findFirst({ where: { id: input.conversationId, userEmail: me.email, sellerId: input.clientId } }) : null;
  if (input.conversationId && !convo) return { ok: false, error: "Conversation not found." };
  if (!convo) convo = await db.assistantConversation.create({ data: { userEmail: me.email, title: `This week (${new Date().toISOString().slice(0, 10)})`, sellerId: input.clientId } });
  const { weeklyDigest } = await import("@/lib/assistant/digest");
  const { answerText } = await import("@/lib/assistant/run");
  const started = Date.now();
  const answer = await weeklyDigest(new Date(), { clientIds: me.superAdminClients, platform: me.superAdminClients === null });
  await db.assistantMessage.create({ data: { conversationId: convo.id, role: "user", content: "This week" } });
  const saved = await db.assistantMessage.create({ data: { conversationId: convo.id, role: "assistant", content: answerText(answer), evidence: { answer, toolCalls: [], ms: Date.now() - started } as unknown as Prisma.InputJsonValue } });
  await db.assistantConversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } });
  await audit(me.email, "vega.digest", { target: convo.id, clientId: input.clientId });
  return { ok: true, conversationId: convo.id, message: toMessage(saved) };
}

/** Questions a person keeps for reuse (theirs only, up to 20). */
export async function listVegaSavedQuestions(clientId: string): Promise<{ id: string; text: string }[]> {
  const me = await allowed(clientId);
  if (!me) return [];
  return db.assistantSavedQuestion.findMany({ where: { userEmail: me.email }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, text: true } }).catch(() => []);
}

export async function saveVegaQuestion(clientId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const me = await allowed(clientId);
  if (!me) return { ok: false, error: "Not available for your account." };
  const t = text.trim().slice(0, 500);
  if (!t) return { ok: false, error: "Nothing to save" };
  if ((await db.assistantSavedQuestion.count({ where: { userEmail: me.email } })) >= 20) return { ok: false, error: "You can keep up to 20 saved questions; remove one first." };
  await db.assistantSavedQuestion.upsert({ where: { userEmail_text: { userEmail: me.email, text: t } }, create: { userEmail: me.email, text: t }, update: {} });
  return { ok: true };
}

export async function removeVegaSavedQuestion(clientId: string, id: string): Promise<void> {
  const me = await allowed(clientId);
  if (!me) return;
  await db.assistantSavedQuestion.deleteMany({ where: { id, userEmail: me.email } });
}

/**
 * The company behind the page the person is on, so Vega answers about it: a company page, a
 * person's page (their company) or an item opened in Approvals. Read within the client only;
 * anything else (or another client's record) gives no focus.
 */
export async function vegaFocus(clientId: string, path: string, pick: string | null, peek: string | null = null): Promise<{ accountId: string; accountName: string; from: "company" | "person" | "approval" } | null> {
  const me = await allowed(clientId);
  if (!me) return null;
  const { withScope } = await import("@/lib/scope");
  return withScope({ ids: [clientId], active: clientId, choices: [], all: false }, async () => {
    // A company or decision previewed in a side panel (?peek=a_<id> / d_<id>) counts as the page.
    const peekedCompany = peek?.startsWith("a_") ? peek.slice(2) : null;
    const peekedReview = peek?.startsWith("d_") ? peek.slice(2) : null;
    const company = peekedCompany ?? path.match(/^\/accounts\/([^/?#]+)$/)?.[1];
    if (company && company !== "coverage") {
      const a = await db.account.findFirst({ where: { id: decodeURIComponent(company) }, select: { id: true, name: true } });
      return a ? { accountId: a.id, accountName: a.name, from: "company" as const } : null;
    }
    const person = path.match(/^\/people\/([^/?#]+)$/)?.[1];
    if (person) {
      const c = await db.contact.findFirst({ where: { id: decodeURIComponent(person) }, select: { account: { select: { id: true, name: true } } } });
      return c?.account ? { accountId: c.account.id, accountName: c.account.name, from: "person" as const } : null;
    }
    const reviewId = peekedReview ?? (path === "/review" ? pick : null);
    if (reviewId) {
      const r = await db.reviewItem.findFirst({ where: { id: reviewId }, select: { account: { select: { id: true, name: true } }, contact: { select: { account: { select: { id: true, name: true } } } } } });
      const a = r?.account ?? r?.contact?.account;
      return a ? { accountId: a.id, accountName: a.name, from: "approval" as const } : null;
    }
    return null;
  });
}

const refresh = async () => (await import("next/cache")).revalidatePath("/vega");

/** Level 1 controls for one client. Every change is in the audit log. */
export async function saveVegaSettings(input: { clientId: string; enabled: boolean; paused: boolean; allowedTools: string[]; dailyCapUsd: number }): Promise<{ ok: boolean; message: string }> {
  const me = await allowed(input.clientId);
  if (!me) return { ok: false, message: "Not available for your account." };
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
  if (!me) return { ok: false, message: "Not available for your account." };
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
  if (!me) return { ok: false, message: "Not available for your account." };
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
  if (!me) return { ok: false, message: "Not available for your account.", status: "refused" };
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
