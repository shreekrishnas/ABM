"use server";

// Server actions used by the UI. Every input is validated with zod; every
// mutation revalidates the pages that show it.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Papa from "papaparse";
import { z } from "zod";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runAccount, runBatch, tick, processIntent } from "@/lib/pipeline/orchestrator";
import { newContext } from "@/lib/pipeline/context";
import { acknowledgeHandoff, recordOutcome, recordReply, recordSignal, s13Handoff, sendApproved, stopAccountAutomation } from "@/lib/pipeline/stages/engagement";
import { eraseContact } from "@/lib/pipeline/gdpr";

export type ActionState = { ok: boolean; message: string } | null;

const refresh = (...paths: string[]) => {
  for (const p of ["/", ...paths]) revalidatePath(p);
};

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

// ── Pipeline ──

export async function runAccountAction(accountId: string, fromStage?: number): Promise<ActionState> {
  const r = await runAccount(accountId, { fromStage });
  refresh("/accounts", `/accounts/${accountId}`, "/pipeline", "/review");
  return { ok: r.status === "done", message: `${r.status === "done" ? "Done" : r.status === "blocked" ? "Stopped" : r.status === "skipped" ? "Skipped" : "Error"}: ${r.reason}` };
}

export async function runAllAction(): Promise<ActionState> {
  const accounts = await db.account.findMany({ where: { mergedIntoId: null, pipelineStage: { lt: 11 }, pipelineStatus: { in: ["idle", "error"] } }, select: { id: true } });
  const res = await runBatch(accounts.map((a) => a.id));
  refresh("/accounts", "/pipeline", "/review");
  const done = res.filter((r) => r.status === "done").length;
  return { ok: true, message: `Ran ${res.length} account(s): ${done} reached drafting, ${res.length - done} stopped at a gate` };
}

export async function tickAction(): Promise<ActionState> {
  const ctx = newContext();
  const t = await tick(ctx);
  const intent = await processIntent(ctx);
  refresh("/outreach", "/pipeline", "/review", "/handoffs", "/crm/tasks");
  return { ok: true, message: `Sent ${t.sent.sent} (held ${t.sent.held}) · ${t.sequences.drafts} new drafts · ${t.sequences.tasks} rep tasks · ${t.watchlist} watchlist re-checks · ${intent.length} intent re-runs · ${t.escalated} escalations` };
}

export async function sendApprovedAction(): Promise<ActionState> {
  const r = await sendApproved();
  refresh("/outreach", "/review");
  return { ok: true, message: `Sent ${r.sent}, held ${r.held}${r.reasons.length ? ` — ${r.reasons.slice(0, 2).join("; ")}` : ""}` };
}

// ── Review ──

export async function reviewDraftAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = z.object({ draftId: z.string(), decision: z.enum(["approve", "reject"]), subject: z.string().min(1).max(200), body: z.string().min(1).max(5000), note: z.string().max(500).optional() }).safeParse({
    draftId: str(fd, "draftId"), decision: str(fd, "decision"), subject: str(fd, "subject"), body: str(fd, "body"), note: str(fd, "note"),
  });
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Invalid input" };
  const d = await db.draft.findUnique({ where: { id: p.data.draftId } });
  if (!d || d.status !== "pending_review") return { ok: false, message: "Draft is no longer pending" };
  // Browsers submit textarea line breaks as CRLF; compare normalized text.
  const norm = (t: string) => t.replace(/\r\n?/g, "\n").trim();
  p.data.body = norm(p.data.body);
  p.data.subject = norm(p.data.subject);
  const edited = norm(d.body) !== p.data.body || norm(d.subject) !== p.data.subject;
  if (edited && p.data.decision === "approve") {
    // Edited drafts must still carry the compliance footer.
    const { complianceGate } = await import("@/lib/pipeline/gates");
    const g = complianceGate(p.data.body);
    if (!g.pass) return { ok: false, message: `Can't approve: ${g.reason}` };
  }
  await db.draft.update({
    where: { id: d.id },
    data: {
      status: p.data.decision === "approve" ? "approved" : "rejected", subject: p.data.subject, body: p.data.body, reviewedAt: new Date(),
      reviewerNote: [edited ? "Edited by reviewer" : null, p.data.note].filter(Boolean).join(" · ") || null,
    },
  });
  await db.reviewItem.updateMany({ where: { draftId: d.id, status: "open" }, data: { status: "resolved", resolution: p.data.decision === "approve" ? (edited ? "approved with edits" : "approved") : "rejected", resolvedAt: new Date() } });
  refresh("/review", "/outreach");
  return { ok: true, message: p.data.decision === "approve" ? "Approved — it will send on the next run" : "Rejected — it will never be sent" };
}

