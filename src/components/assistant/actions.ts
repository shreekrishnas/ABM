"use server";

// Super Admin assistant. Every action re-checks Super Admin on the server; nothing here runs
// unless the Super Admin opens a conversation or submits a question.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, requireFullSuperAdmin } from "@/lib/me";
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
    return await requireFullSuperAdmin();
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
    const aiOff = /OPENROUTER_API_KEY|paused|credit|402|insufficient|quota/i.test(msg);
    return { ok: false, error: aiOff ? "The assistant can't answer questions while the AI is paused or out of credits. Top up OpenRouter and resume AI under Super Admin → System health. Meanwhile, \"This week\" gives a summary straight from the records." : `The assistant couldn't answer right now (${msg.slice(0, 160)}). Your question is saved; try again.` };
  }
}

/** Browser-side errors in the assistant, kept in the error log (Super Admin only). */
export async function reportAssistantClientError(message: string, stack: string): Promise<void> {
  const u = await me();
  if (!u) return;
  const { recordError } = await import("@/lib/admin/errors");
  await recordError("assistant.client", new Error(message.slice(0, 500)), stack.slice(0, 1500));
}

export async function listSavedQuestions(): Promise<{ id: string; text: string }[]> {
  const u = await me();
  if (!u) return [];
  return db.assistantSavedQuestion.findMany({ where: { userEmail: u.email }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, text: true } }).catch(() => []);
}

export async function saveQuestion(text: string): Promise<{ ok: boolean; error?: string }> {
  const u = await me();
  if (!u) return { ok: false, error: "Super Admin only" };
  const t = text.trim().slice(0, 500);
  if (!t) return { ok: false, error: "Nothing to save" };
  const n = await db.assistantSavedQuestion.count({ where: { userEmail: u.email } });
  if (n >= 20) return { ok: false, error: "You can keep up to 20 saved questions; remove one first." };
  await db.assistantSavedQuestion.upsert({ where: { userEmail_text: { userEmail: u.email, text: t } }, create: { userEmail: u.email, text: t }, update: {} });
  return { ok: true };
}

export async function removeSavedQuestion(id: string): Promise<void> {
  const u = await me();
  if (!u) return;
  await db.assistantSavedQuestion.deleteMany({ where: { id, userEmail: u.email } });
}

/** "This week": a digest counted straight from the records (no AI), saved into the conversation. */
export async function weeklyDigestMessage(conversationId: string | null): Promise<{ ok: true; conversationId: string; message: ChatMessage } | { ok: false; error: string }> {
  const u = await me();
  if (!u) return { ok: false, error: "Only a Super Admin can use the assistant (switch to Super Admin first)." };
  let convo = conversationId ? await db.assistantConversation.findFirst({ where: { id: conversationId, userEmail: u.email } }) : null;
  if (!convo) convo = await db.assistantConversation.create({ data: { userEmail: u.email, title: `This week (${new Date().toISOString().slice(0, 10)})` } });
  const { weeklyDigest } = await import("@/lib/assistant/digest");
  const { answerText } = await import("@/lib/assistant/run");
  const started = Date.now();
  const answer = await weeklyDigest();
  await db.assistantMessage.create({ data: { conversationId: convo.id, role: "user", content: "This week" } });
  const saved = await db.assistantMessage.create({ data: { conversationId: convo.id, role: "assistant", content: answerText(answer), evidence: { answer, toolCalls: [], ms: Date.now() - started } as unknown as Prisma.InputJsonValue } });
  await db.assistantConversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } });
  return { ok: true, conversationId: convo.id, message: toMessage(saved) };
}
