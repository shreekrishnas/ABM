"use server";

// JARVIS conversations. Super Admins only in this step; every call re-checks that the person
// covers the client, and conversations belong to one client and one person.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, coversClient, getMe } from "@/lib/me";
import { hit } from "@/lib/rate-limit";
import type { Answer } from "@/lib/assistant/run";
import type { AgentContext } from "@/lib/agent/types";

export interface JarvisMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  answer: Answer | null;
  tools: { tool: string; ok: boolean }[];
  ms: number | null;
  at: string;
}

const toMessage = (m: { id: string; role: string; content: string; evidence: Prisma.JsonValue; createdAt: Date }): JarvisMessage => {
  const ev = m.evidence as { answer?: Answer; toolCalls?: { tool: string; ok: boolean }[]; ms?: number } | null;
  return { id: m.id, role: m.role === "assistant" ? "assistant" : "user", content: m.content, answer: ev?.answer ?? null, tools: (ev?.toolCalls ?? []).map((t) => ({ tool: t.tool, ok: t.ok })), ms: ev?.ms ?? null, at: m.createdAt.toISOString() };
};

async function allowed(clientId: string) {
  await (await import("@/lib/integration-keys")).syncIntegrationEnv().catch(() => undefined);
  const me = await getMe();
  if (!me?.superAdmin || !coversClient(me, clientId)) return null;
  return me;
}

export async function loadJarvisConversation(clientId: string, id: string): Promise<JarvisMessage[] | null> {
  const me = await allowed(clientId);
  if (!me) return null;
  const c = await db.assistantConversation.findFirst({ where: { id, userEmail: me.email, sellerId: clientId }, select: { id: true } });
  if (!c) return null;
  const rows = await db.assistantMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" }, take: 200 });
  return rows.map(toMessage);
}

export async function askJarvis(input: { clientId: string; conversationId: string | null; accountId: string | null; question: string }): Promise<{ ok: true; conversationId: string; message: JarvisMessage } | { ok: false; error: string }> {
  const me = await allowed(input.clientId);
  if (!me) return { ok: false, error: "JARVIS is open to Super Admins covering this client (switch to Super Admin first)." };
  const q = input.question.trim();
  if (!q) return { ok: false, error: "Type a question first." };
  if (q.length > 2000) return { ok: false, error: "Please keep it under 2,000 characters." };
  const limited = await hit(`jarvis:${me.email}`, 20, 600_000).catch(() => null);
  if (limited && !limited.ok) return { ok: false, error: "Too many questions in a short time. Wait a few minutes." };
  const client = await db.client.findUnique({ where: { id: input.clientId }, select: { name: true } });
  if (!client) return { ok: false, error: "Client not found." };

  let convo = input.conversationId ? await db.assistantConversation.findFirst({ where: { id: input.conversationId, userEmail: me.email, sellerId: input.clientId } }) : null;
  if (input.conversationId && !convo) return { ok: false, error: "Conversation not found." };
  if (!convo) convo = await db.assistantConversation.create({ data: { userEmail: me.email, title: q.slice(0, 80), sellerId: input.clientId, accountId: input.accountId } });
  await db.assistantMessage.create({ data: { conversationId: convo.id, role: "user", content: q } });
  await audit(me.email, "jarvis.question", { target: convo.id, clientId: input.clientId });

  const ctx: AgentContext = { sellerId: input.clientId, actor: me.email, origin: "chat", me, conversationId: convo.id, maxLevel: 0 };
  const { jarvisAsk } = await import("@/lib/agent/chat");
  const { answerText } = await import("@/lib/assistant/run");
  try {
    const r = await jarvisAsk(convo.id, q, ctx, { clientName: client.name, accountId: input.accountId });
    const saved = await db.assistantMessage.create({
      data: { conversationId: convo.id, role: "assistant", content: answerText(r.answer), actionIds: r.actionIds, evidence: { answer: r.answer, toolCalls: r.toolCalls.map((t) => ({ tool: t.tool, args: t.args, ok: t.ok, rows: t.rows })), ms: r.ms, costUsd: r.costUsd } as unknown as Prisma.InputJsonValue },
    });
    await db.assistantConversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } });
    return { ok: true, conversationId: convo.id, message: toMessage(saved) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    const { recordError } = await import("@/lib/admin/errors");
    await recordError("jarvis", e, `conversation ${convo.id}`);
    const aiOff = /OPENROUTER_API_KEY|paused|credit|402|insufficient|quota/i.test(msg);
    return { ok: false, error: aiOff ? "JARVIS can't answer while the AI is paused, not connected or out of credits. Check Super Admin → System health." : `JARVIS couldn't answer right now (${msg.slice(0, 160)}). Your question is saved; try again.` };
  }
}
