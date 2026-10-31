// Expanding the buying group beyond the obvious buyer.
//
// 1. Stakeholder search: for the groups this seller's deals involve (leadership, IT, finance,
//    procurement, operations, data, risk, channel, HR), find people in the groups nobody covers
//    yet. T1 searches up to 6 groups (2 people each), T2 up to 4 (1 each); T3 doesn't.
// 2. Additional influencers: the AI proposes 3–4 less-obvious people whose work the account's own
//    facts touch (a programme lead, internal audit, a plant head…). Code keeps a proposal only if
//    it cites a fact we hold, isn't an obvious C-level buyer, and isn't a role already mapped.
//    Each kept role is searched by title; roles nobody was found for stay listed as "look for".
//
// Contact providers are approval-gated: nothing is looked up for a company a person hasn't
// approved. People found here are influencers for planning; sequences email only decision makers
// and champions, as before.

import type { Account, BuyingRole, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { seller } from "@/lib/seller";
import { BudgetExceeded, charge, logEvent, type RunContext } from "@/lib/pipeline/context";
import { inferFunction, inferSeniority, splitName, standardizeTitle } from "@/lib/pipeline/normalize";
import { setContactField } from "@/lib/pipeline/fields";
import type { InfluencerRole, ProviderPerson } from "@/lib/adapters/types";
import { GROUP_BY_KEY, OBVIOUS_TITLE, groupOf, personaGroups, targetGroups, titleOverlap } from "./stakeholders";

const S = 8;
const DAY = 86_400_000;

async function recentlyRan(accountId: string, step: string, now: Date) {
  return db.pipelineEvent.findFirst({ where: { accountId, step, createdAt: { gte: new Date(now.getTime() - CONFIG.buyingGroup.refreshDays * DAY) } }, select: { createdAt: true } });
}

function isApprovalError(e: unknown) {
  return e instanceof Error && e.name === "ApprovalRequired";
}

/** The function a stakeholder group stands for, when the title alone doesn't tell (a CHRO, a COO). */
const GROUP_FUNCTION: Record<string, string> = { executive: "executive", it_digital: "it", finance: "finance", procurement: "procurement", operations: "operations", data: "data", risk_compliance: "compliance", sales_channel: "sales", hr: "hr" };

async function addPerson(account: Account, p: ProviderPerson, ctx: RunContext, extra: { role?: BuyingRole; discoveredBy: string; influenceReason?: string; group?: string }) {
  const existing = await db.contact.findFirst({ where: { accountId: account.id, mergedIntoId: null, OR: [{ fullName: { equals: p.fullName, mode: "insensitive" } }, ...(p.linkedinUrl ? [{ linkedinUrl: p.linkedinUrl }] : [])] } });
  if (existing) return null;
  const title = standardizeTitle(p.title);
  const fn = inferFunction(title) ?? (extra.group ? GROUP_FUNCTION[extra.group] : null) ?? (groupOf(title) ? GROUP_FUNCTION[groupOf(title)!] : null);
  const role = extra.role ?? ((await ctx.adapters.llm.mapRole(title, null, fn)) as BuyingRole);
  const { first, last } = splitName(p.fullName);
  const c = await db.contact.create({
    data: {
      accountId: account.id, fullName: p.fullName, firstName: first, lastName: last, title, titleNormalized: title, function: fn, seniority: inferSeniority(title),
      buyingRole: role, linkedinUrl: p.linkedinUrl, identityConfidence: 0.67, source: p.source, country: account.country,
      discoveredBy: extra.discoveredBy, influenceReason: extra.influenceReason ?? null,
    },
  });
  await setContactField(c.id, "title", { value: title, status: "verified", source: p.source, observedAt: p.observedAt });
  await setContactField(c.id, "company", { value: account.domain, status: "verified", source: p.source, observedAt: p.observedAt });
  await setContactField(c.id, "email", { value: null, status: "unknown", source: p.source });
  return c;
}

/** Search for people in the stakeholder groups nobody covers yet (T1/T2). */
export async function expandStakeholders(account: Account, ctx: RunContext, opts: { force?: boolean } = {}): Promise<{ searched: string[]; added: number; reason?: string }> {
  const plan = CONFIG.buyingGroup.stakeholderSearch[account.tier ?? "T3"];
  if (!plan) return { searched: [], added: 0, reason: "T3: owning-function search only" };
  if (!account.domain) return { searched: [], added: 0, reason: "No website to search people at" };
  if (!opts.force && (await recentlyRan(account.id, "buying_group.stakeholder_search", ctx.now))) return { searched: [], added: 0, reason: "Searched in the last 90 days" };
  const people = await db.contact.findMany({ where: { accountId: account.id, mergedIntoId: null, stakeholderType: "executive" }, select: { title: true, titleNormalized: true } });
  const covered = new Set(people.map((p) => groupOf(p.titleNormalized ?? p.title)).filter(Boolean));
  const fns = seller().personas.flatMap((p) => p.functions);
  const buyers = new Set(personaGroups(fns));
  const groups = targetGroups(fns).filter((g) => !covered.has(g)).slice(0, plan.groups);
  const searched: string[] = [];
  let added = 0;
  let stopped: string | undefined;
  for (const g of groups) {
    try {
      await charge(account.id, account.tier, "lookup", CONFIG.costsUsd.providerCheck, `Find ${GROUP_BY_KEY[g].label}`, S);
      const found = await ctx.adapters.provider.findByTitles(account.domain, GROUP_BY_KEY[g].titles, plan.perGroup);
      searched.push(g);
      // Keep only people whose title really files into the group asked for.
      // Only the groups the client's personas cover can produce decision makers or champions (who get
      // emailed and enriched); people found elsewhere are influencers for planning.
      for (const p of found) if (groupOf(p.title) === g && (await addPerson(account, p, ctx, { discoveredBy: "stakeholder_search", group: g, ...(buyers.has(g) ? {} : { role: "influencer" as BuyingRole, influenceReason: `${GROUP_BY_KEY[g].label}: ${GROUP_BY_KEY[g].role.toLowerCase()}` }) }))) added++;
    } catch (e) {
      if (e instanceof BudgetExceeded) { stopped = "budget reached"; break; }
      if (isApprovalError(e)) { stopped = "company not approved for contact lookups"; break; }
      throw e;
    }
  }
  await logEvent(ctx, {
    accountId: account.id, stage: S, step: "buying_group.stakeholder_search", outcome: added ? "pass" : "info",
    reason: groups.length ? `Searched ${searched.map((g) => GROUP_BY_KEY[g].label).join(", ") || "nothing"}: ${added} people added${stopped ? `; stopped: ${stopped}` : ""}` : "Every target group already has someone",
    data: { covered: [...covered], searched, added } as Prisma.InputJsonValue,
  });
  return { searched, added, reason: stopped };
}

export interface InfluencerOutcome {
  title: string;
  group: string;
  why: string;
  facts: { id: string; claim: string }[];
  /** Contact ids found for this role. */
  found: string[];
}

/** Validation for AI proposals; returns the kept roles and why each other one was dropped. */
export function vetInfluencers(roles: InfluencerRole[], facts: { id: string }[], existingTitles: string[], max: number) {
  const known = new Set(facts.map((f) => f.id));
  const kept: InfluencerRole[] = [];
  const dropped: { title: string; reason: string }[] = [];
  for (const r of roles) {
    const factIds = r.factIds.filter((id) => known.has(id));
    if (!factIds.length) { dropped.push({ title: r.title, reason: "not tied to a fact we hold" }); continue; }
    if (OBVIOUS_TITLE.test(r.title)) { dropped.push({ title: r.title, reason: "an obvious executive buyer, not an additional influencer" }); continue; }
    if (!GROUP_BY_KEY[r.group]) { dropped.push({ title: r.title, reason: `unknown group "${r.group}"` }); continue; }
    const dup = existingTitles.find((t) => titleOverlap(t, r.title) >= 0.6);
    if (dup) { dropped.push({ title: r.title, reason: `already mapped (${dup})` }); continue; }
    if (kept.some((k) => titleOverlap(k.title, r.title) >= 0.6)) { dropped.push({ title: r.title, reason: "duplicate proposal" }); continue; }
    if (kept.length >= max) { dropped.push({ title: r.title, reason: `limit of ${max}` }); continue; }
    kept.push({ ...r, factIds, searchTitles: r.searchTitles.filter((t) => !OBVIOUS_TITLE.test(t)).slice(0, 5) });
  }
  return { kept, dropped };
}

/** The AI's 3–4 less-obvious people, grounded in the account's facts, then searched by title. */
export async function findHiddenInfluencers(account: Account, ctx: RunContext, opts: { force?: boolean } = {}): Promise<{ roles: InfluencerOutcome[]; dropped: { title: string; reason: string }[]; reason?: string }> {
  const cfg = CONFIG.buyingGroup.influencers;
  if (!opts.force && !cfg.tiers.includes(account.tier ?? "T3")) return { roles: [], dropped: [], reason: `${account.tier ?? "T3"}: influencers are proposed for ${cfg.tiers.join(" and ")} companies` };
  if (!opts.force && (await recentlyRan(account.id, "buying_group.hidden_influencers", ctx.now))) return { roles: [], dropped: [], reason: "Proposed in the last 90 days" };
  const [evidence, hyps, people] = await Promise.all([
    db.evidence.findMany({ where: { accountId: account.id, supersededById: null, flagged: false, isNegative: false, status: { in: ["verified", "probable"] } }, orderBy: [{ status: "asc" }, { publishedAt: "desc" }], take: 15, select: { id: true, claim: true } }),
    db.hypothesis.findMany({ where: { accountId: account.id, status: { in: ["supported", "validated"] } }, select: { text: true }, take: 5 }),
    db.contact.findMany({ where: { accountId: account.id, mergedIntoId: null }, select: { title: true, titleNormalized: true, buyingRole: true } }),
  ]);
  if (!evidence.length) {
    await logEvent(ctx, { accountId: account.id, stage: S, step: "buying_group.hidden_influencers", outcome: "info", reason: "No facts yet to ground additional influencers on" });
    return { roles: [], dropped: [], reason: "No facts yet" };
  }
  const sp = seller();
  const existingTitles = people.map((p) => p.titleNormalized ?? p.title ?? "").filter(Boolean);
  const groups = targetGroups(sp.personas.flatMap((p) => p.functions));
  let proposals: InfluencerRole[] = [];
  try {
    await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmCheap, "Propose additional influencers", S);
    proposals = await ctx.adapters.llm.proposeInfluencers({
      company: account.name, industry: account.industry, offering: `${sp.name}: ${sp.summary}`.slice(0, 400),
      useCase: account.useCase ? sp.useCases.find((u) => u.key === account.useCase)?.name ?? account.useCase : null,
      facts: evidence, conclusions: hyps.map((h) => h.text), existing: people.map((p) => ({ title: p.titleNormalized ?? p.title ?? "unknown", role: p.buyingRole })), groups,
    });
  } catch (e) {
    if (e instanceof BudgetExceeded) return { roles: [], dropped: [], reason: "Budget reached" };
    throw e;
  }
  const { kept, dropped } = vetInfluencers(proposals, evidence, existingTitles, cfg.max);
  const claim = new Map(evidence.map((e) => [e.id, e.claim]));
  const roles: InfluencerOutcome[] = [];
  let stopped: string | undefined;
  for (const r of kept) {
    const facts = r.factIds.map((id) => ({ id, claim: claim.get(id)! }));
    const out: InfluencerOutcome = { title: r.title, group: r.group, why: r.why, facts, found: [] };
    roles.push(out);
    if (stopped || !account.domain || !r.searchTitles.length) continue;
    try {
      await charge(account.id, account.tier, "lookup", CONFIG.costsUsd.providerCheck, `Find ${r.title}`, S);
      const found = await ctx.adapters.provider.findByTitles(account.domain, r.searchTitles, 1);
      for (const p of found) {
        const reason = `${r.why}. Based on: “${facts[0].claim.slice(0, 160)}”`;
        const c = await addPerson(account, p, ctx, { role: "influencer", discoveredBy: "influencer_search", influenceReason: reason, group: r.group });
        if (c) out.found.push(c.id);
      }
    } catch (e) {
      if (e instanceof BudgetExceeded) stopped = "budget reached";
      else if (isApprovalError(e)) stopped = "company not approved for contact lookups";
      else throw e;
    }
  }
  await logEvent(ctx, {
    accountId: account.id, stage: S, step: "buying_group.hidden_influencers", outcome: roles.length ? "pass" : "info",
    reason: `${roles.length} additional influencer role(s): ${roles.map((r) => `${r.title}${r.found.length ? " (found)" : ""}`).join(", ") || "none"}${dropped.length ? `; ${dropped.length} proposal(s) dropped` : ""}${stopped ? `; lookups stopped: ${stopped}` : ""}`,
    data: { roles, dropped } as unknown as Prisma.InputJsonValue,
  });
  return { roles, dropped, reason: stopped };
}

/** The latest proposal for a company (roles, why, facts, who was found), for the company page. */
export async function latestInfluencerPlan(accountId: string): Promise<{ at: Date; roles: InfluencerOutcome[]; dropped: { title: string; reason: string }[] } | null> {
  const events = await db.pipelineEvent.findMany({ where: { accountId, step: "buying_group.hidden_influencers" }, orderBy: { createdAt: "desc" }, take: 5 });
  for (const e of events) {
    const d = e.data as { roles?: InfluencerOutcome[]; dropped?: { title: string; reason: string }[] } | null;
    if (d?.roles) return { at: e.createdAt, roles: d.roles, dropped: d.dropped ?? [] };
  }
  return null;
}
