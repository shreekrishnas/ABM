"use server";

// Server actions used by the UI. Every input is validated with zod; every
// mutation revalidates the pages that show it.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { finishBatch, importChunk, ingestRows, startBatch, type BatchStats } from "@/lib/pipeline/ingest";
import { analyzeMapping } from "@/lib/import/fields";
import { runAccount, runBatch, tick, processIntent, processQueue } from "@/lib/pipeline/orchestrator";
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
      // A hand-picked tier is locked; "automatic" lets the fit score decide again.
      ...(p.data.tier && p.data.tier !== "auto" ? { tier: p.data.tier, tierLocked: true } : { tierLocked: false }),
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

// Upload flow (driven by the import page):
//   startImportAction → importChunkAction × N (250 rows each) → finishImportAction
//   → processImportAction repeatedly until nothing is left in the queue.
// Chunking keeps every request small and inside serverless time limits, so a
// weekly file of any size goes through.

const CHUNK_MAX = 500;

export async function startImportAction(input: { filename: string; rows: number; headers: string[]; mapping: Record<string, string>; campaignId: string; senderId: string }): Promise<{ ok: true; batchId: string } | { ok: false; message: string }> {
  const p = z.object({
    filename: z.string().min(1).max(200), rows: z.number().int().min(1).max(100_000), headers: z.array(z.string().max(200)).max(200),
    mapping: z.record(z.string(), z.string()), campaignId: z.string().min(1, "Choose a campaign"), senderId: z.string().min(1, "Choose a sender profile"),
  }).safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Invalid file" };
  const analysis = analyzeMapping(p.data.headers, p.data.mapping);
  if (analysis.missingRequired.length) return { ok: false, message: `Map the required field(s): ${analysis.missingRequired.map((f) => f.label).join(", ")}` };
  const [campaign, sender] = await Promise.all([db.campaign.findUnique({ where: { id: p.data.campaignId } }), db.senderProfile.findUnique({ where: { id: p.data.senderId } })]);
  if (!campaign || !sender) return { ok: false, message: "Campaign or sender profile not found" };
  const batch = await startBatch({ filename: p.data.filename, source: "csv", rows: p.data.rows, ignoredColumns: [...analysis.ignored, ...analysis.duplicates], campaignId: campaign.id, senderId: sender.id, mapping: analysis.mapping });
  return { ok: true, batchId: batch.id };
}

export async function importChunkAction(batchId: string, rows: Record<string, string>[], rowOffset: number) {
  if (!Array.isArray(rows) || rows.length > CHUNK_MAX) return { ok: false as const, message: `Chunks are limited to ${CHUNK_MAX} rows` };
  const res = await importChunk(batchId, rows, rowOffset);
  return { ok: true as const, accepted: res.accepted, rejected: res.rejected, errors: res.errors.slice(0, 50) };
}

/** Preview: which companies, people and sender journeys already exist (nothing is written). */
export async function previewMatchesAction(input: {
  companies: { domain: string | null; companyLinkedin: string | null; nameKey: string }[];
  people: { linkedinUrl: string | null; email: string | null; fullName: string; company: number }[];
  campaignId: string;
  senderId: string;
}) {
  const companies = input.companies.slice(0, 5000);
  const people = input.people.slice(0, 5000);
  const domains = companies.map((c) => c.domain).filter(Boolean) as string[];
  const cLinks = companies.map((c) => c.companyLinkedin).filter(Boolean) as string[];
  const keys = companies.map((c) => c.nameKey);
  const found = await db.account.findMany({
    where: { mergedIntoId: null, OR: [{ domain: { in: domains } }, { linkedinUrl: { in: cLinks } }, { nameKey: { in: keys } }] },
    select: { id: true, domain: true, linkedinUrl: true, nameKey: true },
  });
  const companyIds = companies.map((c) => {
    const hit = (c.domain && found.find((f) => f.domain === c.domain)) || (c.companyLinkedin && found.find((f) => f.linkedinUrl === c.companyLinkedin)) || found.find((f) => f.nameKey === c.nameKey && (!c.domain || !f.domain || f.domain === c.domain));
    return hit ? hit.id : null;
  });
  const pLinks = people.map((x) => x.linkedinUrl).filter(Boolean) as string[];
  const emails = people.map((x) => x.email).filter(Boolean) as string[];
  const names = people.map((x) => x.fullName);
  const contacts = await db.contact.findMany({
    where: { mergedIntoId: null, OR: [{ linkedinUrl: { in: pLinks } }, { email: { in: emails } }, { fullName: { in: names, mode: "insensitive" }, accountId: { in: companyIds.filter(Boolean) as string[] } }] },
    select: { id: true, linkedinUrl: true, email: true, fullName: true, accountId: true, journeys: { where: { campaignId: input.campaignId, senderId: input.senderId }, select: { id: true } } },
  });
  let peopleExisting = 0;
  let journeysExisting = 0;
  for (const x of people) {
    const accountId = companyIds[x.company];
    const hit =
      (x.linkedinUrl && contacts.find((c) => c.linkedinUrl === x.linkedinUrl)) ||
      (x.email && contacts.find((c) => c.email?.toLowerCase() === x.email)) ||
      (accountId && contacts.find((c) => c.accountId === accountId && c.fullName.toLowerCase() === x.fullName.toLowerCase()));
    if (hit) {
      peopleExisting++;
      if (hit.journeys.length) journeysExisting++;
    }
  }
  const companiesExisting = companyIds.filter(Boolean).length;
  return { companiesExisting, companiesNew: companies.length - companiesExisting, peopleExisting, peopleNew: people.length - peopleExisting, journeysExisting, journeysNew: people.length - journeysExisting };
}

