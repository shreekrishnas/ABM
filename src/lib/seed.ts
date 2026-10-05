// Seeds a realistic workspace by running real data through the real pipeline
// (with mock adapters). Nothing below writes pipeline state directly.

import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runBatch } from "@/lib/pipeline/orchestrator";
import { newContext } from "@/lib/pipeline/context";
import { recordReply, recordSignal, sendApproved, recordOutcome } from "@/lib/pipeline/stages/engagement";

const ACCOUNTS: [string, string, string, number, string][] = [
  ["Northwind Analytics", "northwind-analytics.com", "analytics", 850, "US"],
  ["Helios Fintech", "heliosfintech.io", "fintech", 1200, "GB"],
  ["Lumen Health", "lumenhealth.com", "healthtech", 640, "US"],
  ["Quanta Logistics", "quantalogistics.com", "logistics", 2300, "DE"],
  ["Brightpath Software", "brightpath.dev", "software", 420, "IN"],
  ["Cobalt Commerce", "cobaltcommerce.com", "ecommerce", 980, "NL"],
  ["Vertex Data Labs", "vertexdatalabs.ai", "analytics", 310, "US"],
  ["Orbital Payments", "orbitalpay.com", "fintech", 1750, "SG"],
  ["Pinecrest SaaS", "pinecrest.io", "saas", 560, "CA"],
  ["Meridian Insights", "meridianinsights.com", "analytics", 270, "AU"],
  ["Atlas Freight", "atlasfreight.co", "logistics", 3900, "US"],
  ["Nimbus Cloudworks", "nimbuscloud.io", "software", 1500, "IE"],
  ["Saffron Retail", "saffronretail.in", "ecommerce", 720, "IN"],
  ["Granite Security", "granitesec.com", "software", 890, "FR"],
  ["Tidewater Bank", "tidewaterbank.com", "banking", 12000, "US"],
  ["Kestrel Robotics", "kestrelrobotics.com", "manufacturing", 150, "JP"],
  ["Evergreen Telehealth", "evergreentelehealth.com", "healthtech", 410, "GB"],
  ["Polaris Supply", "polarissupply.com", "logistics", 1100, "NL"],
  ["Redwood Analytics", "redwoodanalytics.io", "analytics", 1900, "US"],
  ["Summit Ledger", "summitledger.com", "fintech", 380, "DE"],
  ["Halcyon Apps", "halcyonapps.com", "saas", 230, "US"],
  ["Ironclad Systems", "ironcladsys.com", "software", 2600, "GB"],
  ["Mosaic Marketplace", "mosaicmarket.com", "ecommerce", 1300, "US"],
  ["Beacon Biotech", "beaconbio.com", "biotech", 600, "US"],
];

const PEOPLE: [string, string][] = [
  ["Asha Mehta", "VP Data"],
  ["Daniel Okafor", "Hd of Data Platform"],
  ["Lena Fischer", "Director of Engineering"],
  ["Ravi Kumar", "Sr. Data Engineer"],
  ["Chloe Martin", "CFO"],
  ["Sam Wright", "Head of Security"],
];

