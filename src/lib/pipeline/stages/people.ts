// Stages 8–9: Buying Group Discovery, Contact Enrichment.

import type { Account, BuyingRole } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { inferFunction, inferSeniority, splitName, standardizeTitle } from "../normalize";
import { lawfulBasisFor } from "../gates";
import { BudgetExceeded, charge, isSuppressed, logEvent, openReview, StopRun, type RunContext } from "../context";
import { contactFields, setContactField } from "../fields";
import { liveEvidence } from "./research";

export async function ownerFunctionOf(accountId: string): Promise<string | null> {
  const ev = await liveEvidence(accountId);
  const f = ev.find((e) => e.key === "owner_function" && (e.status === "verified" || e.status === "probable") && e.value);
  return f?.value ?? null;
}

// ───────────────────────── Stage 8 ─────────────────────────

export async function s08BuyingGroup(account: Account, ctx: RunContext): Promise<Account> {
  const S = 8;
  const owner = await ownerFunctionOf(account.id);
  await logEvent(ctx, { accountId: account.id, stage: S, step: "buying_group.affected_function", outcome: owner ? "pass" : "info", reason: owner ? `Owning function: ${owner}` : "Ownership unclear — no contacts will be guessed" });

  const live = () => db.contact.findMany({ where: { accountId: account.id, mergedIntoId: null, state: { notIn: ["suppressed", "do_not_contact"] } } });
  let contacts = await live();

  for (const c of contacts) {
    await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmCheap, `Map role ${c.fullName}`, S);
    const role = (await ctx.adapters.llm.mapRole(c.titleNormalized ?? c.title, owner, c.function)) as BuyingRole;
    if (role !== c.buyingRole) await db.contact.update({ where: { id: c.id }, data: { buyingRole: role } });
  }
  contacts = await live();

  // Discover missing decision maker / champion inside the owning function only.
  const has = (r: BuyingRole) => contacts.some((c) => c.buyingRole === r);
  const missing = (["decision_maker", "champion"] as BuyingRole[]).filter((r) => !has(r));
  if (owner && missing.length && account.domain) {
    try {
      await charge(account.id, account.tier, "lookup", CONFIG.costsUsd.providerCheck, `Discover ${owner} roles`, S);
      const found = await ctx.adapters.provider.findByFunction(account.domain, owner, 2);
      let added = 0;
      for (const p of found) {
        const exists = contacts.some((c) => c.fullName.toLowerCase() === p.fullName.toLowerCase());
        if (exists) continue;
        const title = standardizeTitle(p.title);
        const role = (await ctx.adapters.llm.mapRole(title, owner, inferFunction(title))) as BuyingRole;
        if (!missing.includes(role)) continue;
        const { first, last } = splitName(p.fullName);
        const nc = await db.contact.create({
          data: {
            accountId: account.id, fullName: p.fullName, firstName: first, lastName: last, title, titleNormalized: title,
            function: inferFunction(title), seniority: inferSeniority(title), buyingRole: role, linkedinUrl: p.linkedinUrl,
            identityConfidence: 0.67, source: p.source, country: account.country,
          },
        });
        await setContactField(nc.id, "title", { value: title, status: "verified", source: p.source, observedAt: p.observedAt });
        await setContactField(nc.id, "company", { value: account.domain, status: "verified", source: p.source, observedAt: p.observedAt });
        await setContactField(nc.id, "email", { value: null, status: "unknown", source: p.source });
        added++;
      }
      await logEvent(ctx, { accountId: account.id, stage: S, step: "buying_group.discover_by_function", outcome: "pass", reason: `Missing ${missing.join(", ")} — ${added} candidate(s) added from provider` });
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) throw e;
      await logEvent(ctx, { accountId: account.id, stage: S, step: "buying_group.discover_by_function", outcome: "info", reason: "Discovery skipped — budget reached" });
    }
    contacts = await live();
  }

  // Select: decision makers and champions, no identity conflict, no invalid email.
  let selected = 0;
  for (const c of contacts) {
    const f = await contactFields(c.id);
    const conflict = ["company", "title", "email"].some((k) => f[k]?.status === "conflicting");
    const eligible = (CONFIG.readiness.eligibleRoles as readonly string[]).includes(c.buyingRole) && !conflict && f.email?.status !== "invalid";
    if (eligible) {
      selected++;
      if (["new", "selected"].includes(c.state)) await db.contact.update({ where: { id: c.id }, data: { state: "selected" } });
    } else if (c.state === "selected") {
      await db.contact.update({ where: { id: c.id }, data: { state: "new" } });
    }
  }
  const roles = contacts.reduce<Record<string, number>>((a, c) => ({ ...a, [c.buyingRole]: (a[c.buyingRole] ?? 0) + 1 }), {});
  await logEvent(ctx, { accountId: account.id, stage: S, step: "buying_group.select_members", outcome: selected ? "pass" : "block", reason: `${selected} selected of ${contacts.length}`, data: roles });
  if (!selected) {
    await openReview({ type: "no_usable_person", stage: S, accountId: account.id, reason: owner ? `No usable decision maker or champion in ${owner}` : "Ownership unclear and no eligible contacts" });
    throw new StopRun("No usable person in the buying group");
  }
  return account;
}