export async function createCampaignAction(name: string, description?: string): Promise<{ ok: true; id: string; name: string } | { ok: false; message: string }> {
  const p = z.object({ name: z.string().trim().min(2, "Name is too short").max(120), description: z.string().max(500).optional() }).safeParse({ name, description });
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const existing = await db.campaign.findUnique({ where: { name: p.data.name } });
  const c = existing ?? (await db.campaign.create({ data: { name: p.data.name, description: p.data.description } }));
  refresh("/import", "/people", "/settings");
  return { ok: true, id: c.id, name: c.name };
}

export async function createSenderAction(name: string, linkedinUrl?: string): Promise<{ ok: true; id: string; name: string } | { ok: false; message: string }> {
  const p = z.object({ name: z.string().trim().min(2, "Name is too short").max(120), linkedinUrl: z.string().max(300).optional() }).safeParse({ name, linkedinUrl });
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const existing = await db.senderProfile.findUnique({ where: { name: p.data.name } });
  const s = existing ?? (await db.senderProfile.create({ data: { name: p.data.name, linkedinUrl: p.data.linkedinUrl || null } }));
  refresh("/import", "/people", "/settings");
  return { ok: true, id: s.id, name: s.name };
}

export async function createCampaignFormAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await createCampaignAction(str(fd, "name") ?? "", str(fd, "description"));
  return r.ok ? { ok: true, message: `Campaign "${r.name}" ready` } : { ok: false, message: r.message };
}

export async function createSenderFormAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await createSenderAction(str(fd, "name") ?? "", str(fd, "linkedinUrl"));
  return r.ok ? { ok: true, message: `Sender profile "${r.name}" ready` } : { ok: false, message: r.message };
}

export async function finishImportAction(batchId: string) {
  const b = await finishBatch(batchId);
  refresh("/import", "/accounts");
  return { toProcess: b.toProcess, stats: b.stats as unknown as BatchStats };
}

export async function processImportAction(batchId?: string) {
  const r = await processQueue({ batchId, budgetMs: 35_000 });
  refresh("/import", "/accounts", "/pipeline", "/review");
  return { processed: r.processed, remaining: r.remaining };
}

// ── Demo data (hosted environments) ──

export async function seedDemoAction(): Promise<ActionState> {
  if (process.env.ALLOW_SEED !== "true") return { ok: false, message: "Seeding is disabled (set ALLOW_SEED=true to enable)" };
  const { seedDemo } = await import("@/lib/seed");
  const counts = await seedDemo(() => undefined);
  refresh("/accounts", "/pipeline", "/review", "/outreach", "/signals", "/handoffs", "/crm/contacts", "/crm/opportunities", "/crm/tasks", "/analytics", "/settings");
  return { ok: true, message: `Sample data loaded: ${counts.accounts} accounts, ${counts.contacts} contacts, ${counts.evidence} facts, ${counts.reviews} review items` };
}

// ── Fact feedback ──

export async function flagFactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = z.object({ evidenceId: z.string().min(1), reason: z.string().trim().min(3, "Say briefly what is wrong").max(300) }).safeParse({ evidenceId: str(fd, "evidenceId"), reason: str(fd, "reason") });
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const { flagFact } = await import("@/lib/brain/feedback");
  const r = await flagFact(p.data.evidenceId, p.data.reason);
  refresh(`/accounts/${r.accountId}`, "/review", "/outreach");
  return { ok: true, message: `Marked wrong — it won't be used again${r.withdrawn ? `; ${r.withdrawn} draft(s) citing it withdrawn` : ""}` };
}

