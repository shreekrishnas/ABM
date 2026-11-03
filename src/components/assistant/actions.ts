"use server";

// Super Admin assistant. Every action re-checks Super Admin on the server; nothing here runs
// unless the Super Admin opens a conversation or submits a question.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, requireSuperAdmin } from "@/lib/me";
import { hit } from "@/lib/rate-limit";
import type { Answer, ToolCallRecord } from "@/lib/assistant/run";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  answer: Answer | null;
  toolCalls: { tool: string; args: unknown; ok: boolean; rows: number }[];
  ms: number | null;
  at: string;
}

async function me() {
  try {
    return await requireSuperAdmin();
  } catch {
    return null;
  }
}

const toMessage = (m: { id: string; role: string; content: string; evidence: Prisma.JsonValue; createdAt: Date }): ChatMessage => {
  const ev = m.evidence as { answer?: Answer; toolCalls?: ToolCallRecord[]; ms?: number } | null;
  return { id: m.id, role: m.role === "assistant" ? "assistant" : "user", content: m.content, answer: ev?.answer ?? null, toolCalls: (ev?.toolCalls ?? []).map((t) => ({ tool: t.tool, args: t.args, ok: t.ok, rows: t.rows })), ms: ev?.ms ?? null, at: m.createdAt.toISOString() };
};

export async function listAssistantConversations(): Promise<{ id: string; title: string; updatedAt: string }[] | null> {
  const u = await me();
  if (!u) return null;
  const rows = await db.assistantConversation.findMany({ where: { userEmail: u.email }, orderBy: { updatedAt: "desc" }, take: 30, select: { id: true, title: true, updatedAt: true } });
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export async function loadAssistantConversation(id: string): Promise<ChatMessage[] | null> {
  const u = await me();
  if (!u) return null;
  const c = await db.assistantConversation.findFirst({ where: { id, userEmail: u.email }, select: { id: true } });
  if (!c) return null;
  const rows = await db.assistantMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" }, take: 200 });
  return rows.map(toMessage);
}

export async function askAssistant(conversationId: string | null, question: string): Promise<{ ok: true; conversationId: string; message: ChatMessage } | { ok: false; error: string }> {
  const u = await me();
  if (!u) return { ok: false, error: "Only a Super Admin can use the assistant (switch to Super Admin first)." };
  const q = question.trim();
  if (!q) return { ok: false, error: "Type a question first." };
  if (q.length > 2000) return { ok: false, error: "Please keep the question under 2,000 characters." };
  const limited = await hit(`assistant:${u.email}`, 20, 600_000).catch(() => null);
  if (limited && !limited.ok) return { ok: false, error: "Too many questions in a short time — wait a few minutes." };
  let convo = conversationId ? await db.assistantConversation.findFirst({ where: { id: conversationId, userEmail: u.email } }) : null;
  if (conversationId && !convo) return { ok: false, error: "Conversation not found." };
  if (!convo) convo = await db.assistantConversation.create({ data: { userEmail: u.email, title: q.slice(0, 80) } });
  await db.assistantMessage.create({ data: { conversationId: convo.id, role: "user", content: q } });
  // Security audit: who asked, in which conversation — not what was asked.
  await audit(u.email, "assistant.question", { target: convo.id });
  const { ask, answerText } = await import("@/lib/assistant/run");
  try {
    const r = await ask(convo.id, q);
    const saved = await db.assistantMessage.create({ data: { conversationId: convo.id, role: "assistant", content: answerText(r.answer), evidence: { answer: r.answer, toolCalls: r.toolCalls, ms: r.ms } as unknown as Prisma.InputJsonValue } });
    await db.assistantConversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } });
    return { ok: true, conversationId: convo.id, message: toMessage(saved) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    const { recordError } = await import("@/lib/admin/errors");
    await recordError("assistant", e, `conversation ${convo.id}`);
    return { ok: false, error: /OPENROUTER_API_KEY/.test(msg) ? msg : `The assistant couldn't answer right now (${msg.slice(0, 160)}). Your question is saved; try again.` };
  }
}
