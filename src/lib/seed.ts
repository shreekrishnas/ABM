// Seeds a realistic workspace by running real data through the real pipeline
// (with mock adapters). Nothing below writes pipeline state directly.

import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runBatch } from "@/lib/pipeline/orchestrator";
import { newContext } from "@/lib/pipeline/context";
import { createMockAdapters } from "@/lib/adapters/mock";
import { generateInsights } from "@/lib/brain/insights";
import { recordReply, recordSignal, sendApproved, recordOutcome } from "@/lib/pipeline/stages/engagement";

// Fictional prospects shaped like Manch's ICP (names, domains and facts are made up).
const ACCOUNTS: [string, string, string, number, string, string][] = [
  ["Sahyadri Beverages", "sahyadribev.in", "beverages", 6500, "IN", "SAP ECC; Excel vendor forms"],
  ["Kaveri Foods", "kaverifoods.com", "fmcg", 4200, "IN", "SAP S/4HANA"],
  ["Trident Auto Components", "tridentauto.in", "auto components manufacturing", 3100, "IN", "Oracle EBS"],
  ["Zippy Basket", "zippybasket.in", "quick commerce", 2800, "IN", "Microsoft Dynamics 365; Power Apps"],
  ["Lakshmi Finserv", "lakshmifinserv.in", "nbfc lending", 1900, "IN", "Finacle; manual KYC"],
  ["Meridian Pharma Distributors", "meridianpharma.in", "pharmaceutical distribution", 1400, "IN", "SAP ECC"],
  ["Coastal Cement", "coastalcement.in", "cement", 2600, "IN", "SAP S/4HANA; Informatica"],
  ["Desert Rose Foods", "desertrosefoods.ae", "food and beverage", 1800, "AE", "Oracle NetSuite"],
  ["Najd Trading Company", "najdtrading.sa", "retail", 3500, "SA", "SAP ECC"],
  ["SwiftMove Logistics", "swiftmove.in", "logistics", 5200, "IN", "Oracle EBS; Appian"],
  ["Urban Threads", "urbanthreads.in", "apparel retail", 900, "IN", "Tally"],
  ["Bharat Paints", "bharatpaints.in", "paints", 1200, "IN", "SAP ECC"],
  ["Gulf Telecom Distribution", "gulftelecomdist.com", "telecom", 700, "QA", ""],
  ["Pioneer Electricals", "pioneerelectricals.in", "electrical equipment", 650, "IN", "Microsoft Dynamics 365"],
  ["Northstar Insurance", "northstarinsure.in", "insurance", 2200, "IN", "Pega"],
  ["Shakti Steel", "shaktisteel.in", "steel", 8000, "IN", "SAP S/4HANA; SAP MDG"],
  ["FreshCart Online", "freshcart.co", "ecommerce", 450, "IN", ""],
  ["Lotus Healthcare", "lotushealthcare.my", "healthcare", 1100, "MY", "SAP Business One"],
  ["Peak Mobility", "peakmobility.in", "mobility", 1600, "IN", "Power Apps"],
  ["Kestrel Robotics", "kestrelrobotics.com", "robotics research", 150, "JP", ""],
  ["Verity MDM", "verity-mdm.com", "software", 400, "US", ""],
  ["Ganga Dairy", "gangadairy.in", "fmcg dairy", 3000, "IN", "SAP ECC"],
  ["Mosaic Marketplace", "mosaicmarket.in", "ecommerce marketplace", 1300, "IN", "Oracle EBS"],
  ["Helios Fintech", "heliosfintech.in", "fintech", 1200, "IN", "Microsoft Dynamics 365"],
  ["Brightpath Consumer", "brightpathconsumer.in", "fmcg personal care", 900, "IN", "SAP S/4HANA"],
];

// Titles shaped like Manch's buying group (one with an abbreviation to exercise normalization).
const PEOPLE: [string, string][] = [
  ["Asha Mehta", "Head of Master Data"],
  ["Daniel DSouza", "Hd of Procurement"],
  ["Lena Fischer", "SAP CoE Lead"],
  ["Ravi Kumar", "Sr. Vendor Management Executive"],
  ["Chloe Martin", "CFO"],
  ["Sam Wright", "Head of Distribution"],
];

const DIAL: Record<string, string> = { IN: "+91 98765 43210", AE: "+971 4 123 4567", SA: "+966 11 234 5678", QA: "+974 4412 3456", MY: "+60 3 1234 5678", US: "+1 415 555 0134", JP: "+81 3 1234 5678" };

const KEYWORDS: Record<string, string> = {
  beverages: "Bottling; Distributor network; Cold chain", fmcg: "Packaged foods; Rural distribution; Modern trade", manufacturing: "Auto components; Vendor base; Plants",
  "quick commerce": "Dark stores; Seller onboarding", ecommerce: "Marketplace; Seller onboarding", fintech: "Lending; Co-lending; KYC", nbfc: "Gold loans; Branch network; KYC",
};
const CITY: Record<string, string> = { IN: "Mumbai", AE: "Dubai", SA: "Riyadh", US: "Austin", GB: "London", SG: "Singapore", MY: "Kuala Lumpur" };

