import { Building2, ExternalLink, FilePlus2, RefreshCw, Trash2 } from "lucide-react";
import type { FieldStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/client";
import { Card, FieldBadge, date } from "@/components/ui";
import { CATEGORY_LABEL, CATEGORY_ORDER, type TechCategory } from "@/lib/profile/catalog";
import { HEALTH_LABEL, HEALTH_TONE, bestPerYear, type HealthLabel } from "@/lib/profile/health";
import { FX_TO_USD, formatAmount, formatUsd } from "@/lib/profile/money";
import { addFinancialRecordAction, refreshProfileAction, removeFinancialRecordAction } from "./profile-actions";

const SOURCE_LABEL: Record<string, string> = { website: "Website", job_post: "Job post", case_study: "Company site", press: "Press", provider: "BuiltWith", import: "Import" };
const STAKEHOLDER_LABEL: Record<string, string> = { board_member: "Board", independent_director: "Independent director", adviser: "Adviser", investor: "Investor", executive: "Executive director" };
const ROUND_LABEL = (s: string) => s.replace(/^series_(\w)$/, (_, l: string) => `Series ${l.toUpperCase()}`).replace("pre_seed", "Pre-seed").replace("private_equity", "Private equity").replace(/^\w/, (c) => c.toUpperCase());
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

function Sources({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-x-2">
      {urls.slice(0, 3).map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs">{host(u)}<ExternalLink size={10} aria-hidden /></a>)}
    </span>
  );
}

/** Revenue and profit by year, funding, technology stack and board, each with its source and status. */
export async function ProfileCard({ accountId }: { accountId: string }) {
  const [account, fins, rounds, techs, board] = await Promise.all([
    db.account.findUniqueOrThrow({ where: { id: accountId }, select: { id: true, name: true, tier: true, employees: true, financialHealth: true, financialNote: true, profileUpdatedAt: true, technologies: true } }),
    db.companyFinancial.findMany({ where: { accountId }, orderBy: [{ fiscalYear: "desc" }] }),
    db.fundingRound.findMany({ where: { accountId }, orderBy: [{ announcedAt: "desc" }] }),
    db.techUse.findMany({ where: { accountId }, orderBy: [{ name: "asc" }] }),
    db.contact.findMany({ where: { accountId, mergedIntoId: null, OR: [{ stakeholderType: { not: "executive" } }, { discoveredBy: "board_research" }] }, orderBy: [{ stakeholderType: "asc" }, { fullName: "asc" }] }),
  ]);
  const years = bestPerYear(fins.map((f) => ({ ...f, fiscalYear: f.fiscalYear })));
  const rowFor = (fy: string, source: string) => fins.find((f) => f.fiscalYear === fy && f.source === source)!;
  const others = (fy: string, source: string) => fins.filter((f) => f.fiscalYear === fy && f.source !== source);
  const health = (account.financialHealth ?? "unknown") as HealthLabel;
  // Imported technologies that research hasn't catalogued yet still show (as "Import").
  const imported = account.technologies.filter((t) => !techs.some((x) => x.name.toLowerCase() === t.toLowerCase()));
  const byCat = new Map<string, { name: string; sources: string[]; detail: string | null; urls: string[] }[]>();
  for (const t of techs) byCat.set(t.category, [...(byCat.get(t.category) ?? []), { name: t.name, sources: t.sources, detail: t.detail, urls: t.evidenceUrls }]);
  if (imported.length) byCat.set("other", [...(byCat.get("other") ?? []), ...imported.map((n) => ({ name: n, sources: ["import"], detail: "From the uploaded file", urls: [] }))]);
  const cats = CATEGORY_ORDER.filter((c) => byCat.has(c));
  const latestRound = rounds[0];
  const totalUsd = rounds.reduce((t, r) => t + (r.amountUsd ?? 0), 0);

  return (
    <Card
      id="profile"
      title={<span className="inline-flex items-center gap-2"><Building2 size={16} aria-hidden /> Company profile</span>}
      sub={account.profileUpdatedAt ? `Researched ${date(account.profileUpdatedAt)} · every figure links to its source; filed records outrank the web` : "Not researched yet: runs with the pipeline, or refresh now"}
      action={
        <span className="flex flex-wrap gap-2">
          <Modal trigger={<><FilePlus2 size={14} /> Add financial record</>} triggerClass="btn btn-secondary btn-sm" title="Add a financial record" eyebrow="Authentic financial data">
            <ActionForm action={addFinancialRecordAction} className="grid gap-3">
              <input type="hidden" name="accountId" value={account.id} />
              <p className="muted text-xs">Figures from an audited annual report, a filing obtained from the company registry, or a licensed data provider. Saved as verified, with your name and the document, and preferred over web figures for the same year.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1 text-xs">Fiscal year<input name="fiscalYear" className="glass-input" placeholder="FY2024-25" required /></label>
                <label className="grid gap-1 text-xs">Currency<select name="currency" className="glass-input" defaultValue="INR">{Object.keys(FX_TO_USD).map((c) => <option key={c}>{c}</option>)}</select></label>
                <label className="grid gap-1 text-xs">Figures are in<select name="unit" className="glass-input" defaultValue="crore">{["units", "thousand", "lakh", "million", "crore", "billion"].map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
                <label className="grid gap-1 text-xs">Revenue<input name="revenue" inputMode="decimal" className="glass-input" placeholder="4,520" /></label>
                <label className="grid gap-1 text-xs">Net profit (− for loss)<input name="netProfit" inputMode="decimal" className="glass-input" placeholder="410" /></label>
                <label className="grid gap-1 text-xs">EBITDA<input name="ebitda" inputMode="decimal" className="glass-input" /></label>
                <label className="grid gap-1 text-xs">Total assets<input name="totalAssets" inputMode="decimal" className="glass-input" /></label>
                <label className="grid gap-1 text-xs">Total debt<input name="totalDebt" inputMode="decimal" className="glass-input" /></label>
                <label className="grid gap-1 text-xs">Period end<input name="periodEnd" type="date" className="glass-input" /></label>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1 text-xs">Source<select name="kind" className="glass-input" defaultValue="filing"><option value="filing">Filing or annual report</option><option value="provider">Licensed data provider</option></select></label>
                <label className="grid gap-1 text-xs sm:col-span-2">Document or provider<input name="document" className="glass-input" placeholder="Audited annual report FY2024-25 / MCA AOC-4 filing / provider name" required /></label>
              </div>
              <label className="grid gap-1 text-xs">Link or reference (optional)<input name="reference" className="glass-input" placeholder="https://… or filing SRN" /></label>
              <label className="grid gap-1 text-xs">Note (optional)<input name="note" className="glass-input" placeholder="e.g. consolidated figures" /></label>
              <div className="flex justify-end"><SubmitButton className="btn btn-primary btn-sm">Save record</SubmitButton></div>
            </ActionForm>
          </Modal>
          <ActionButton action={refreshProfileAction.bind(null, account.id)} className="btn btn-secondary btn-sm" title="Search for financials, funding, technologies and the board again now (charged to this company's research budget)"><RefreshCw size={14} /> Refresh</ActionButton>
        </span>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-5">
          <section>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Revenue and profit</h3>
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: HEALTH_TONE[health].fg, background: HEALTH_TONE[health].bg }}>{HEALTH_LABEL[health]}</span>
            </div>
            {account.financialNote && health !== "unknown" && <p className="secondary mb-2 text-xs">{account.financialNote}</p>}
            {years.length === 0 ? <p className="muted text-xs">No annual figures found yet. Listed companies are found from results and filings; for private companies, add a filed record.</p> : (
              <div className="table-wrap">
                <table className="data text-xs">
                  <thead><tr><th>Year</th><th>Revenue</th><th>Net profit</th><th>Margin</th><th>Source</th></tr></thead>
                  <tbody>
                    {years.map((y) => {
                      const r = rowFor(y.fiscalYear, y.source);
                      const margin = r.revenue && r.netProfit != null ? r.netProfit / r.revenue : null;
                      const alt = others(y.fiscalYear, y.source);
                      return (
                        <tr key={r.id}>
                          <td className="font-semibold">{r.fiscalYear}</td>
                          <td className="tnum whitespace-nowrap" title={r.revenueUsd ? `≈ ${formatUsd(r.revenueUsd)}` : undefined}>{formatAmount(r.revenue, r.currency)}</td>
                          <td className="tnum whitespace-nowrap" style={{ color: r.netProfit != null && r.netProfit < 0 ? "var(--danger-strong)" : undefined }}>{formatAmount(r.netProfit, r.currency)}</td>
                          <td className="tnum">{margin == null ? "—" : `${(margin * 100).toFixed(1)}%`}</td>
                          <td>
                            <span className="flex flex-wrap items-center gap-1.5">
                              {r.source === "web" ? <FieldBadge status={r.status as FieldStatus} /> : <span className="rounded px-1.5 py-0.5 text-xs font-semibold" style={{ background: "var(--success-bg)", color: "var(--success-strong)" }}>{r.source === "filing" ? "Filed record" : "Provider"}</span>}
                              {r.source === "web" ? <Sources urls={r.sourceUrls} /> : <span className="muted" title={r.note ?? undefined}>{r.publisher}{r.addedBy ? ` · ${r.addedBy}` : ""}</span>}
                              {r.source !== "web" && <ActionButton action={removeFinancialRecordAction.bind(null, r.id)} className="btn btn-ghost btn-sm" confirm={`Remove the ${r.fiscalYear} record?`} title="Remove this record"><Trash2 size={12} /></ActionButton>}
                              {alt.length > 0 && <span className="muted" title={alt.map((a) => `${a.source}: ${formatAmount(a.revenue, a.currency)}`).join("; ")}>+{alt.length} other source{alt.length === 1 ? "" : "s"}</span>}
                            </span>
                            {r.note && r.source === "web" && <div className="muted mt-0.5" style={{ color: /check/.test(r.note) ? "var(--warning-strong)" : undefined }}>{r.note}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Funding{rounds.length > 0 && <span className="muted font-normal"> · {rounds.length} round{rounds.length === 1 ? "" : "s"}{totalUsd ? ` · ≈ ${formatUsd(totalUsd)} disclosed` : ""}{latestRound?.announcedAt ? ` · latest ${date(latestRound.announcedAt)}` : ""}</span>}</h3>
            {rounds.length === 0 ? <p className="muted text-xs">No funding rounds found{account.tier === "T3" ? " (funding is researched for T1 and T2 companies)" : ""}.</p> : (
              <ul className="grid gap-2">
                {rounds.map((r) => (
                  <li key={r.id} className="text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <b style={{ color: "var(--text-primary)" }}>{ROUND_LABEL(r.stage)}</b>
                      <span className="tnum">{r.amount != null ? formatAmount(r.amount, r.currency) : "Amount undisclosed"}</span>
                      {r.announcedAt && <span className="muted">{date(r.announcedAt)}</span>}
                      <FieldBadge status={r.status as FieldStatus} />
                      <Sources urls={r.sourceUrls} />
                    </div>
                    {r.investors.length > 0 && <div className="secondary mt-0.5">Investors: {r.investors.map((i, n) => <span key={i}>{n > 0 && ", "}{r.leadInvestors.includes(i) ? <b>{i} (lead)</b> : i}</span>)}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="grid content-start gap-5">
          <section>
            <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Technology stack{techs.length + imported.length > 0 && <span className="muted font-normal"> · {techs.length + imported.length}</span>}</h3>
            {cats.length === 0 ? <p className="muted text-xs">No technologies found yet. The website is checked for installed tools; job posts and case studies name back-office systems.</p> : (
              <dl className="grid gap-2">
                {cats.map((c) => (
                  <div key={c} className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                    <dt className="muted text-xs font-semibold">{CATEGORY_LABEL[c as TechCategory]}</dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {byCat.get(c)!.map((t) => (
                        <span key={t.name} className="rounded-md border px-1.5 py-0.5 text-xs" style={{ borderColor: "var(--border-subtle)" }} title={[t.detail, ...t.urls.slice(0, 2)].filter(Boolean).join("\n")}>
                          <span style={{ color: "var(--text-primary)" }}>{t.name}</span>
                          <span className="muted"> · {t.sources.map((s) => SOURCE_LABEL[s] ?? s).join(", ")}</span>
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Board and advisers{board.length > 0 && <span className="muted font-normal"> · {board.length}</span>}</h3>
            {board.length === 0 ? <p className="muted text-xs">No board members or advisers found{account.tier === "T3" ? " (researched for T1 and T2 companies)" : ""}.</p> : (
              <ul className="grid gap-2">
                {board.map((p) => (
                  <li key={p.id} className="text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <b style={{ color: "var(--text-primary)" }}>{p.fullName}</b>
                      <span className="secondary">{p.title}</span>
                      <span className="rounded px-1.5 py-0.5 text-xs" style={{ background: "var(--indigo-bg)", color: "var(--indigo-strong)" }}>{STAKEHOLDER_LABEL[p.stakeholderType] ?? p.stakeholderType}</span>
                    </div>
                    {p.influenceReason && <div className="muted mt-0.5">{p.influenceReason.split(". Source:")[0]}</div>}
                  </li>
                ))}
              </ul>
            )}
            {board.length > 0 && <p className="muted mt-2 text-xs">Directors and advisers are shown for context and account planning; they are never emailed by a sequence.</p>}
          </section>
        </div>
      </div>
    </Card>
  );
}
