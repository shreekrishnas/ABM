// "Recommended today" on Market signals: the client's ranked daily list, with the reasons,
// the dated signals, what changed, an estimated research cost, and Research / Snooze / Reject.

import Link from "next/link";
import { CalendarClock, ExternalLink, Play, Search, Sparkles, ThumbsDown } from "lucide-react";
import { db } from "@/lib/db";
import type { SellerProfile } from "@/lib/seller/types";
import { REJECT_REASONS, dailySettings, estimateDailyCost, istDate, type RecItem } from "@/lib/discover/recommend";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/client";
import { Card, Empty, ago } from "@/components/ui";
import { rejectRecAction, researchRecAction, runDailyNowAction, snoozeRecAction } from "./daily-actions";

/** The quote adds nothing when it says what the signal line already says. */
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const same = (a: string, b: string) => { const x = norm(a), y = norm(b); return x === y || y.includes(x) || x.includes(y); };
const short = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "undated");

export async function RecommendedToday({ p, live }: { p: SellerProfile; live: boolean }) {
  const today = istDate();
  const row = (await db.dailyRecommendation.findUnique({ where: { sellerId_date: { sellerId: p.id, date: today } } }))
    ?? (await db.dailyRecommendation.findFirst({ where: { sellerId: p.id }, orderBy: { date: "desc" } }));
  const s = dailySettings(p.daily);
  const est = estimateDailyCost(p, s);
  const items = ((row?.items ?? []) as unknown as RecItem[]);
  const summary = (row?.summary ?? {}) as { spentUsd?: number; stopped?: string | null; jobs?: { read: number; found: number; matched: number }; recheck?: { checked: number; newFacts: number }; news?: { suggestions?: number; events?: number }; stand_ins?: boolean };
  const open = items.filter((i) => !i.decided);

  return (
    <Card
      id="recommended"
      title={<span className="inline-flex items-center gap-2"><Sparkles size={18} /> Recommended today</span>}
      sub={row ? <>{row.date === today ? "Built this morning" : `Last built ${row.date}`} · {open.length} of {items.length} still to decide{summary.stand_ins ? " · sample data, stand-in services" : ""}</> : live ? "Built every weekday at 7:30 AM IST from the news, careers job lists and re-checks of your top accounts." : "Switched off: live research is off for this client."}
      action={live ? <ActionButton action={runDailyNowAction} className="btn btn-secondary btn-sm" confirm={`Build today's list again now? Estimated cost up to $${est.usd.toFixed(2)}.`} title="Runs today's sources again and rebuilds the list"><Play size={14} /> Run now</ActionButton> : undefined}
    >
      <div className="rt-meta">
        <span title={est.lines.join("\n")}><CalendarClock size={13} aria-hidden /> Estimated about ${est.usd.toFixed(2)} a day · limit ${s.maxUsd.toFixed(2)}</span>
        {summary.spentUsd != null && <span>Spent ${summary.spentUsd.toFixed(2)} on the last run</span>}
        {summary.jobs && <span>Careers sites read {summary.jobs.read} · with a job list {summary.jobs.found} · matching jobs {summary.jobs.matched}</span>}
        {summary.recheck && <span>Re-checked {summary.recheck.checked} · new facts {summary.recheck.newFacts}</span>}
        {summary.stopped && <span className="rt-warn">{summary.stopped}</span>}
        <Link href="/brain?s=daily" className="rt-link">Sources and limits</Link>
      </div>

      {!items.length ? (
        <Empty icon={<Sparkles size={20} />} title={row ? "Nothing to recommend today" : "No list yet"} sub={row ? "No new company or fresh signal passed the checks. The next run is tomorrow morning." : live ? "The first list appears after tomorrow morning's run, or press Run now." : "Turn on live research for this client in Super Admin → client settings."} />
      ) : (
        <ol className="rt-list">
          {items.map((i, n) => (
            <li key={i.id} className={`rt-item${i.decided ? " done" : ""}`}>
              <div className="rt-rank tnum">{n + 1}</div>
              <div className="rt-body">
                <div className="rt-head">
                  {i.kind === "account" ? <Link href={`/accounts/${i.id}`} className="rt-name">{i.name}</Link> : <span className="rt-name">{i.name}</span>}
                  <span className={`rt-kind ${i.kind}`}>{i.kind === "account" ? "Held account" : "New company"}</span>
                  <span className="rt-facts">{[i.industry, i.employees ? `${i.employees.toLocaleString()} employees` : null, i.country, i.domain].filter(Boolean).join(" · ")}</span>
                  <span className="rt-score tnum" title="Fit, intent, how recent the newest signal is, and anything new since yesterday">Score {i.score}</span>
                </div>
                <p className="rt-why">{i.why}</p>
                <ul className="rt-signals">
                  {i.signals.map((g, k) => (
                    <li key={k}>
                      <span className="rt-sk">{g.kind}</span>
                      <span className="rt-st">{g.text}</span>
                      <span className="muted">· {short(g.at)}{g.publisher ? ` · ${g.publisher}` : ""}</span>
                      {g.url && <a href={g.url} target="_blank" rel="noreferrer" aria-label="Open the source"><ExternalLink size={12} /></a>}
                      {g.quote && !same(g.quote, g.text) && <q className="rt-q">{g.quote}</q>}
                    </li>
                  ))}
                </ul>
                {i.changed.length > 0 && <p className="rt-changed"><b>What changed:</b> {i.changed.slice(0, 3).join("; ")}</p>}
                <div className="rt-actions">
                  {i.decided ? <span className="rt-decided">{i.decided[0].toUpperCase() + i.decided.slice(1)}</span> : (
                    <>
                      <ActionButton action={researchRecAction.bind(null, i.kind, i.id)} className="btn btn-primary btn-sm" title={`Estimated research cost about $${i.estCostUsd.toFixed(2)}`} confirm={i.kind === "suggestion" ? `Add ${i.name} and research it? Estimated about $${i.estCostUsd.toFixed(2)}.` : undefined}><Search size={13} /> Research <span className="rt-cost">~${i.estCostUsd.toFixed(2)}</span></ActionButton>
                      <ActionButton action={snoozeRecAction.bind(null, i.kind, i.id, 7)} className="btn btn-ghost btn-sm">Snooze 7 days</ActionButton>
                      <ActionButton action={snoozeRecAction.bind(null, i.kind, i.id, 30)} className="btn btn-ghost btn-sm">30 days</ActionButton>
                      <Modal trigger={<><ThumbsDown size={13} /> Reject</>} triggerClass="btn btn-ghost btn-sm" title={`Reject ${i.name}`} eyebrow="Recommended today">
                        <ActionForm action={rejectRecAction} className="grid gap-3">
                          <input type="hidden" name="kind" value={i.kind} />
                          <input type="hidden" name="id" value={i.id} />
                          <fieldset className="grid gap-1.5">
                            <legend className="muted mb-1 text-xs">Why? Similar companies will rank lower.</legend>
                            {Object.entries(REJECT_REASONS).map(([k, label], x) => (
                              <label key={k} className="flex items-center gap-2 text-sm"><input type="radio" name="reason" value={k} defaultChecked={x === 0} /> {label}</label>
                            ))}
                          </fieldset>
                          <input name="note" className="glass-input" placeholder="Anything else (optional)" aria-label="Note" maxLength={200} />
                          <div className="flex justify-end"><SubmitButton className="btn btn-primary btn-sm">Reject</SubmitButton></div>
                        </ActionForm>
                      </Modal>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {row && <p className="muted mt-3 text-xs">List built {ago(row.createdAt)}. Nothing is researched or emailed until someone presses Research.</p>}
    </Card>
  );
}
