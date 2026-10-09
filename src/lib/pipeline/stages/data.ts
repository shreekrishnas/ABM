// Stages 2–4: Clean & Normalize, Fit/Tier/Exclusions, Identity Verification.

import type { Account, FieldStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import {
  emailDomain,
  inferFunction,
  inferSeniority,
  isValidEmail,
  normalizeCompanyName,
  normalizeCountry,
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedin,
  normalizePhone,
  phoneCountry,
  standardizeTitle,
} from "../normalize";
import { exclusionGate, fitFloorGate, mustHaveGate, emailDomainStatus, isStale, phoneCountryStatus } from "../gates";
import { dataConfidence, identityConfidence, researchPriority, scoreFit, tierFor } from "../scoring";
import { charge, logEvent, openReview, StopRun, type RunContext } from "../context";
import { seller } from "@/lib/seller";
import { pickUseCase } from "@/lib/seller/fit";
import { contactFields, setAccountField, setContactField } from "../fields";

// ───────────────────────── Stage 2 ─────────────────────────

export async function s02CleanNormalize(account: Account, ctx: RunContext): Promise<Account> {
  const S = 2;
  const domain = normalizeDomain(account.domain);
  if (account.domain && !domain) {
    await logEvent(ctx, { accountId: account.id, stage: S, step: "clean_normalize.normalize_account", outcome: "block", reason: `Unusable domain "${account.domain}"` });
  }

  // Merge duplicates: another live account with the same normalized domain.
  if (domain) {
    const dupes = await db.account.findMany({
      where: { id: { not: account.id }, mergedIntoId: null, OR: [{ domain }, { domain: { contains: domain, mode: "insensitive" } }] },
      orderBy: { createdAt: "asc" },
    });
    const sameDomain = dupes.filter((d) => normalizeDomain(d.domain) === domain);
    if (sameDomain.length) {
      const all = [account, ...sameDomain].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const keep = all[0];
      for (const d of all.slice(1)) {
        await db.$transaction([
          db.contact.updateMany({ where: { accountId: d.id }, data: { accountId: keep.id } }),
          db.opportunity.updateMany({ where: { accountId: d.id }, data: { accountId: keep.id } }),
          db.note.updateMany({ where: { accountId: d.id }, data: { accountId: keep.id } }),
          db.task.updateMany({ where: { accountId: d.id }, data: { accountId: keep.id } }),
          db.signal.updateMany({ where: { accountId: d.id }, data: { accountId: keep.id } }),
          db.account.update({ where: { id: d.id }, data: { mergedIntoId: keep.id, domain: null, pipelineStatus: "done", stage: "DISQUALIFIED", disqualifyReason: `Merged into ${keep.name}` } }),
        ]);
        await logEvent(ctx, { accountId: d.id, stage: S, step: "clean_normalize.dedupe_accounts", outcome: "info", reason: `Merged into ${keep.id} (same domain ${domain})` });
      }
      if (keep.id !== account.id) throw new StopRun(`Merged into ${keep.name}`);
    }
  }

  const name = normalizeCompanyName(account.name);
  const country = normalizeCountry(account.country) ?? account.country;
  account = await db.account.update({ where: { id: account.id }, data: { name, domain, country, industry: account.industry?.trim().toLowerCase() ?? null } });
  await logEvent(ctx, { accountId: account.id, stage: S, step: "clean_normalize.normalize_account", outcome: "pass", reason: `${name} · ${domain ?? "no domain"}` });

  // People: standardize, validate formats, merge duplicates.
  const contacts = await db.contact.findMany({ where: { accountId: account.id, mergedIntoId: null }, orderBy: { createdAt: "asc" } });
  const seenEmail = new Map<string, string>();
  const seenName = new Map<string, string>();
  for (const c of contacts) {
    const email = normalizeEmail(c.email);
    const nameKey = c.fullName.trim().toLowerCase().replace(/\s+/g, " ");
    const dupeOf = (email && seenEmail.get(email)) || seenName.get(nameKey);
    if (dupeOf) {
      await db.contact.update({ where: { id: c.id }, data: { mergedIntoId: dupeOf, state: "do_not_contact" } });
      await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "clean_normalize.dedupe_people", outcome: "info", reason: `Duplicate of ${dupeOf}` });
      continue;
    }
    if (email) seenEmail.set(email, c.id);
    seenName.set(nameKey, c.id);

    const title = standardizeTitle(c.title);
    const phone = c.phone ? normalizePhone(c.phone) : null;
    await db.contact.update({
      where: { id: c.id },
      data: {
        email,
        phone: phone ?? c.phone,
        titleNormalized: title,
        function: inferFunction(title),
        seniority: inferSeniority(title),
        linkedinUrl: normalizeLinkedin(c.linkedinUrl) ?? c.linkedinUrl,
        fullName: c.fullName.trim().replace(/\s+/g, " "),
      },
    });
    if (email && !isValidEmail(email)) {
      await setContactField(c.id, "email", { value: email, status: "invalid", source: "format_check" });
      await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "clean_normalize.validate_email_format", outcome: "block", reason: `Malformed email "${email}"` });
    }
    if (c.phone && !phone) {
      await setContactField(c.id, "phone", { value: c.phone, status: "invalid", source: "format_check" });
      await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "clean_normalize.validate_email_format", outcome: "info", reason: `Malformed phone "${c.phone}"` });
    }
  }
  return account;
}