/** Wipes the database and seeds a demo workspace through the real pipeline. */
export async function seedDemo(log: (...a: unknown[]) => void = console.log) {
  log("Resetting data…");
  await db.$transaction([
    db.reply.deleteMany(), db.message.deleteMany(), db.draft.deleteMany(), db.enrollment.deleteMany(), db.sequenceStep.deleteMany(), db.sequence.deleteMany(),
    db.signal.deleteMany(), db.handoff.deleteMany(), db.reviewItem.deleteMany(), db.watchlistEntry.deleteMany(), db.ledgerEntry.deleteMany(),
    db.pipelineEvent.deleteMany(), db.evidence.deleteMany(), db.twinVersion.deleteMany(), db.researchPlan.deleteMany(), db.fieldState.deleteMany(),
    db.task.deleteMany(), db.note.deleteMany(), db.opportunity.deleteMany(), db.contact.deleteMany(), db.account.deleteMany(),
    db.suppression.deleteMany(), db.mailbox.deleteMany(), db.importBatch.deleteMany(), db.user.deleteMany(),
  ]);

  const [maya, arjun, jess] = await Promise.all([
    db.user.create({ data: { name: "Maya Chen", email: "maya@company.com", role: "rep" } }),
    db.user.create({ data: { name: "Arjun Rao", email: "arjun@company.com", role: "rep" } }),
    db.user.create({ data: { name: "Jess Taylor", email: "jess@company.com", role: "marketer" } }),
  ]);
  await db.user.create({ data: { name: "Admin", email: "admin@company.com", role: "admin" } });
  await db.mailbox.createMany({ data: [{ address: "jess@outreach.company.com", dailyCap: 40 }, { address: "team@outreach.company.com", dailyCap: 40 }] });

  const steps = (tier: string) =>
    tier === "T1"
      ? [
          { order: 1, channel: "email" as const, dayOffset: 0, instruction: "Lead with the strongest trigger" },
          { order: 2, channel: "linkedin" as const, dayOffset: 2, instruction: "Connect and reference the trigger" },
          { order: 3, channel: "email" as const, dayOffset: 5, instruction: "Share a relevant customer story" },
          { order: 4, channel: "call" as const, dayOffset: 8, instruction: "Call the champion" },
          { order: 5, channel: "email" as const, dayOffset: 14, instruction: "Close the loop politely" },
        ]
      : [
          { order: 1, channel: "email" as const, dayOffset: 0, instruction: "Lead with the strongest trigger" },
          { order: 2, channel: "email" as const, dayOffset: 4, instruction: "Add one supporting fact" },
          { order: 3, channel: "email" as const, dayOffset: 10, instruction: "Close the loop politely" },
        ];
  for (const tier of ["T1", "T2", "T3"] as const) {
    await db.sequence.create({ data: { name: `${tier} ${tier === "T1" ? "1:1 multi-channel" : tier === "T2" ? "1:few" : "1:many"}`, tier, steps: { create: steps(tier) } } });
  }

  log("Ingesting accounts…");
  const rows = ACCOUNTS.flatMap(([company, domain, industry, employees, country], i) => {
    const people = PEOPLE.filter((_, j) => (i + j) % 2 === 0 || j < 2).slice(0, 3 + (i % 3));
    return people.map(([name, title], j) => ({
      company, domain: j === 0 && i % 5 === 0 ? `https://www.${domain}/` : domain, industry, employees, country,
      contactName: name, title,
      email: j === 2 && i % 7 === 0 ? `${name.split(" ")[0].toLowerCase()}@gmail.com` : `${name.toLowerCase().replace(" ", ".")}@${domain}`,
      phone: j === 0 ? (country === "IN" ? "+91 98765 43210" : country === "GB" ? "+44 20 7946 0958" : "+1 415 555 0134") : undefined,
      titleObservedAt: j === 1 && i % 4 === 0 ? new Date(Date.now() - 200 * 86_400_000).toISOString() : undefined,
    }));
  });
  // A malformed row and an exact duplicate to exercise the gates.
  rows.push({ company: "Northwind Analytics", domain: "northwind-analytics.com", industry: "analytics", employees: 850, country: "US", contactName: "Asha Mehta", title: "VP Data", email: "asha.mehta@northwind-analytics.com", phone: undefined, titleObservedAt: undefined });
  rows.push({ company: "", domain: "nowhere", industry: "", employees: 0, country: "", contactName: "", title: "", email: "sam@@broken", phone: undefined, titleObservedAt: undefined });
  const batch = await ingestRows(rows, { source: "csv", filename: "q4-target-accounts.csv" });
  log(`  ${batch.accepted} rows accepted, ${batch.rejected} rejected`);

  // CRM relationships that exclusions must respect.
  const byDomain = async (d: string) => db.account.findUniqueOrThrow({ where: { domain: d } });
  const owners = [maya.id, arjun.id];
  const all = await db.account.findMany({ orderBy: { createdAt: "asc" } });
  for (const [i, a] of all.entries()) await db.account.update({ where: { id: a.id }, data: { ownerId: owners[i % 2] } });
  await db.account.update({ where: { id: (await byDomain("tidewaterbank.com")).id }, data: { relationship: "customer" } });
  await db.account.update({ where: { id: (await byDomain("ironcladsys.com")).id }, data: { relationship: "competitor" } });
  const mosaic = await byDomain("mosaicmarket.com");
  await db.opportunity.create({ data: { accountId: mosaic.id, name: "Mosaic — Platform", amountUsd: 85000, stage: "proposal", source: "inbound", ownerId: maya.id } });

  log("Running pipeline…");
  const ctx = newContext();
  const results = await runBatch(all.map((a) => a.id), ctx);
  const tally = results.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  log("  ", tally);

  // Reviewer approves most pending drafts; rejects one.
  const pending = await db.draft.findMany({ where: { status: "pending_review" }, orderBy: { createdAt: "asc" } });
  for (const [i, d] of pending.entries()) {
    if (i % 5 === 4) continue; // leave some in the queue
    const approve = i !== 2;
    await db.draft.update({ where: { id: d.id }, data: { status: approve ? "approved" : "rejected", reviewedAt: new Date(), reviewerNote: approve ? "Looks good" : "Angle too generic for this persona" } });
    await db.reviewItem.updateMany({ where: { draftId: d.id, status: "open" }, data: { status: "resolved", resolution: approve ? "approved" : "rejected", resolvedAt: new Date() } });
  }
  const send = await sendApproved(ctx);
  log(`  sent ${send.sent}, held ${send.held}`);

  log("Simulating engagement…");
  const sentMsgs = await db.message.findMany({ where: { status: "delivered" }, include: { contact: true } });
  const ago = (d: number) => new Date(Date.now() - d * 86_400_000);
  for (const [i, m] of sentMsgs.entries()) {
    const a = m.contact.accountId;
    await recordSignal({ accountId: a, contactId: m.contactId, type: "email_open", source: "email_provider", occurredAt: ago(i % 6) }, ctx);
    if (i % 2 === 0) await recordSignal({ accountId: a, contactId: m.contactId, type: "email_click", source: "email_provider", occurredAt: ago(i % 5) }, ctx);
    if (i % 3 === 0) await recordSignal({ accountId: a, type: "pricing_visit", source: "tracking", detail: "/pricing (reverse IP)", occurredAt: ago(1 + (i % 4)) }, ctx);
    if (i % 4 === 0) await recordSignal({ accountId: a, type: "site_visit", source: "tracking", detail: "/blog/data-quality (reverse IP)", occurredAt: ago(2) }, ctx);
  }
  const replies = ["Interested — can we book 30 minutes next week?", "Not now, maybe next quarter.", "We already use an internal tool and are happy with it.", "I'm not the right person, talk to our VP Data.", "Please unsubscribe me.", "I'm out of the office until Monday.", "Hmm, depends what you mean by observability?"];
  for (const [i, m] of sentMsgs.slice(0, replies.length).entries()) await recordReply(m.contactId, replies[i], ctx);

  // A bit of CRM history: a won and a lost deal, tasks and notes.
  const engaged = await db.account.findMany({ where: { stage: "MQA" }, take: 2 });
  if (engaged[0]) {
    const opp = await db.opportunity.create({ data: { accountId: engaged[0].id, name: `${engaged[0].name} — Pilot`, amountUsd: 42000, stage: "negotiation", source: "abm", ownerId: engaged[0].ownerId, closeDate: ago(-21) } });
    await db.account.update({ where: { id: engaged[0].id }, data: { stage: "OPPORTUNITY" } });
    await db.note.create({ data: { accountId: engaged[0].id, authorId: engaged[0].ownerId, body: "Discovery call went well. Champion wants a pilot on their analytics warehouse." } });
    void opp;
  }
  const helios = await byDomain("heliosfintech.io");
  const lost = await db.opportunity.create({ data: { accountId: helios.id, name: "Helios — Expansion", amountUsd: 60000, stage: "proposal", source: "abm", ownerId: arjun.id } });
  await recordOutcome(lost.id, "lost", "Chose to build in-house", ctx);
  const brightpath = await byDomain("brightpath.dev");
  const won = await db.opportunity.create({ data: { accountId: brightpath.id, name: "Brightpath — Team plan", amountUsd: 36000, stage: "negotiation", source: "abm", ownerId: maya.id } });
  await recordOutcome(won.id, "won", undefined, ctx);
  await db.task.create({ data: { title: "Prep QBR deck for Tidewater Bank", accountId: (await byDomain("tidewaterbank.com")).id, assigneeId: arjun.id, dueAt: ago(-3), origin: "manual" } });
  await db.task.create({ data: { title: "Send Mosaic security questionnaire", accountId: mosaic.id, assigneeId: maya.id, dueAt: ago(1), origin: "manual", status: "in_progress" } });
  void jess;

  const counts = {
    accounts: await db.account.count({ where: { mergedIntoId: null } }),
    contacts: await db.contact.count(),
    evidence: await db.evidence.count(),
    reviews: await db.reviewItem.count({ where: { status: "open" } }),
    handoffs: await db.handoff.count(),
  };
  log("Done:", counts);
  return counts;
}