export async function resolveReviewAction(id: string, resolution: "resolved" | "dismissed", note?: string): Promise<ActionState> {
  await db.reviewItem.update({ where: { id }, data: { status: resolution, resolution: note ?? resolution, resolvedAt: new Date() } });
  refresh("/review");
  return { ok: true, message: resolution === "resolved" ? "Marked resolved" : "Dismissed" };
}

/** Human decision on an identity conflict: confirm the person (fields become verified) or drop them. */
export async function resolveIdentityAction(reviewId: string, decision: "confirm" | "drop"): Promise<ActionState> {
  const r = await db.reviewItem.findUnique({ where: { id: reviewId } });
  if (!r?.contactId) return { ok: false, message: "Review item has no contact" };
  if (decision === "confirm") {
    await db.fieldState.updateMany({ where: { contactId: r.contactId, field: { in: ["title", "company", "email"] }, status: { in: ["conflicting", "stale", "unknown"] } }, data: { status: "verified", source: "human_review" } });
    await db.contact.update({ where: { id: r.contactId }, data: { identityConfidence: 1 } });
  } else {
    await db.contact.update({ where: { id: r.contactId }, data: { state: "do_not_contact" } });
  }
  await db.reviewItem.update({ where: { id: reviewId }, data: { status: "resolved", resolution: decision === "confirm" ? "Identity confirmed by reviewer" : "Contact dropped", resolvedAt: new Date() } });
  if (r.accountId && decision === "confirm") {
    await db.account.update({ where: { id: r.accountId }, data: { pipelineStatus: "idle" } });
  }
  refresh("/review", r.accountId ? `/accounts/${r.accountId}` : "/accounts");
  return { ok: true, message: decision === "confirm" ? "Confirmed — re-run the account from buying group to use this person" : "Contact dropped" };
}

// ── Signals & replies ──

const SIGNAL_TYPES = ["email_open", "email_click", "email_reply", "site_visit", "pricing_visit", "intent_surge", "job_change", "event_attended", "content_download"] as const;

export async function recordSignalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = z.object({ accountId: z.string().min(1), contactId: z.string().optional(), type: z.enum(SIGNAL_TYPES), detail: z.string().max(200).optional() }).safeParse({
    accountId: str(fd, "accountId"), contactId: str(fd, "contactId"), type: str(fd, "type"), detail: str(fd, "detail"),
  });
  if (!p.success) return { ok: false, message: "Choose an account and a signal type" };
  const a = await recordSignal({ ...p.data, source: "manual" });
  refresh("/signals", `/accounts/${p.data.accountId}`, "/handoffs");
  return { ok: true, message: `Recorded. ${a.name} is now ${a.stage} (score ${a.engagementScore})` };
}

export async function recordReplyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = z.object({ contactId: z.string().min(1), body: z.string().min(2).max(5000) }).safeParse({ contactId: str(fd, "contactId"), body: str(fd, "body") });
  if (!p.success) return { ok: false, message: "Choose a contact and paste the reply" };
  const cls = await recordReply(p.data.contactId, p.data.body);
  refresh("/outreach", "/review", "/handoffs", "/signals");
  return { ok: true, message: `Classified as ${cls.replace("_", " ")} and routed` };
}