// ───────────────────────── Stage 3 ─────────────────────────

export async function s03FitTier(account: Account, ctx: RunContext): Promise<Account> {
  const S = 3;
  const [openOpp, lastLost] = await Promise.all([
    db.opportunity.findFirst({ where: { accountId: account.id, stage: { notIn: ["won", "lost"] } } }),
    db.opportunity.findFirst({ where: { accountId: account.id, stage: "lost" }, orderBy: { closedAt: "desc" } }),
  ]);
  const ex = exclusionGate({
    relationship: account.relationship,
    doNotContact: account.doNotContact,
    openOpportunity: Boolean(openOpp),
    lastLostAt: lastLost?.closedAt ?? null,
    now: ctx.now,
  });
  await logEvent(ctx, { accountId: account.id, stage: S, step: "fit_tier.exclusions", outcome: ex.pass ? "pass" : "block", reason: ex.reason });
  if (!ex.pass) {
    const stage = account.relationship === "customer" ? "CUSTOMER" : openOpp ? "OPPORTUNITY" : "DISQUALIFIED";
    await db.account.update({ where: { id: account.id }, data: { stage, disqualifyReason: ex.reason } });
    throw new StopRun(ex.reason);
  }

  // Hard targeting rules from the seller pack, after the gap fill has had its chance.
  const must = mustHaveGate(account);
  await logEvent(ctx, { accountId: account.id, stage: S, step: "fit_tier.targeting_rules", outcome: must.pass ? "pass" : "block", reason: must.reason });
  if (!must.pass) {
    if (must.unknown) {
      await db.account.update({ where: { id: account.id }, data: { disqualifyReason: must.reason } });
    } else {
      await db.account.update({ where: { id: account.id }, data: { stage: "DISQUALIFIED", disqualifyReason: must.reason } });
    }
    throw new StopRun(must.reason);
  }
  // Newer data now meets the rules: lift an earlier targeting stop.
  if (account.disqualifyReason && /^(Outside target countries|Too small|Can't confirm)/.test(account.disqualifyReason)) {
    account = await db.account.update({ where: { id: account.id }, data: { disqualifyReason: null, ...(account.stage === "DISQUALIFIED" ? { stage: "UNAWARE" } : {}) } });
  }

  const fit = scoreFit(account);
  const floor = fitFloorGate(fit.fit);
  const useCase = pickUseCase(account.industry, null, seller());
  await logEvent(ctx, {
    accountId: account.id, stage: S, step: "fit_tier.company_fit", outcome: "info",
    reason: `Fit ${fit.fit ?? "n/a"} for ${seller().name} (coverage ${Math.round(fit.coverage * 100)}%)${useCase ? ` · lead use case: ${useCase.replace(/_/g, " ")}` : ""}`,
    data: { components: fit.components.map((c) => ({ key: c.key, points: c.points, max: c.max, reason: c.reason })) },
  });
  await logEvent(ctx, { accountId: account.id, stage: S, step: "fit_tier.fit_floor", outcome: floor.pass ? "pass" : "block", reason: floor.reason });
  if (!floor.pass) {
    await db.account.update({ where: { id: account.id }, data: { fitScore: fit.fit, fitReasons: fit.reasons, useCase, stage: "DISQUALIFIED", disqualifyReason: floor.reason } });
    throw new StopRun(floor.reason);
  }

  // Firmographic fields came from the import: one credible source → probable.
  for (const f of ["industry", "employees", "country"] as const) {
    const v = account[f];
    await setAccountField(account.id, f, { value: v == null ? null : String(v), status: v == null ? "unknown" : "probable" });
  }
  const states = await db.fieldState.findMany({ where: { accountId: account.id } });
  const confidence = dataConfidence(states.map((s) => s.status), fit.coverage);
  const intent = await ctx.adapters.intent.intent(account.domain ?? account.name);
  const fitValue = fit.fit ?? 50; // unknown firmographics: neutral fit, low confidence carries the gap
  // Tier follows the fit score (so weekly data updates can move it) unless set by hand.
  const bySize = seller().icp.tierBySize;
  const sizeTier = bySize && account.employees != null ? (account.employees >= bySize.T1 ? "T1" : account.employees >= bySize.T2 ? "T2" : "T3") : null;
  const tier = account.tierLocked && account.tier ? account.tier : sizeTier ?? tierFor(fitValue);
  const pr = researchPriority(fitValue, confidence, intent.score);

  if (intent.score > 0) {
    const recent = await db.signal.findFirst({ where: { accountId: account.id, type: "intent_surge", occurredAt: { gte: new Date(ctx.now.getTime() - 7 * 86_400_000) } } });
    if (!recent && intent.score >= CONFIG.intent.surgeThreshold) {
      await db.signal.create({ data: { accountId: account.id, type: "intent_surge", points: CONFIG.engagement.points.intent_surge, anonymous: true, source: "intent_provider", detail: intent.topics.join(", ") || "category intent" } });
    }
  }

  account = await db.account.update({
    where: { id: account.id },
    data: { fitScore: fit.fit, fitReasons: fit.reasons, useCase, dataConfidence: confidence, tier, intentScore: intent.score, researchPriority: pr.priority, scoredAt: ctx.now },
  });
  await logEvent(ctx, { accountId: account.id, stage: S, step: "fit_tier.research_priority", outcome: "pass", reason: `${tier} · priority ${pr.priority} (score ${pr.score}, confidence ${confidence}, intent ${intent.score})` });
  return account;
}

// ───────────────────────── Stage 4 ─────────────────────────

export async function s04Identity(account: Account, ctx: RunContext): Promise<Account> {
  const S = 4;
  const contacts = await db.contact.findMany({ where: { accountId: account.id, mergedIntoId: null, state: { notIn: ["suppressed", "do_not_contact", "handed_off"] } } });
  for (const c of contacts) {
    const fields = await contactFields(c.id);
    const statuses: Record<string, FieldStatus> = {};

    // Re-runs (weekly imports) only re-check people whose data is new or changed.
    const core = [fields.email?.status, fields.title?.status, fields.company?.status];
    if (c.identityConfidence != null && !core.includes("unknown") && !(fields.title?.observedAt && isStale(fields.title.observedAt, "title", ctx.now))) {
      continue;
    }

    // Freshness: a title older than its limit is stale before anything is trusted.
    const titleObserved = fields.title?.observedAt ?? null;
    if (c.titleNormalized && isStale(titleObserved, "title", ctx.now)) {
      await setContactField(c.id, "title", { status: "stale" });
      await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "identity.freshness_check", outcome: "info", reason: `Title last seen ${titleObserved?.toISOString().slice(0, 10)} — stale` });
    }

    if (!account.domain) {
      await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "identity.current_role_check", outcome: "block", reason: "Company domain unknown — cannot verify" });
      continue;
    }

    await charge(account.id, account.tier, "lookup", CONFIG.costsUsd.providerCheck, `Role check ${c.fullName}`, S);
    const p = await ctx.adapters.provider.lookupPerson({ fullName: c.fullName, domain: account.domain, email: c.email, title: c.titleNormalized });

    let companyStatus: FieldStatus = "unknown";
    let titleStatus: FieldStatus = fields.title?.status === "stale" ? "stale" : "unknown";
    let title = c.titleNormalized;
    if (p) {
      companyStatus = p.companyDomain === account.domain ? "verified" : "conflicting";
      if (p.title && title) titleStatus = p.title.toLowerCase() === title.toLowerCase() ? "verified" : "conflicting";
      else if (p.title && !title) {
        title = standardizeTitle(p.title);
        titleStatus = "probable";
      }
    }
    await logEvent(ctx, {
      accountId: account.id, contactId: c.id, stage: S, step: "identity.current_role_check",
      outcome: companyStatus === "conflicting" || titleStatus === "conflicting" ? "block" : "pass",
      reason: !p ? "Provider has no record" : companyStatus === "conflicting" ? `Provider shows employer ${p.companyDomain} — likely job change` : `Title ${titleStatus}, company ${companyStatus}`,
    });

    // One focused re-check against an independent source.
    if ((companyStatus === "conflicting" || titleStatus === "conflicting") && !fields.title?.recheckUsed) {
      await charge(account.id, account.tier, "lookup", CONFIG.costsUsd.providerCheck, `Re-check ${c.fullName}`, S);
      const r = await ctx.adapters.provider.recheckPerson({ fullName: c.fullName, domain: account.domain, email: c.email, title: c.titleNormalized });
      if (r) {
        if (companyStatus === "conflicting") companyStatus = r.companyDomain === account.domain ? "probable" : "conflicting";
        if (titleStatus === "conflicting" && r.title && title) {
          if (r.title.toLowerCase() === title.toLowerCase()) titleStatus = "probable";
          else if (p?.title && r.title.toLowerCase() === p.title.toLowerCase()) {
            title = standardizeTitle(p.title);
            titleStatus = "probable";
          }
        }
      }
      const resolved = companyStatus !== "conflicting" && titleStatus !== "conflicting";
      await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "identity.focused_recheck", outcome: resolved ? "pass" : "block", reason: resolved ? "Resolved by second source" : "Still conflicting after re-check" });
      await setContactField(c.id, "title", { status: titleStatus, recheckUsed: true });
    }

    statuses.company = companyStatus;
    statuses.title = titleStatus;
    if (title !== c.titleNormalized) await db.contact.update({ where: { id: c.id }, data: { titleNormalized: title, function: inferFunction(title), seniority: inferSeniority(title) } });

    // Email ↔ company domain.
    if (fields.email?.status === "invalid") statuses.email = "invalid";
    else {
      const ed = emailDomainStatus(c.email, account.domain);
      statuses.email = ed.status;
      await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "identity.email_domain_match", outcome: ed.status === "conflicting" ? "block" : "pass", reason: ed.reason });
    }

    // Phone ↔ company country (phone is optional; a conflict is only logged).
    if (c.phone && fields.phone?.status !== "invalid") {
      statuses.phone = phoneCountryStatus(phoneCountry(c.phone), account.country);
      if (statuses.phone === "conflicting") await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "identity.phone_country_check", outcome: "info", reason: `Phone country ${phoneCountry(c.phone)} ≠ company ${account.country}` });
    }

    // LinkedIn: matched against the provider record, never scraped.
    if (c.linkedinUrl) statuses.linkedin = p?.linkedinUrl && normalizeLinkedin(p.linkedinUrl) === normalizeLinkedin(c.linkedinUrl) ? "probable" : "unknown";

    const persist: [string, FieldStatus, string | null][] = [
      ["company", statuses.company, p?.companyDomain ?? account.domain],
      ["title", statuses.title, title],
      ["email", statuses.email, c.email],
    ];
    if (statuses.phone) persist.push(["phone", statuses.phone, c.phone]);
    if (statuses.linkedin) persist.push(["linkedin", statuses.linkedin, c.linkedinUrl]);
    for (const [field, status, value] of persist) {
      await setContactField(c.id, field, { status, value, source: p?.source ?? "provider", observedAt: field === "title" && p ? p.observedAt : undefined });
    }

    const conf = identityConfidence([statuses.email, statuses.title, statuses.company]);
    await db.contact.update({ where: { id: c.id }, data: { identityConfidence: conf, country: c.country ?? account.country } });
    const conflict = [statuses.email, statuses.title, statuses.company].includes("conflicting");
    await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: S, step: "identity.identity_confidence", outcome: conflict ? "block" : "pass", reason: `Identity confidence ${conf}${conflict ? " — conflict, human review" : ""}` });
    if (conflict) {
      await openReview({
        type: "identity_conflict", stage: S, accountId: account.id, contactId: c.id,
        reason: `${c.fullName}: ${Object.entries(statuses).filter(([, s]) => s === "conflicting").map(([f]) => f).join(", ")} conflicting${emailDomain(c.email) && (CONFIG.personalDomains as readonly string[]).includes(emailDomain(c.email)!) ? " (personal email)" : ""}`,
        payload: { statuses, providerEmployer: p?.companyDomain ?? null, providerTitle: p?.title ?? null },
      });
    }
  }
  return account;
}
