// "What we know": the company's research as a reader needs it. Each fact shows how strong
// its source is, when the event happened, how many independent sources back it, whether an
// email uses it, and the exact sentence it rests on. Gaps and disagreements are listed with
// a button to act on each.

import Link from "next/link";
import type { Evidence, FieldStatus } from "@prisma/client";
import { Check, FileText, Flag, Pencil, Search, Sparkles, Mail } from "lucide-react";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { independentReports } from "@/lib/pipeline/gates";
import { ensurePrecision } from "@/lib/research/backfill";
import { TIER_LABEL, confidenceWord } from "@/lib/research/precision";
import type { SellerProfile } from "@/lib/seller/types";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/client";
import { Badge, Card, Empty, FieldBadge, ago, date } from "@/components/ui";
import { correctFactAction, flagFactAction } from "../../actions";
import { checkFactAction, keepFactAction, researchQuestionAction } from "./research-actions";

const TIER_COLOR: Record<string, string> = { team: "var(--success)", official: "var(--success)", provider: "var(--success)", press: "var(--info)", news: "var(--info)", company_site: "var(--muted)", careers: "var(--muted)", review_site: "var(--muted)", web: "var(--warning)", mock: "var(--muted)" };
const confColor = (c: number) => (c >= 75 ? "var(--success)" : c >= 50 ? "var(--info)" : "var(--warning)");
const monthYear = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const groupKey = (e: Evidence) => `${e.key}|${(e.value ?? e.claim).toLowerCase()}`;