// ───────────────────────── Stage 9 ─────────────────────────

export async function s09Enrichment(account: Account, ctx: RunContext): Promise<Account> {
  const S = 9;
  const selected = await db.contact.findMany({ where: { accountId: account.id, mergedIntoId: null, state: { in: ["selected", "ready"] } } });
  let ready = 0;
  for (const c of selected) {
    let email = c.email;
    const f = await contactFields(c.id);
    if (!email) {
      if (!account.domain) continue;
      try {
        await charge(account.id, account.tier, "lookup", CONFIG.costsUsd.paidLookup, `Email lookup ${c.fullName}`, S);
        email = await ctx.adapters.provider.findEmail(c.fullName, account.domain);
        if (email) {
          await db.contact.update({ where: { id: c.id }, data: { email } });
          await setContactField(c.id, "email", { value: email, status: "probable", source: "paid_lookup" });
        }
        await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "enrichment.paid_lookup", outcome: email ? "pass" : "info", reason: email ? `Found ${email} ($${CONFIG.costsUsd.paidLookup.toFixed(2)})` : "Provider has no email" });
      } catch (e) {
        if (!(e instanceof BudgetExceeded)) throw e;
        await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "enrichment.paid_lookup", outcome: "block", reason: "Budget reached — lookup skipped" });
      }
      if (!email) continue;
    } else {
      await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "enrichment.skip_paid_lookup", outcome: "pass", reason: "Email present — no paid call" });
    }

    if (f.email?.status !== "verified") {
      await charge(account.id, account.tier, "verification", CONFIG.costsUsd.mailboxVerify, `Verify ${email}`, S);
      const v = await ctx.adapters.mailbox.verify(email);
      await setContactField(c.id, "email", { value: email, status: v.status ?? (v.deliverable ? "verified" : "invalid"), source: "mailbox_check" });
      await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "enrichment.mailbox_verification", outcome: v.deliverable ? "pass" : "block", reason: v.reason });
      if (!v.deliverable) {
        await db.contact.update({ where: { id: c.id }, data: { state: "new" } });
        continue;
      }
    }

    if (await isSuppressed(email)) {
      await db.contact.update({ where: { id: c.id }, data: { state: "suppressed" } });
      await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "enrichment.suppression_check", outcome: "block", reason: "Opted out or suppressed — deselected" });
      continue;
    }

    const basis = lawfulBasisFor(c.country ?? account.country);
    await db.contact.update({ where: { id: c.id }, data: { lawfulBasis: basis } });
    await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "enrichment.lawful_basis", outcome: basis ? "pass" : "block", reason: basis ?? `No lawful basis configured for ${c.country ?? account.country ?? "unknown country"}` });
    if (!basis) {
      await openReview({ type: "lawful_basis_missing", stage: S, accountId: account.id, contactId: c.id, reason: `No lawful basis for ${c.country ?? account.country ?? "unknown country"} — confirm with counsel` });
    }
    ready++;
  }
  await logEvent(ctx, { accountId: account.id, stage: S, step: "enrichment.summary", outcome: ready ? "pass" : "block", reason: `${ready} of ${selected.length} contacts outreach-ready` });
  return account;
}