// ── Handoffs ──

export async function ackHandoffAction(id: string): Promise<ActionState> {
  await acknowledgeHandoff(id);
  refresh("/handoffs");
  return { ok: true, message: "Acknowledged" };
}

export async function manualHandoffAction(accountId: string): Promise<ActionState> {
  const a = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  await s13Handoff(a, "manual");
  refresh("/handoffs", `/accounts/${accountId}`);
  return { ok: true, message: "Handed off to the account owner" };
}

// ── CRM ──

export async function createAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const name = str(fd, "name");
  if (!name) return { ok: false, message: "Company name is required" };
  const res = await ingestRows([{ company: name, domain: str(fd, "domain"), industry: str(fd, "industry"), employees: str(fd, "employees"), country: str(fd, "country") }], { source: "manual" });
  if (res.rejected) return { ok: false, message: res.errors[0]?.error ?? "Could not create" };
  const owner = str(fd, "ownerId");
  if (owner) await db.account.update({ where: { id: res.accountIds[0] }, data: { ownerId: owner } });
  refresh("/accounts");
  redirect(`/accounts/${res.accountIds[0]}`);
}

export async function updateAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = z.object({
    id: z.string(), relationship: z.enum(["prospect", "customer", "competitor", "partner"]), ownerId: z.string().optional(),
    tier: z.enum(["T1", "T2", "T3", "auto"]).optional(), doNotContact: z.boolean(),
  }).safeParse({ id: str(fd, "id"), relationship: str(fd, "relationship"), ownerId: str(fd, "ownerId"), tier: str(fd, "tier"), doNotContact: fd.get("doNotContact") === "on" });
  if (!p.success) return { ok: false, message: "Invalid input" };
  await db.account.update({
    where: { id: p.data.id },
    data: {
      relationship: p.data.relationship, ownerId: p.data.ownerId ?? null, doNotContact: p.data.doNotContact,
      ...(p.data.tier && p.data.tier !== "auto" ? { tier: p.data.tier } : {}),
      ...(p.data.relationship === "customer" ? { stage: "CUSTOMER" } : {}),
    },
  });
  if (p.data.relationship !== "prospect" || p.data.doNotContact) await stopAccountAutomation(p.data.id, p.data.doNotContact ? "marked do-not-contact" : `relationship changed to ${p.data.relationship}`);
  refresh(`/accounts/${p.data.id}`, "/accounts");
  return { ok: true, message: "Saved" };
}

export async function createContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const accountId = str(fd, "accountId");
  const fullName = str(fd, "fullName");
  if (!accountId || !fullName) return { ok: false, message: "Account and name are required" };
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, message: "Account not found" };
  await ingestRows([{ company: account.name, domain: account.domain, contactName: fullName, email: str(fd, "email"), title: str(fd, "title"), phone: str(fd, "phone"), linkedinUrl: str(fd, "linkedinUrl") }], { source: "manual" });
  await db.account.update({ where: { id: accountId }, data: { pipelineStatus: "idle", pipelineStage: Math.min(account.pipelineStage, 1) } });
  refresh("/crm/contacts", `/accounts/${accountId}`);
  return { ok: true, message: `${fullName} added — run the pipeline to verify them` };
}

export async function createOpportunityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = z.object({ accountId: z.string().min(1), name: z.string().min(1).max(200), amountUsd: z.coerce.number().int().min(0).max(100_000_000), stage: z.enum(["discovery", "qualification", "proposal", "negotiation"]), closeDate: z.string().optional() }).safeParse({
    accountId: str(fd, "accountId"), name: str(fd, "name"), amountUsd: str(fd, "amountUsd") ?? "0", stage: str(fd, "stage") ?? "discovery", closeDate: str(fd, "closeDate"),
  });
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Invalid input" };
  const a = await db.account.findUniqueOrThrow({ where: { id: p.data.accountId } });
  await db.opportunity.create({ data: { ...p.data, closeDate: p.data.closeDate ? new Date(p.data.closeDate) : null, ownerId: a.ownerId, source: a.pipelineStage > 0 ? "abm" : "outbound" } });
  // An open deal means sales owns the account: stop automation.
  await db.account.update({ where: { id: a.id }, data: { stage: "OPPORTUNITY" } });
  await stopAccountAutomation(a.id, "opportunity opened");
  refresh("/crm/opportunities", `/accounts/${a.id}`);
  return { ok: true, message: "Opportunity created; automated outreach paused" };
}