export async function unflagFactAction(evidenceId: string): Promise<ActionState> {
  const { unflagFact } = await import("@/lib/brain/feedback");
  const r = await unflagFact(evidenceId);
  refresh(`/accounts/${r.accountId}`);
  return { ok: true, message: "Fact restored (probable until the next twin update)" };
}



// ── People journeys ──

const ACTIVITY_TYPES = ["connection_sent", "connection_accepted", "follow_up_sent", "details_shared", "call_scheduled", "demo_scheduled", "call_logged", "note"] as const;
const journeyKeys = z.object({ contactId: z.string().min(1), campaignId: z.string().min(1, "Choose a campaign"), senderId: z.string().min(1, "Choose a sender profile") });

function activityAt(fd: FormData) {
  const d = str(fd, "date");
  const at = d ? new Date(d) : new Date();
  return Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 86_400_000 ? null : at;
}

async function refreshPerson(contactId: string) {
  const c = await db.contact.findUnique({ where: { id: contactId }, select: { accountId: true } });
  refresh("/people", `/people/${contactId}`, c ? `/accounts/${c.accountId}` : "/accounts");
}

/** Single manual update: refreshes stage, last engagement, journey and next action together. */
export async function logActivityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const k = journeyKeys.safeParse({ contactId: str(fd, "contactId"), campaignId: str(fd, "campaignId"), senderId: str(fd, "senderId") });
  if (!k.success) return { ok: false, message: k.error.issues[0].message };
  const type = str(fd, "type");
  if (!type || !(ACTIVITY_TYPES as readonly string[]).includes(type)) return { ok: false, message: "Choose an activity" };
  const at = activityAt(fd);
  if (!at) return { ok: false, message: "Date must be a valid date, not in the future" };
  const text = str(fd, "detail");
  if (type === "note" && !text) return { ok: false, message: "Write the note" };
  const { ensureJourney, recordActivities } = await import("@/lib/journey/service");
  const { journey } = await ensureJourney(k.data.contactId, k.data.campaignId, k.data.senderId);
  const activity = (type === "note" ? { type, at, text: text! } : { type, at, detail: text }) as import("@/lib/journey/engine").Activity;
  const r = await recordActivities(journey.id, [activity], "manual");
  await refreshPerson(k.data.contactId);
  const { stageLabel } = await import("@/lib/journey/stages");
  return { ok: true, message: `Saved — stage: ${stageLabel(r.journey.stage, r.journey.followUpCount)}` };
}

export async function setStageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const k = journeyKeys.safeParse({ contactId: str(fd, "contactId"), campaignId: str(fd, "campaignId"), senderId: str(fd, "senderId") });
  if (!k.success) return { ok: false, message: k.error.issues[0].message };
  const { parseStage, STAGE_INFO } = await import("@/lib/journey/stages");
  const stage = parseStage(str(fd, "stage"));
  if (!stage) return { ok: false, message: "Choose a stage" };
  const { ensureJourney, recordActivities } = await import("@/lib/journey/service");
  const { journey } = await ensureJourney(k.data.contactId, k.data.campaignId, k.data.senderId);
  await recordActivities(journey.id, [{ type: "stage_set", at: new Date(), stage, detail: str(fd, "reason") }], "manual");
  await refreshPerson(k.data.contactId);
  return { ok: true, message: `Stage set to ${STAGE_INFO[stage].label}` };
}

/** Bulk update for the selected people within one campaign + sender. */
export async function bulkUpdateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ids = fd.getAll("contactIds").filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, 1000);
  const campaignId = str(fd, "campaignId");
  const senderId = str(fd, "senderId");
  const action = str(fd, "action");
  if (!ids.length) return { ok: false, message: "Select at least one person" };
  if (!campaignId || !senderId) return { ok: false, message: "Filter by one campaign and one sender profile first — bulk updates change that sender's journeys only" };
  if (!action) return { ok: false, message: "Choose an action" };
  const at = activityAt(fd);
  if (!at) return { ok: false, message: "Date must be a valid date, not in the future" };
  const { parseStage } = await import("@/lib/journey/stages");
  const { ensureJourney, recordActivities } = await import("@/lib/journey/service");
  type A = import("@/lib/journey/engine").Activity;
  let activity: A;
  if (action.startsWith("stage:")) {
    const stage = parseStage(action.slice(6));
    if (!stage) return { ok: false, message: "Unknown stage" };
    activity = { type: "stage_set", at, stage, detail: "Bulk update" };
  } else if ((["connection_sent", "connection_accepted", "follow_up_sent", "details_shared"] as const).includes(action as "details_shared")) {
    activity = { type: action, at } as A;
  } else return { ok: false, message: "Unknown action" };
  let n = 0;
  for (const contactId of ids) {
    const { journey } = await ensureJourney(contactId, campaignId, senderId);
    await recordActivities(journey.id, [activity], "bulk");
    n++;
  }
  refresh("/people");
  return { ok: true, message: `Updated ${n} ${n === 1 ? "person" : "people"}` };
}