/** Varied LinkedIn journeys so every stage shows up in the sample data. */
async function seedJourneys(campaignId: string, sender1: string, sender2: string) {
  const { recordActivities } = await import("@/lib/journey/service");
  const { classifyReplyRules } = await import("@/lib/journey/engine");
  type A = import("@/lib/journey/engine").Activity;
  const day = (n: number) => new Date(Date.now() - n * 86_400_000);
  const reply = (n: number, text: string): A => ({ type: "reply", at: day(n), text, meaning: classifyReplyRules(text).stage });
  const patterns: A[][] = [
    [],
    [{ type: "connection_sent", at: day(9) }],
    [{ type: "connection_sent", at: day(16) }, { type: "connection_accepted", at: day(13) }],
    [{ type: "connection_sent", at: day(20) }, { type: "connection_accepted", at: day(18) }, { type: "follow_up_sent", at: day(12) }],
    [{ type: "connection_sent", at: day(30) }, { type: "connection_accepted", at: day(27) }, { type: "follow_up_sent", at: day(20) }, { type: "follow_up_sent", at: day(8) }],
    [{ type: "connection_sent", at: day(14) }, { type: "connection_accepted", at: day(12) }, reply(10, "Hi, nice to connect.")],
    [{ type: "connection_sent", at: day(18) }, { type: "connection_accepted", at: day(16) }, { type: "follow_up_sent", at: day(12) }, reply(9, "Please share more details."), { type: "details_shared", at: day(7) }],
    [{ type: "connection_sent", at: day(25) }, { type: "connection_accepted", at: day(22) }, reply(15, "Please share more details."), { type: "details_shared", at: day(14) }, reply(6, "Yes, we are interested. Can we set up a call?"), { type: "call_scheduled", at: day(4) }],
    [{ type: "connection_sent", at: day(21) }, { type: "connection_accepted", at: day(19) }, { type: "follow_up_sent", at: day(14) }, reply(11, "I will check and inform you.")],
    [{ type: "connection_sent", at: day(28) }, { type: "connection_accepted", at: day(25) }, reply(20, "We do not have a current requirement.")],
    [{ type: "connection_sent", at: day(19) }, { type: "connection_accepted", at: day(17) }, reply(13, "Please contact our production head, Mr. Kulkarni.")],
    [{ type: "connection_sent", at: day(15) }, reply(12, "I no longer work there.")],
    [{ type: "connection_sent", at: day(40) }, { type: "connection_accepted", at: day(37) }, reply(30, "Yes, we are interested."), { type: "call_scheduled", at: day(26) }, { type: "demo_scheduled", at: day(18) }, { type: "stage_set", at: day(10), stage: "opportunity", detail: "Pilot scoped for two regions" }],
  ];
  const journeys = await db.journey.findMany({ where: { campaignId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  for (const [i, j] of journeys.entries()) {
    const shift = j.senderId === sender2 ? 3 : 0; // Sender 2 is earlier in its outreach
    const p = patterns[(i * 5 + shift) % patterns.length];
    if (j.senderId === sender1 || j.senderId === sender2) if (p.length) await recordActivities(j.id, p, "csv", "Sample LinkedIn activity");
  }
}

/** Wipes the database and seeds a demo workspace through the real pipeline. */
export async function seedDemo(log: (...a: unknown[]) => void = console.log) {
  log("Resetting data…");
  await db.$transaction([
    db.reply.deleteMany(), db.message.deleteMany(), db.draft.deleteMany(), db.enrollment.deleteMany(), db.sequenceStep.deleteMany(), db.sequence.deleteMany(),
    db.signal.deleteMany(), db.handoff.deleteMany(), db.reviewItem.deleteMany(), db.watchlistEntry.deleteMany(), db.ledgerEntry.deleteMany(),
    db.pipelineEvent.deleteMany(), db.researchQuery.deleteMany(), db.accountBrief.deleteMany(), db.brainInsight.deleteMany(), db.evidence.deleteMany(), db.twinVersion.deleteMany(), db.researchPlan.deleteMany(), db.fieldState.deleteMany(),
    db.task.deleteMany(), db.note.deleteMany(), db.opportunity.deleteMany(), db.contact.deleteMany(), db.account.deleteMany(),
    db.journeyEvent.deleteMany(), db.journey.deleteMany(), db.campaign.deleteMany(), db.senderProfile.deleteMany(),
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
  const rows: Record<string, unknown>[] = ACCOUNTS.flatMap(([company, domain, industry, employees, country, tech], i) => {
    const people = PEOPLE.filter((_, j) => (i + j) % 2 === 0 || j < 2).slice(0, 3 + (i % 3));
    return people.map(([name, title], j) => ({
      company, domain: j === 0 && i % 5 === 0 ? `https://www.${domain}/` : domain, industry, employees, country, "Tech Stack": tech || undefined,
      contactName: name, title, "Person LinkedIn URL": `https://www.linkedin.com/in/${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${i}`,
      Keywords: j === 0 ? KEYWORDS[industry] : undefined, City: j === 0 ? CITY[country] : undefined,
      email: j === 2 && i % 7 === 0 ? `${name.split(" ")[0].toLowerCase()}@gmail.com` : `${name.toLowerCase().replace(" ", ".")}@${domain}`,
      phone: j === 0 ? DIAL[country] : undefined,
      titleObservedAt: j === 1 && i % 4 === 0 ? new Date(Date.now() - 200 * 86_400_000).toISOString() : undefined,
    }));
  });
  // A malformed row and an exact duplicate to exercise the gates.
  rows.push({ company: "Sahyadri Beverages", domain: "sahyadribev.in", industry: "beverages", employees: 6500, country: "IN", "Tech Stack": undefined, contactName: "Asha Mehta", title: "Head of Master Data", email: "asha.mehta@sahyadribev.in", phone: undefined, titleObservedAt: undefined });
  rows.push({ company: "", domain: "nowhere", industry: "", employees: 0, country: "", "Tech Stack": undefined, contactName: "", title: "", email: "sam@@broken", phone: undefined, titleObservedAt: undefined });
  const campaign = await db.campaign.create({ data: { name: "Q4 Distributor Onboarding", description: "FMCG, beverages and manufacturing with large partner networks" } });
  await db.campaign.create({ data: { name: "Vendor Master Clean-up", description: "Procurement-led vendor onboarding" } });
  const sender1 = await db.senderProfile.create({ data: { name: "Sender 1 — Priya", linkedinUrl: "https://www.linkedin.com/in/priya-sample" } });
  const sender2 = await db.senderProfile.create({ data: { name: "Sender 2 — Karan", linkedinUrl: "https://www.linkedin.com/in/karan-sample" } });
  const batch = await ingestRows(rows, { source: "csv", filename: "q4-target-accounts.csv", campaignId: campaign.id, senderId: sender1.id });
  log(`  ${batch.accepted} rows accepted, ${batch.rejected} rejected`);
  // The same list for a second sender reuses every company and person.
  await ingestRows(rows.slice(0, 18), { source: "csv", filename: "q4-sender2.csv", campaignId: campaign.id, senderId: sender2.id });
  await seedJourneys(campaign.id, sender1.id, sender2.id);

  // CRM relationships that exclusions must respect.
  const byDomain = async (d: string) => db.account.findUniqueOrThrow({ where: { domain: d } });
  const owners = [maya.id, arjun.id];
  const all = await db.account.findMany({ orderBy: { createdAt: "asc" } });
  for (const [i, a] of all.entries()) await db.account.update({ where: { id: a.id }, data: { ownerId: owners[i % 2] } });
  await db.account.update({ where: { id: (await byDomain("gangadairy.in")).id }, data: { relationship: "customer" } });
  await db.account.update({ where: { id: (await byDomain("verity-mdm.com")).id }, data: { relationship: "competitor" } });
  const mosaic = await byDomain("mosaicmarket.in");
  await db.opportunity.create({ data: { accountId: mosaic.id, name: "Mosaic — Platform", amountUsd: 85000, stage: "proposal", source: "inbound", ownerId: maya.id } });

  log("Running pipeline…");
  // Sample data always uses the mock services, so seeding never spends API credits.
  const ctx = { ...newContext(), adapters: createMockAdapters() };
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
    await db.note.create({ data: { accountId: engaged[0].id, authorId: engaged[0].ownerId, body: "Discovery call went well. Champion wants a pilot on distributor onboarding for two regions before the S/4HANA cut-over." } });
    void opp;
  }
  const helios = await byDomain("heliosfintech.in");
  const lost = await db.opportunity.create({ data: { accountId: helios.id, name: "Helios — Expansion", amountUsd: 60000, stage: "proposal", source: "abm", ownerId: arjun.id } });
  await recordOutcome(lost.id, "lost", "Chose to build on Power Apps in-house", ctx);
  const brightpath = await byDomain("brightpathconsumer.in");
  const won = await db.opportunity.create({ data: { accountId: brightpath.id, name: "Brightpath — Team plan", amountUsd: 36000, stage: "negotiation", source: "abm", ownerId: maya.id } });
  await recordOutcome(won.id, "won", undefined, ctx);
  await db.task.create({ data: { title: "Prep QBR deck for Ganga Dairy", accountId: (await byDomain("gangadairy.in")).id, assigneeId: arjun.id, dueAt: ago(-3), origin: "manual" } });
  await db.task.create({ data: { title: "Send Mosaic the security questionnaire", accountId: mosaic.id, assigneeId: maya.id, dueAt: ago(1), origin: "manual", status: "in_progress" } });
  void jess;

  // The seed runs the pipeline directly, so close its import batches here.
  await db.importBatch.updateMany({ where: { status: { in: ["processing", "uploading"] } }, data: { status: "done", finishedAt: new Date() } });

  log("Brain: summarising what works…");
  await generateInsights(ctx);

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