export async function moveOpportunityAction(id: string, stage: "discovery" | "qualification" | "proposal" | "negotiation" | "won" | "lost", lostReason?: string): Promise<ActionState> {
  if (stage === "won" || stage === "lost") await recordOutcome(id, stage, lostReason);
  else await db.opportunity.update({ where: { id }, data: { stage } });
  refresh("/crm/opportunities", "/analytics");
  return { ok: true, message: `Moved to ${stage}` };
}

export async function createTaskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const title = str(fd, "title");
  if (!title) return { ok: false, message: "Title is required" };
  const due = str(fd, "dueAt");
  await db.task.create({ data: { title, body: str(fd, "body"), accountId: str(fd, "accountId") ?? null, assigneeId: str(fd, "assigneeId") ?? null, dueAt: due ? new Date(due) : null } });
  refresh("/crm/tasks");
  return { ok: true, message: "Task created" };
}

export async function setTaskStatusAction(id: string, status: "todo" | "in_progress" | "done"): Promise<ActionState> {
  await db.task.update({ where: { id }, data: { status, completedAt: status === "done" ? new Date() : null } });
  refresh("/crm/tasks");
  return { ok: true, message: "Updated" };
}

export async function addNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const body = str(fd, "body");
  const accountId = str(fd, "accountId");
  if (!body || !accountId) return { ok: false, message: "Write a note first" };
  await db.note.create({ data: { body: body.slice(0, 5000), accountId, contactId: str(fd, "contactId") ?? null } });
  refresh(`/accounts/${accountId}`);
  return { ok: true, message: "Note added" };
}

export async function eraseContactAction(contactId: string): Promise<ActionState> {
  const r = await eraseContact(contactId, "admin");
  refresh("/crm/contacts");
  return { ok: r.erased, message: r.reason };
}

// ── Import ──

export async function importCsvAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file" };
  if (file.size > 5 * 1024 * 1024) return { ok: false, message: "File is larger than 5 MB" };
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (parsed.data.length === 0) return { ok: false, message: "No rows found" };
  if (parsed.data.length > 5000) return { ok: false, message: "Max 5,000 rows per import" };
  const res = await ingestRows(parsed.data, { source: "csv", filename: file.name });
  if (fd.get("run") === "on") await runBatch(res.accountIds);
  refresh("/accounts", "/import", "/pipeline");
  return { ok: res.accepted > 0, message: `${res.accepted} rows accepted, ${res.rejected} rejected across ${res.accountIds.length} accounts${fd.get("run") === "on" ? " — pipeline run complete" : ""}` };
}

// ── Demo data (hosted environments) ──

export async function seedDemoAction(): Promise<ActionState> {
  if (process.env.ALLOW_SEED !== "true") return { ok: false, message: "Seeding is disabled (set ALLOW_SEED=true to enable)" };
  const { seedDemo } = await import("@/lib/seed");
  const counts = await seedDemo(() => undefined);
  refresh("/accounts", "/pipeline", "/review", "/outreach", "/signals", "/handoffs", "/crm/contacts", "/crm/opportunities", "/crm/tasks", "/analytics", "/settings");
  return { ok: true, message: `Sample data loaded: ${counts.accounts} accounts, ${counts.contacts} contacts, ${counts.evidence} facts, ${counts.reviews} review items` };
}