/** Agent-assisted: suggest the reply's meaning, stage and next action. Nothing is saved. */
export async function suggestReplyAction(contactId: string, campaignId: string, senderId: string, text: string) {
  if (!text.trim()) return { ok: false as const, message: "Paste the reply first" };
  const c = await db.contact.findUnique({ where: { id: contactId }, include: { account: true, journeys: { where: { campaignId, senderId } } } });
  if (!c) return { ok: false as const, message: "Person not found" };
  const { suggestReplyMeaning } = await import("@/lib/journey/service");
  const s = await suggestReplyMeaning(text.slice(0, 4000), { company: c.account.name, title: c.titleNormalized ?? c.title, stage: c.journeys[0]?.stage ?? "not_contacted" });
  return { ok: true as const, ...s };
}

/** The person confirms (or changes) the suggested stage; the reply is counted and saved. */
export async function confirmReplyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const k = journeyKeys.safeParse({ contactId: str(fd, "contactId"), campaignId: str(fd, "campaignId"), senderId: str(fd, "senderId") });
  if (!k.success) return { ok: false, message: k.error.issues[0].message };
  const text = str(fd, "text");
  if (!text) return { ok: false, message: "Paste the reply" };
  const { parseStage, STAGE_INFO } = await import("@/lib/journey/stages");
  const meaning = parseStage(str(fd, "stage"));
  if (!meaning) return { ok: false, message: "Choose the stage this reply means" };
  const at = activityAt(fd);
  if (!at) return { ok: false, message: "Date must be a valid date, not in the future" };
  const { ensureJourney, recordActivities } = await import("@/lib/journey/service");
  const { journey } = await ensureJourney(k.data.contactId, k.data.campaignId, k.data.senderId);
  const r = await recordActivities(journey.id, [{ type: "reply", at, text: text.slice(0, 4000), meaning }], str(fd, "suggestedBy") ? "agent" : "manual", str(fd, "suggestedBy") ? `meaning confirmed (suggested by ${str(fd, "suggestedBy")})` : undefined);
  await refreshPerson(k.data.contactId);
  return { ok: true, message: `Reply saved (${r.journey.replyCount} so far) — stage: ${STAGE_INFO[r.journey.stage as keyof typeof STAGE_INFO].label}` };
}

export async function updatePersonAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  if (!id) return { ok: false, message: "Missing person" };
  const c = await db.contact.findUnique({ where: { id } });
  if (!c) return { ok: false, message: "Person not found" };
  const { isValidEmail, normalizeEmail, normalizeLinkedin, normalizePhone, standardizeTitle, inferFunction, inferSeniority } = await import("@/lib/pipeline/normalize");
  const { setContactField } = await import("@/lib/pipeline/fields");
  const firstName = str(fd, "firstName");
  if (!firstName) return { ok: false, message: "First name is required" };
  const lastName = str(fd, "lastName") ?? null;
  const email = str(fd, "email") ? normalizeEmail(str(fd, "email")!) : null;
  if (email && !isValidEmail(email)) return { ok: false, message: "Email is not valid" };
  const phone = str(fd, "phone") ? normalizePhone(str(fd, "phone")!) : null;
  if (str(fd, "phone") && !phone) return { ok: false, message: "Phone is not valid (include the country code)" };
  const linkedinUrl = str(fd, "linkedinUrl") ? normalizeLinkedin(str(fd, "linkedinUrl")!) : null;
  if (str(fd, "linkedinUrl") && !linkedinUrl) return { ok: false, message: "LinkedIn URL must be a profile URL (linkedin.com/in/…)" };
  if (linkedinUrl && linkedinUrl !== c.linkedinUrl && (await db.contact.findFirst({ where: { linkedinUrl, id: { not: id }, mergedIntoId: null } }))) return { ok: false, message: "Another person already has this LinkedIn URL" };
  const title = str(fd, "title") ?? null;
  const titleNorm = standardizeTitle(title);
  const changed: [string, string | null][] = [];
  if (email !== c.email) changed.push(["email", email]);
  if (phone !== c.phone) changed.push(["phone", phone]);
  if (title !== c.title) changed.push(["title", title]);
  if (linkedinUrl !== c.linkedinUrl) changed.push(["linkedin", linkedinUrl]);
  await db.contact.update({
    where: { id },
    data: {
      firstName, lastName, fullName: [firstName, lastName].filter(Boolean).join(" "), email, phone, linkedinUrl, title, titleNormalized: titleNorm,
      ...(title !== c.title ? { function: inferFunction(titleNorm), seniority: inferSeniority(titleNorm), buyingRole: "unknown" as const } : {}),
      department: str(fd, "department") ?? null, location: str(fd, "location") ?? null, personNotes: str(fd, "personNotes") ?? null,
      ...(changed.length ? { identityConfidence: null, readiness: null, readinessReasons: [] } : {}),
    },
  });
  // Edited identity fields are re-verified before any outreach.
  for (const [field, value] of changed) await setContactField(id, field, { value, status: "unknown", source: "manual" });
  await refreshPerson(id);
  return { ok: true, message: "Saved" };
}