export async function ResearchSummary({ account, sp, unknowns, usedInEmail }: {
  account: { id: string; name: string; domain: string | null };
  sp: SellerProfile;
  unknowns: string[];
  usedInEmail: Set<string>;
}) {
  await ensurePrecision(account.id, account.domain);
  const all = await db.evidence.findMany({ where: { accountId: account.id, supersededById: null, flagged: false }, orderBy: [{ confidence: "desc" }, { publishedAt: "desc" }] });
  const label = (key: string) => sp.researchQuestions.find((q) => q.key === key)?.label ?? ({ website: "Official website", firmographics: "Industry, size, country", negative: "Negative news", trigger: "Buying trigger", investigation: "Investigation" } as Record<string, string>)[key] ?? key.replace(/[_:]/g, " ");
  const isTrigger = (key: string) => key === "trigger" || sp.researchQuestions.some((q) => q.key === key && q.trigger);

  // Independent sources per fact (copies of one story count once).
  const groups = new Map<string, Evidence[]>();
  for (const e of all) groups.set(groupKey(e), [...(groups.get(groupKey(e)) ?? []), e]);
  const reportsOf = (e: Evidence) => independentReports(groups.get(groupKey(e)) ?? [e]);

  const usable = all.filter((e) => !e.isNegative && (e.status === "verified" || e.status === "probable"));
  const conflicts = all.filter((e) => e.status === "conflicting");
  const verified = usable.filter((e) => e.status === "verified").length;
  const avg = usable.length ? Math.round(usable.reduce((s, e) => s + (e.confidence ?? 0), 0) / usable.length) : 0;
  const level = verified >= 2 && avg >= 65 && unknowns.length <= 1 ? "Strong" : usable.length >= 3 ? "Fair" : "Thin";
  const window = CONFIG.readiness.triggerWindowDays * 86_400_000;
  const whyNow = usable.find((e) => isTrigger(e.key) && Date.now() - e.publishedAt.getTime() <= window);

  // One card per fact; a second source for the same fact shows as "2 sources", not twice.
  const seen = new Set<string>();
  const shown = all.filter((e) => e.status !== "conflicting" && e.status !== "invalid").filter((e) => (seen.has(groupKey(e)) ? false : (seen.add(groupKey(e)), true)));
  const sections = [
    { title: "Buying triggers", items: shown.filter((e) => !e.isNegative && isTrigger(e.key)) },
    { title: "The company and how it works", items: shown.filter((e) => !e.isNegative && !isTrigger(e.key)) },
    { title: "Risks", items: shown.filter((e) => e.isNegative) },
  ].filter((s) => s.items.length);

  if (!all.length && !unknowns.length) {
    return (
      <Card title="What we know">
        <Empty icon={<FileText size={20} />} title="No research yet" sub="Run the pipeline to research this company. Every fact will show its source sentence and how strong the source is." />
      </Card>
    );
  }

  return (
    <Card
      title="What we know"
      sub={<>Every fact rests on a sentence copied from its source and checked by code. <Link href={`/accounts/${account.id}?tab=research`} className="hover:underline">How we found this</Link></>}
      action={<span className={`rs-level rs-${level.toLowerCase()}`} title="Strong: at least 2 verified facts, average confidence 65+, at most 1 open question">{level}</span>}
    >
      <div className="rs-stats">
        <span><b className="tnum">{usable.length}</b> fact{usable.length === 1 ? "" : "s"}</span>
        <span><b className="tnum">{verified}</b> verified</span>
        <span><b className="tnum">{usable.length ? avg : "—"}</b> average confidence</span>
        <span><b className="tnum">{unknowns.length}</b> open question{unknowns.length === 1 ? "" : "s"}</span>
        {conflicts.length > 0 && <span className="rs-warn"><b className="tnum">{new Set(conflicts.map((c) => c.key)).size}</b> disagreement{new Set(conflicts.map((c) => c.key)).size === 1 ? "" : "s"}</span>}
      </div>

      {whyNow && (
        <div className="rs-why">
          <Sparkles size={15} aria-hidden />
          <span><b>Why now:</b> {whyNow.claim} <span className="muted">· {whyNow.eventDate ? monthYear(whyNow.eventDate) : date(whyNow.publishedAt)} · confidence {whyNow.confidence ?? "—"}</span></span>
        </div>
      )}

      {conflicts.length > 0 && (
        <section className="rs-sec">
          <h3 className="rs-h">Sources disagree</h3>
          {[...new Set(conflicts.map((c) => c.key))].map((key) => (
            <div key={key} className="rs-conflict">
              <div className="rs-ckey">{label(key)}</div>
              <div className="rs-cgrid">
                {conflicts.filter((c) => c.key === key).map((c) => (
                  <div key={c.id} className="rs-cside">
                    <p>{c.claim}</p>
                    <p className="rs-meta"><Badge color={TIER_COLOR[c.sourceType] ?? "var(--muted)"}>{TIER_LABEL[c.sourceType] ?? c.sourceType}</Badge> <a href={c.sourceUrl} target="_blank" rel="noreferrer">{c.publisher ?? c.sourceUrl}</a> · {date(c.publishedAt)}</p>
                    <ActionButton action={keepFactAction.bind(null, c.id)} className="btn btn-secondary btn-sm" confirm="Keep this version? The other is retired and never used.">Keep this one</ActionButton>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {sections.map((s) => (
        <section key={s.title} className="rs-sec">
          <h3 className="rs-h">{s.title} <span className="muted tnum">{s.items.length}</span></h3>
          <ul className="grid gap-2.5">
            {s.items.map((e) => <FactRow key={e.id} e={e} label={label(e.key)} reports={reportsOf(e)} used={usedInEmail.has(e.id) || (groups.get(groupKey(e)) ?? []).some((x) => usedInEmail.has(x.id))} />)}
          </ul>
        </section>
      ))}

      {unknowns.length > 0 && (
        <section className="rs-sec">
          <h3 className="rs-h">Still unknown</h3>
          <ul className="rs-gaps">
            {unknowns.map((k) => (
              <li key={k}>
                <span>{label(k)}</span>
                <ActionButton action={researchQuestionAction.bind(null, account.id, k)} className="btn btn-ghost btn-sm" title="Search this question again now (uses the company's research budget)"><Search size={13} /> Research this</ActionButton>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Card>
  );
}

function FactRow({ e, label, reports, used }: { e: Evidence; label: string; reports: number; used: boolean }) {
  const c = e.confidence ?? 0;
  const when = e.eventDate ? `Happened ${monthYear(e.eventDate)}` : e.undated ? "No date on the page" : `Published ${date(e.publishedAt)}`;
  const host = e.publisher ?? (() => { try { return new URL(e.sourceUrl).hostname.replace(/^www\./, ""); } catch { return e.sourceUrl; } })();
  return (
    <li className={`ev ev-${e.status} rs-fact`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-[12rem] flex-1 text-sm rs-claim">{e.claim}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="rs-conf" title={`Confidence ${c} of 100: source strength, independent sources, page read in full, exact quote and age`}>
            <span className="rs-bar"><span style={{ width: `${c}%`, background: confColor(c) }} /></span>
            <span className="tnum">{confidenceWord(c)} {c}</span>
          </span>
          <FieldBadge status={e.status as FieldStatus} />
          <ActionButton action={checkFactAction.bind(null, e.id)} className={`btn btn-ghost btn-sm${e.checkedAt ? " rs-checked" : ""}`} title={e.checkedAt ? `Checked by ${e.checkedBy ?? "the team"} · click to undo` : "Looks right: you checked it against the source"}><Check size={13} /></ActionButton>
          <Modal trigger={<Pencil size={13} />} triggerClass="btn btn-ghost btn-sm" title="Correct this fact" eyebrow="Edit fact">
            <ActionForm action={correctFactAction} className="grid gap-3">
              <input type="hidden" name="evidenceId" value={e.id} />
              <p className="muted text-xs">Now: &ldquo;{e.claim}&rdquo;</p>
              <textarea name="claim" className="glass-textarea" defaultValue={e.claim} required aria-label="Corrected fact" />
              <input name="sourceUrl" className="glass-input" placeholder="Source link (optional), e.g. https://company.com/news/…" aria-label="Source link" />
              <p className="muted text-xs">The correction is marked as checked by the team and keeps the original date. Unsent drafts that cited the old version are withdrawn.</p>
              <div className="flex justify-end"><SubmitButton className="btn btn-primary btn-sm">Save correction</SubmitButton></div>
            </ActionForm>
          </Modal>
          <Modal trigger={<Flag size={13} />} triggerClass="btn btn-ghost btn-sm" title="Mark this fact as wrong" eyebrow="Feedback">
            <ActionForm action={flagFactAction} className="grid gap-3">
              <input type="hidden" name="evidenceId" value={e.id} />
              <p className="secondary text-sm">&ldquo;{e.claim}&rdquo;</p>
              <p className="muted text-xs">It stops being used at once, unsent drafts that cite it are withdrawn, and it counts against the engine that found it.</p>
              <textarea name="reason" className="glass-textarea" placeholder="What is wrong? e.g. different company with a similar name, outdated, misread" required />
              <div className="flex justify-end"><SubmitButton className="btn btn-primary btn-sm">Mark wrong</SubmitButton></div>
            </ActionForm>
          </Modal>
        </span>
      </div>
      <div className="ev-meta">
        <span className="ev-key">{label}</span>
        <Badge color={TIER_COLOR[e.sourceType] ?? "var(--muted)"}>{TIER_LABEL[e.sourceType] ?? e.sourceType}</Badge>
        {e.sourceType === "team" ? <span>{e.publisher ? `Corrected by ${e.publisher.split("@")[0]}` : "Corrected by the team"}</span> : <a href={e.sourceUrl} target="_blank" rel="noreferrer">{host}</a>}
        <span title={e.pageDate && e.eventDate ? `Page published ${date(e.pageDate)}` : undefined}>{when} · {ago(e.publishedAt)}</span>
        <span>{reports >= 2 ? `${reports} independent sources` : "1 source"}</span>
        {!e.fullText && e.sourceType !== "team" && <span title="Only the search snippet could be read, not the full page">snippet only</span>}
        {e.checkedAt && <span className="rs-used"><Check size={11} aria-hidden /> Checked by {e.checkedBy ?? "the team"}</span>}
        {used && <span className="rs-used"><Mail size={11} aria-hidden /> Used in an email</span>}
      </div>
      {e.quote && <Quote quote={e.quote} passage={e.passage} url={e.sourceUrl} />}
    </li>
  );
}

/** The sentence the fact rests on, highlighted inside its paragraph. */
function Quote({ quote, passage, url }: { quote: string; passage: string | null; url: string }) {
  const probe = quote.slice(0, 40).toLowerCase();
  const at = passage ? passage.toLowerCase().indexOf(probe) : -1;
  return (
    <details className="rs-quote">
      <summary>Show the source sentence</summary>
      <blockquote>
        {passage && at >= 0 ? (
          <>…{passage.slice(Math.max(0, at - 220), at)}<mark>{passage.slice(at, at + quote.length)}</mark>{passage.slice(at + quote.length, at + quote.length + 220)}…</>
        ) : <mark>{quote}</mark>}
      </blockquote>
      <a href={url} target="_blank" rel="noreferrer" className="rs-open">Open the source</a>
    </details>
  );
}
