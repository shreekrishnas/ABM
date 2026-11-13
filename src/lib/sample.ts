// A "Test" client filled with made-up companies, next to the real clients. It only ever adds
// to (or removes) its own client: nothing in any other client is read, changed or deleted.
// Everything runs on the mock services, so it spends no credits and sends no email.
// Loading happens in short steps (each well under a serverless time limit); call
// sampleStep() until it reports done.

import type { Prisma } from "@prisma/client";
import { baseDb } from "@/lib/db-base";
import { db } from "@/lib/db";
import { withScope, type Scope } from "@/lib/scope";
import { createMockAdapters } from "@/lib/adapters/mock";
import { newContext } from "@/lib/pipeline/context";

export const SAMPLE_ID = "test";
export const SAMPLE_NAME = "Test (sample data)";
const TAG = "Sample · ";
const PER_STEP = 4;
const DONE_MARK = "Sample data loaded";

const scope: Scope = { ids: [SAMPLE_ID], active: SAMPLE_ID, choices: [{ id: SAMPLE_ID, name: SAMPLE_NAME }], all: false };
const mine = { sellerId: SAMPLE_ID };

export type SampleState = { exists: boolean; companies: number; waiting: number; done: boolean };

export async function sampleState(): Promise<SampleState> {
  const [client, companies, waiting, mark] = await Promise.all([
    baseDb.client.findUnique({ where: { id: SAMPLE_ID }, select: { id: true } }),
    baseDb.account.count({ where: mine }),
    baseDb.account.count({ where: { ...mine, pipelineStatus: { in: ["idle", "queued"] }, mergedIntoId: null } }),
    baseDb.note.count({ where: { body: DONE_MARK, account: mine } }),
  ]);
  return { exists: Boolean(client), companies, waiting, done: mark > 0 };
}