export async function deletePersonAction(id: string): Promise<ActionState> {
  const c = await db.contact.findUnique({ where: { id } });
  if (!c) return { ok: false, message: "Person not found" };
  await db.reviewItem.deleteMany({ where: { contactId: id } });
  await db.pipelineEvent.updateMany({ where: { contactId: id }, data: { contactId: null } });
  await db.$transaction([db.reply.deleteMany({ where: { contactId: id } }), db.message.deleteMany({ where: { contactId: id } }), db.contact.delete({ where: { id } })]);
  await db.pipelineEvent.create({ data: { accountId: c.accountId, stage: 0, step: "people.deleted", outcome: "info", reason: `${c.fullName} deleted by a user` } });
  refresh("/people", `/accounts/${c.accountId}`);
  return { ok: true, message: `${c.fullName} deleted` };
}

/** After an import has been processed: what the intake and research did for its companies. */
export async function importResearchSummaryAction(batchId: string) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return null;
  const ids = (await db.account.findMany({ where: { lastImportBatchId: batchId }, select: { id: true } })).map((a) => a.id);
  const since = batch.createdAt;
  const [events, plans] = await Promise.all([
    db.pipelineEvent.findMany({ where: { accountId: { in: ids }, step: { in: ["intake.website", "intake.firmographics"] }, createdAt: { gte: since } }, select: { step: true, outcome: true, reason: true } }),
    db.researchPlan.findMany({ where: { accountId: { in: ids }, createdAt: { gte: since } }, select: { depth: true, skipped: true } }),
  ]);
  return {
    companies: ids.length,
    websitesFound: events.filter((e) => e.step === "intake.website" && e.outcome === "pass").length,
    websitesMissing: events.filter((e) => e.step === "intake.website" && e.outcome === "block").length,
    profilesFilled: events.filter((e) => e.step === "intake.firmographics" && e.outcome === "pass").length,
    deepDives: plans.filter((p) => p.depth?.startsWith("deep")).length,
    engagedDeepDives: plans.filter((p) => p.depth?.includes("engaged on LinkedIn")).length,
    skippedKnown: plans.reduce((n, p) => n + (p.skipped as { reason: string }[]).filter((x) => x.reason.startsWith("Known from import")).length, 0),
  };
}

// ── Discover ──

export async function scanMarketAction(): Promise<ActionState> {
  const { scanMarket } = await import("@/lib/discover/scan");
  const r = await scanMarket(newContext());
  refresh("/discover");
  return { ok: true, message: `Scanned ${r.searches} searches · ${r.events} buying events · ${r.suggestions} companies suggested · ${r.excluded} outside your targeting rule` };
}

export async function addSuggestionAction(id: string): Promise<ActionState> {
  const { addSuggestion } = await import("@/lib/discover/scan");
  const accountId = await addSuggestion(id);
  refresh("/discover", "/accounts");
  return { ok: !!accountId, message: accountId ? "Added to companies — research starts on the next run" : "Couldn't add this company" };
}

export async function dismissSuggestionAction(id: string): Promise<ActionState> {
  const { dismissSuggestion } = await import("@/lib/discover/scan");
  await dismissSuggestion(id);
  refresh("/discover");
  return { ok: true, message: "Dismissed" };
}
