import { tierLabel } from "@/lib/tier-label";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { SIZES, STAGES, accountWhere, type SP } from "@/lib/accounts/filters";
import { SavedViews } from "@/components/saved-views";
import { BUILT_IN, savedViews } from "@/lib/views";
import { getMe } from "@/lib/me";
import { ArrowDown, ArrowUp, Download, RotateCcw, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { ensureSellerPacks } from "@/lib/seller";
import { Avatar } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { bulkCompaniesAction } from "@/app/actions";
import { ActiveChips, ExportTicked, FilterPanel, RefreshButton, SearchBox, SelectAllBox, type FilterDef } from "./filters";
import { PriorityMap } from "./priority-map";
import { NewCompany } from "./new-company";
import type { IntentLevel } from "@/components/v2";

export const metadata = { title: "Companies" };

const PAGE = 50;
const SORTS = {
  updated: { updatedAt: "desc" },
  name: { name: "asc" },
  employees: { employees: { sort: "desc", nulls: "last" } },
  intent: { intentScore: "desc" },
  priority: { priorityScore: { sort: "desc", nulls: "last" } },
  contacts: { contacts: { _count: "desc" } },
  added: { createdAt: "desc" },
} as const;
type SortKey = keyof typeof SORTS;

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, " ");

/** Every company in one filterable table: the way you'd filter in Apollo, with intent and research status beside it. */
export default async function CompaniesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await ensureSellerPacks();
  const sp = await searchParams;
  const sort: SortKey = (sp.sort && sp.sort in SORTS ? sp.sort : "priority") as SortKey;
  const dir = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const view: "table" | "map" = sp.view === "map" ? "map" : "table";

  // ── What to filter by: options come from the companies themselves ──
  const live = { mergedIntoId: null };
  const [industries, countries, sources, batches, campaigns, owners, techRows] = await Promise.all([
    db.account.groupBy({ by: ["industry"], where: { ...live, industry: { not: null } }, _count: true, orderBy: { _count: { industry: "desc" } }, take: 80 }),
    db.account.groupBy({ by: ["country"], where: { ...live, country: { not: null } }, _count: true, orderBy: { _count: { country: "desc" } }, take: 60 }),
    db.account.groupBy({ by: ["source"], where: live, _count: true, orderBy: { _count: { source: "desc" } }, take: 40 }),
    db.importBatch.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, filename: true }, take: 40 }),
    db.campaign.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: { status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.account.findMany({ where: { ...live, technologies: { isEmpty: false } }, select: { technologies: true }, take: 5000 }),
  ]);
  const techCount = new Map<string, number>();
  for (const r of techRows) for (const t of r.technologies) techCount.set(t, (techCount.get(t) ?? 0) + 1);
  const technologies = [...techCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 150);

  const filters: FilterDef[] = [
    { key: "industry", label: "Industry", any: "Any industry", options: industries.map((i) => ({ value: i.industry!, label: label(i.industry!), n: i._count })) },
    { key: "tech", label: "Technology", any: "Any technology", options: technologies.map(([t, n]) => ({ value: t, label: t, n })) },
    { key: "source", label: "Source", any: "Any source", options: sources.map((s) => ({ value: s.source, label: s.source, n: s._count })) },
    { key: "size", label: "Employees", any: "Any size", options: SIZES.map((s) => ({ value: s.value, label: s.label })) },
    { key: "country", label: "Location", any: "Anywhere", options: countries.map((c) => ({ value: c.country!, label: c.country!, n: c._count })) },
    { key: "campaign", label: "LinkedIn campaign", any: "Any campaign", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
    { key: "owner", label: "Owner", any: "Anyone", options: [{ value: "none", label: "No owner" }, ...owners.map((u) => ({ value: u.id, label: u.name }))] },
    { key: "tier", label: "Priority", any: "Any priority", options: ["T1", "T2", "T3"].map((t) => ({ value: t, label: tierLabel(t) })) },
    { key: "stage", label: "Status", any: "Any status", options: STAGES.map((s) => ({ value: s, label: label(s) })) },
    { key: "list", label: "Import list", any: "Any list", options: batches.map((b) => ({ value: b.id, label: b.filename })) },
  ];

  // ── The filtered list (same filter as the export) ──
  const q = sp.q?.trim();
  const minIntent = Number(sp.intent) || 0;
  const where = accountWhere(sp);
  const views = await savedViews("companies", (await getMe())?.email ?? null);

  const orderBy = (() => {
    const base = SORTS[sort] as Record<string, unknown>;
    if (!dir) return base;
    // Same shape, direction swapped; "nulls last" stays.
    const flip = (v: unknown): unknown => (typeof v === "string" ? dir : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "nulls" ? x : flip(x)])) : v);
    return flip(base);
  })() as Prisma.AccountOrderByWithRelationInput;

  const [total, rows] = await Promise.all([
    db.account.count({ where }),
    db.account.findMany({
      where, orderBy: [orderBy, { name: "asc" }], skip: (page - 1) * PAGE, take: PAGE,
      select: { id: true, name: true, domain: true, industry: true, employees: true, technologies: true, intentScore: true, priorityScore: true, tier: true, stage: true, source: true, city: true, country: true, lastImportBatchId: true, updatedAt: true, _count: { select: { contacts: { where: { mergedIntoId: null } } } } },
    }),
  ]);
  const mapRows = view === "map" ? await db.account.findMany({ where, select: { id: true, name: true, tier: true, fitScore: true, intentReading: true }, take: 300 }) : [];
  const batchName = new Map(batches.map((b) => [b.id, b.filename]));
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const chips = filters.flatMap((f) => (sp[f.key] ? [{ key: f.key, label: `${f.label}: ${f.options.find((o) => o.value === sp[f.key])?.label ?? sp[f.key]}` }] : []));
  if (minIntent > 0) chips.push({ key: "intent", label: `Intent ≥ ${minIntent}` });

  const href = (patch: SP) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/accounts${next.size ? `?${next}` : ""}`;
  };
  const Th = ({ k, children, className }: { k?: SortKey; children: React.ReactNode; className?: string }) => {
    if (!k) return <th className={className}>{children}</th>;
    const on = sort === k;
    const nextDir = on ? (dir === "asc" ? "desc" : dir === "desc" ? "asc" : k === "name" ? "desc" : "asc") : undefined;
    const showAsc = on && (dir === "asc" || (!dir && k === "name"));
    return (
      <th className={className} aria-sort={on ? (showAsc ? "ascending" : "descending") : undefined}>
        <Link href={href({ sort: k, dir: nextDir, page: undefined })} className={`dir-sort${on ? " on" : ""}`} scroll={false}>
          {children}{on && (showAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
        </Link>
      </th>
    );
  };
  const exportHref = `/accounts/export${(() => { const n = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !["page", "view", "peek"].includes(k)) as [string, string][]); return n.size ? `?${n}` : ""; })()}`;

  return (
    <div className="dir dir-grid">
      <FilterPanel filters={filters} />
      <section className="dir-main">
        <div className="dir-bar">
          <SearchBox />
          <SavedViews page="companies" builtIn={BUILT_IN.companies} views={views} />
          <span className="dir-count"><b className="tnum">{total.toLocaleString()}</b> {total === 1 ? "company" : "companies"}</span>
          <Link href="/import/upload" className="btn btn-secondary btn-sm"><Upload size={14} /> Import</Link>
          <NewCompany />
          <a href={exportHref} className="btn btn-secondary btn-sm btn-icon" title="Export these companies" aria-label="Export"><Download size={14} /></a>
          <RefreshButton />
        </div>
        <ActiveChips chips={chips} />

        {view === "map" ? (
          <div className="k-table-wrap dir-map"><PriorityMap accounts={mapRows.map((a) => ({ id: a.id, name: a.name, tier: a.tier, fit: a.fitScore, intent: a.intentReading as unknown as { score: number; level: IntentLevel; whyNow: string | null } | null }))} /></div>
        ) : (
        <ActionForm action={bulkCompaniesAction} className="dir-table-wrap">
          <div className="dir-bulk">
            <span>Ticked companies:</span>
            <SubmitButton className="btn btn-secondary btn-sm" name="op" value="research"><RotateCcw size={13} /> Re-research</SubmitButton>
            <span className="dir-bulk-g">
              <select name="ownerId" className="glass-select" aria-label="Owner for ticked companies" defaultValue=""><option value="" disabled>Owner…</option><option value="none">No owner</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              <SubmitButton className="btn btn-secondary btn-sm" name="op" value="owner">Set owner</SubmitButton>
            </span>
            <span className="dir-bulk-g">
              <select name="tier" className="glass-select" aria-label="Priority for ticked companies" defaultValue=""><option value="" disabled>Priority…</option><option value="T1">Top</option><option value="T2">Mid</option><option value="T3">Broad</option><option value="auto">Automatic</option></select>
              <SubmitButton className="btn btn-secondary btn-sm" name="op" value="priority">Set priority</SubmitButton>
            </span>
            <SubmitButton className="btn btn-secondary btn-sm" name="op" value="pause">Pause outreach</SubmitButton>
            <SubmitButton className="btn btn-secondary btn-sm" name="op" value="resume">Resume outreach</SubmitButton>
            <SubmitButton className="btn btn-secondary btn-sm" name="op" value="customer">Mark customer</SubmitButton>
            <SubmitButton className="btn btn-secondary btn-sm" name="op" value="competitor">Mark competitor</SubmitButton>
            <ExportTicked />
          </div>
          {rows.length === 0 ? (
            <div className="dir-empty">
              <b>No companies match</b>
              <span>{chips.length || q ? "Loosen a filter or clear the search." : "Import a list to get started."}</span>
            </div>
          ) : (
            <table className="dir-table">
              <thead>
                <tr>
                  <th className="dir-cb"><SelectAllBox /></th>
                  <Th k="name">Company</Th>
                  <Th>Industry</Th>
                  <Th k="employees">Employees</Th>
                  <Th>Technology</Th>
                  <Th k="intent">Intent</Th>
                  <Th className="dir-wide">Source</Th>
                  <Th k="contacts">Contacts</Th>
                  <Th k="updated">Last activity</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const intent = Math.round(r.intentScore);
                  const src = r.lastImportBatchId ? batchName.get(r.lastImportBatchId) ?? r.source : r.source;
                  return (
                    <tr key={r.id}>
                      <td className="dir-cb"><input type="checkbox" name="ids" value={r.id} aria-label={`Select ${r.name}`} /></td>
                      <td>
                        <Link href={`/accounts/${r.id}`} className="dir-co">
                          <Avatar name={r.name} id={r.id} size={30} round />
                          <span className="min-w-0">
                            <b>{r.name}</b>
                            <small className="mono">{r.domain ?? "—"}</small>
                          </span>
                        </Link>
                      </td>
                      <td className="dir-ind">{r.industry ? r.industry.toLowerCase() : <span className="muted">—</span>}</td>
                      <td className="tnum">{r.employees ? r.employees : <span className="muted">—</span>}</td>
                      <td>
                        {r.technologies.length ? (
                          <span className="dir-tech" title={r.technologies.join(", ")}>
                            {r.technologies.slice(0, 2).map((t) => <span key={t}>{t}</span>)}
                            {r.technologies.length > 2 && <em>+{r.technologies.length - 2}</em>}
                          </span>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td><span className={`dir-intent ${intent >= 70 ? "hot" : intent >= 40 ? "warm" : intent > 0 ? "cool" : ""}`}>{intent}</span></td>
                      <td className="dir-src dir-wide" title={src}>{src}</td>
                      <td className="tnum">{r._count.contacts}</td>
                      <td className="muted tnum">{r.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </ActionForm>
        )}

        {view === "table" && pages > 1 && (
          <nav className="dir-pages" aria-label="Pages">
            <span className="muted">{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total.toLocaleString()}</span>
            {page > 1 && <Link href={href({ page: String(page - 1) })} className="btn btn-secondary btn-sm">Previous</Link>}
            {page < pages && <Link href={href({ page: String(page + 1) })} className="btn btn-secondary btn-sm">Next</Link>}
          </nav>
        )}
      </section>
    </div>
  );
}