/** Does the next piece of loading. Returns a line saying what happened and whether more remains. */
export async function sampleStep(by: string): Promise<{ done: boolean; message: string }> {
  const s = await sampleState();
  if (s.done) return { done: true, message: "The Test client is already loaded" };

  // 1. The client and its brain (a copy of the built-in one, so research rules are complete).
  if (!s.exists) {
    const { builtInPack, hashPack, DEFAULT_SELLER_ID } = await import("@/lib/seller");
    const base = builtInPack(DEFAULT_SELLER_ID);
    if (!base) throw new Error("No built-in brain to copy");
    const pack = { ...base, id: SAMPLE_ID, name: "Test" };
    await baseDb.client.create({ data: { id: SAMPLE_ID, name: SAMPLE_NAME, monthlyBudgetUsd: 500, showExtras: true } });
    await baseDb.sellerPackRevision.create({ data: { sellerId: SAMPLE_ID, pack: pack as unknown as Prisma.InputJsonValue, version: hashPack(pack), changed: ["created"], note: `Sample data by ${by}` } });
    await (await import("@/lib/seller")).ensureSellerPacks(true);
    return { done: false, message: "Created the Test client" };
  }

  return withScope(scope, async () => {
    const ctx = { ...newContext(), adapters: createMockAdapters() };

    // 2. Import the companies and people.
    if (s.companies === 0) {
      const { sampleRows, seedJourneys } = await import("@/lib/seed");
      const { ingestRows } = await import("@/lib/pipeline/ingest");
      const rows = sampleRows();
      const campaign = await baseDb.campaign.create({ data: { name: `${TAG}Q4 Distributor Onboarding`, description: "Sample campaign for the Test client" } });
      const s1 = await baseDb.senderProfile.create({ data: { name: `${TAG}Sender 1`, linkedinUrl: "https://www.linkedin.com/in/sample-sender-1" } });
      const s2 = await baseDb.senderProfile.create({ data: { name: `${TAG}Sender 2`, linkedinUrl: "https://www.linkedin.com/in/sample-sender-2" } });
      const batch = await ingestRows(rows, { source: "csv", filename: "sample-companies.csv", campaignId: campaign.id, senderId: s1.id });
      await ingestRows(rows.slice(0, 18), { source: "csv", filename: "sample-sender2.csv", campaignId: campaign.id, senderId: s2.id });
      await seedJourneys(campaign.id, s1.id, s2.id);
      await db.importBatch.updateMany({ where: { status: { in: ["processing", "uploading"] } }, data: { status: "done", finishedAt: new Date() } });
      return { done: false, message: `Imported ${batch.accepted} rows of companies and people` };
    }

    // 3. Research a few companies per step.
    if (s.waiting > 0) {
      const { runBatch } = await import("@/lib/pipeline/orchestrator");
      const next = await db.account.findMany({ where: { pipelineStatus: { in: ["idle", "queued"] }, mergedIntoId: null }, orderBy: { createdAt: "asc" }, take: PER_STEP, select: { id: true } });
      await runBatch(next.map((a) => a.id), ctx);
      const left = Math.max(0, s.waiting - next.length);
      return { done: false, message: `Researched ${s.companies - left} of ${s.companies} companies` };
    }

    // 4. Approvals, sent emails, replies, deals and tasks.
    const { sendApproved, recordSignal, recordReply, recordOutcome } = await import("@/lib/pipeline/stages/engagement");
    const pending = await db.draft.findMany({ where: { status: "pending_review" }, orderBy: { createdAt: "asc" } });
    for (const [i, d] of pending.entries()) {
      if (i % 5 === 4) continue; // leave some waiting for approval
      const approve = i !== 2;
      await db.draft.update({ where: { id: d.id }, data: { status: approve ? "approved" : "rejected", reviewedAt: new Date(), reviewerNote: approve ? "Looks good" : "Angle too generic for this persona" } });
      await db.reviewItem.updateMany({ where: { draftId: d.id, status: "open" }, data: { status: "resolved", resolution: approve ? "approved" : "rejected", resolvedAt: new Date() } });
    }
    // A stand-in mailbox only for this moment, so the sample emails count as sent; removed straight after.
    const box = await baseDb.mailbox.create({ data: { address: "sample@test.invalid", dailyCap: 200 } });
    try {
      await sendApproved(ctx);
    } finally {
      await baseDb.mailbox.delete({ where: { id: box.id } }).catch(() => undefined);
    }
    const ago = (n: number) => new Date(Date.now() - n * 86_400_000);
    const sent = await db.message.findMany({ where: { status: "delivered" }, include: { contact: true }, take: 30 });
    for (const [i, m] of sent.entries()) {
      const a = m.contact.accountId;
      await recordSignal({ accountId: a, contactId: m.contactId, type: "email_open", source: "email_provider", occurredAt: ago(i % 6) }, ctx);
      if (i % 2 === 0) await recordSignal({ accountId: a, contactId: m.contactId, type: "email_click", source: "email_provider", occurredAt: ago(i % 5) }, ctx);
      if (i % 3 === 0) await recordSignal({ accountId: a, type: "pricing_visit", source: "tracking", detail: "/pricing (reverse IP)", occurredAt: ago(1 + (i % 4)) }, ctx);
    }
    const replies = ["Interested — can we book 30 minutes next week?", "Not now, maybe next quarter.", "We already use an internal tool and are happy with it.", "I'm not the right person, talk to our VP Data.", "Please share more details.", "Yes, send me the case study."];
    for (const [i, m] of sent.slice(0, replies.length).entries()) await recordReply(m.contactId, replies[i], ctx);

    const some = await db.account.findMany({ where: { pipelineStatus: "done", mergedIntoId: null }, orderBy: { createdAt: "asc" }, take: 4 });
    if (some[0]) await db.opportunity.create({ data: { accountId: some[0].id, name: `${some[0].name} — Platform`, amountUsd: 85000, stage: "proposal", source: "inbound" } });
    if (some[1]) await db.opportunity.create({ data: { accountId: some[1].id, name: `${some[1].name} — Pilot`, amountUsd: 42000, stage: "negotiation", source: "abm", closeDate: ago(-21) } });
    if (some[2]) await recordOutcome((await db.opportunity.create({ data: { accountId: some[2].id, name: `${some[2].name} — Team plan`, amountUsd: 36000, stage: "negotiation", source: "abm" } })).id, "won", undefined, ctx);
    if (some[3]) await recordOutcome((await db.opportunity.create({ data: { accountId: some[3].id, name: `${some[3].name} — Expansion`, amountUsd: 60000, stage: "proposal", source: "abm" } })).id, "lost", "Chose to build in-house", ctx);
    if (some[0]) {
      await db.task.create({ data: { title: `Send ${some[0].name} the security questionnaire`, accountId: some[0].id, dueAt: ago(1), origin: "manual", status: "in_progress" } });
      await db.task.create({ data: { title: `Prep the review deck for ${some[0].name}`, accountId: some[0].id, dueAt: ago(-3), origin: "manual" } });
      await db.note.create({ data: { accountId: some[0].id, body: DONE_MARK } });
    } else {
      const any = await db.account.findFirst({ select: { id: true } });
      if (any) await db.note.create({ data: { accountId: any.id, body: DONE_MARK } });
    }
    return { done: true, message: `Test client ready: ${s.companies} companies. Pick "${SAMPLE_NAME}" in the client menu.` };
  });
}

/** Removes the Test client and everything in it. Other clients are untouched. */
export async function removeSample(): Promise<number> {
  const ids = (await baseDb.account.findMany({ where: mine, select: { id: true } })).map((a) => a.id);
  await baseDb.$transaction([
    baseDb.webVisit.deleteMany({ where: { accountId: { in: ids } } }),
    baseDb.account.deleteMany({ where: mine }),
    baseDb.importBatch.deleteMany({ where: mine }),
    baseDb.prospectSuggestion.deleteMany({ where: mine }),
    baseDb.marketEvent.deleteMany({ where: mine }),
    baseDb.brainSignal.deleteMany({ where: mine }),
    baseDb.decision.deleteMany({ where: mine }),
    baseDb.proposal.deleteMany({ where: mine }),
    baseDb.ledgerEntry.deleteMany({ where: mine }),
    baseDb.sellerPackRevision.deleteMany({ where: mine }),
    baseDb.campaign.deleteMany({ where: { name: { startsWith: TAG } } }),
    baseDb.senderProfile.deleteMany({ where: { name: { startsWith: TAG } } }),
    baseDb.mailbox.deleteMany({ where: { address: "sample@test.invalid" } }),
    baseDb.userClient.deleteMany({ where: { clientId: SAMPLE_ID } }),
    baseDb.client.deleteMany({ where: { id: SAMPLE_ID } }),
  ]);
  return ids.length;
}
