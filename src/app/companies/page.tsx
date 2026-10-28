import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ArrowDown, ArrowUp, Download, Plus, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { ensureSellerPacks } from "@/lib/seller";
import { Avatar, StageBadge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { reResearchSelectedAction } from "@/app/actions";
import { ActiveChips, FilterPanel, SearchBox, SelectAllBox, type FilterDef } from "./filters";

export const metadata = { title: "All companies" };

const PAGE = 50;
const SIZES = [
  { value: "1-200", label: "1–200", min: 1, max: 200 },
  { value: "201-1000", label: "201–1,000", min: 201, max: 1000 },
  { value: "1001-5000", label: "1,001–5,000", min: 1001, max: 5000 },
  { value: "5001-20000", label: "5,001–20,000", min: 5001, max: 20000 },
  { value: "20001+", label: "20,000+", min: 20001, max: undefined },
];
const STAGES = ["UNAWARE", "AWARE", "ENGAGED", "MQA", "OPPORTUNITY", "CUSTOMER", "WATCH", "DISQUALIFIED"] as const;
const SORTS = {
  name: { name: "asc" },
  employees: { employees: { sort: "desc", nulls: "last" } },
  intent: { intentScore: "desc" },
  priority: { priorityScore: { sort: "desc", nulls: "last" } },
  contacts: { contacts: { _count: "desc" } },
  added: { createdAt: "desc" },
} as const;
type SortKey = keyof typeof SORTS;
type SP = Record<string, string | undefined>;

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, " ");

/** Every company in one filterable table: the way you'd filter in Apollo, with intent and research status beside it. */
export default async function CompaniesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await ensureSellerPacks();
  const sp = await searchParams;
  const sort: SortKey = (sp.sort && sp.sort in SORTS ? sp.sort : "priority") as SortKey;
  const dir = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : null;
  const page = Math.max(1, Number(sp.page) || 1);

  // ── What to filter by: options come from the companies themselves ──
  const live = { mergedIntoId: null };
  const [industries, countries, sources, batches, campaigns, techRows] = await Promise.all([
    db.account.groupBy({ by: ["industry"], where: { ...live, industry: { not: null } }, _count: true, orderBy: { _count: { industry: "desc" } }, take: 80 }),
    db.account.groupBy({ by: ["country"], where: { ...live, country: { not: null } }, _count: true, orderBy: { _count: { country: "desc" } }, take: 60 }),
    db.account.groupBy({ by: ["source"], where: live, _count: true, orderBy: { _count: { source: "desc" } }, take: 40 }),
    db.importBatch.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, filename: true }, take: 40 }),
    db.campaign.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.account.findMany({ where: { ...live, technologies: { isEmpty: false } }, select: { technologies: true }, take: 5000 }),
  ]);
  const techCount = new Map<string, number>();
  for (const r of techRows) for (const t of r.technologies) techCount.set(t, (techCount.get(t) ?? 0) + 1);
  const technologies = [...techCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 150);

  const filters: FilterDef[] = [
    { key: "industry", label: "Industry", any: "Any industry", options: industries.map((i) => ({ value: i.industry!, label: label(i.industry!), n: i._count })) },
    { key: "tech", label: "Technology", any: "Any technology", options: technologies.map(([t, n]) => ({ value: t, label: t, n })) },
    { key: "size", label: "Employees", any: "Any size", options: SIZES.map((s) => ({ value: s.value, label: s.label })) },
    { key: "country", label: "Location", any: "Anywhere", options: countries.map((c) => ({ value: c.country!, label: c.country!, n: c._count })) },
    { key: "source", label: "Source", any: "Any source", options: sources.map((s) => ({ value: s.source, label: s.source, n: s._count })) },
    { key: "list", label: "Import list", any: "Any list", options: batches.map((b) => ({ value: b.id, label: b.filename })) },
    { key: "campaign", label: "Campaign", any: "Any campaign", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
    { key: "tier", label: "Tier", any: "Any tier", options: ["T1", "T2", "T3"].map((t) => ({ value: t, label: t })) },
    { key: "stage", label: "Status", any: "Any status", options: STAGES.map((s) => ({ value: s, label: label(s) })) },
  ];

  // ── The filtered list ──
  const and: Prisma.AccountWhereInput[] = [live];
  const q = sp.q?.trim();
  if (q) and.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q, mode: "insensitive" } }] });
  if (sp.industry) and.push({ industry: sp.industry });
  if (sp.tech) and.push({ technologies: { has: sp.tech } });
  const size = SIZES.find((s) => s.value === sp.size);
  if (size) and.push({ employees: { gte: size.min, ...(size.max ? { lte: size.max } : {}) } });
  if (sp.country) and.push({ country: sp.country });
  if (sp.source) and.push({ source: sp.source });
  if (sp.list) and.push({ lastImportBatchId: sp.list });
  if (sp.campaign) and.push({ contacts: { some: { journeys: { some: { campaignId: sp.campaign } } } } });
  if (sp.tier === "T1" || sp.tier === "T2" || sp.tier === "T3") and.push({ tier: sp.tier });
  if (sp.stage && (STAGES as readonly string[]).includes(sp.stage)) and.push({ stage: sp.stage as (typeof STAGES)[number] });
  const minIntent = Number(sp.intent) || 0;
  if (minIntent > 0) and.push({ intentScore: { gte: minIntent } });
  const where: Prisma.AccountWhereInput = { AND: and };

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
      select: { id: true, name: true, domain: true, industry: true, employees: true, technologies: true, intentScore: true, priorityScore: true, tier: true, stage: true, source: true, city: true, country: true, lastImportBatchId: true, _count: { select: { contacts: { where: { mergedIntoId: null } } } } },
    }),
  ]);
  const batchName = new Map(batches.map((b) => [b.id, b.filename]));
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const chips = filters.flatMap((f) => (sp[f.key] ? [{ key: f.key, label: `${f.label}: ${f.options.find((o) => o.value === sp[f.key])?.label ?? sp[f.key]}` }] : []));
  if (minIntent > 0) chips.push({ key: "intent", label: `Intent ≥ ${minIntent}` });

  const href = (patch: SP) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/companies${next.size ? `?${next}` : ""}`;
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
  const exportHref = `/accounts/export${q ? `?q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="dir">
      <header className="dir-head">
        <div>
          <h1 className="dir-title">All companies</h1>
          <p className="dir-sub">Every company you target, filtered the way you&apos;d filter in Apollo, with intent and research status beside it.</p>
        </div>
      </header>

      <div className="dir-grid">
        <FilterPanel filters={filters} />

        <section className="dir-main">
          <div className="dir-bar">
            <SearchBox />
            <span className="dir-count"><b className="tnum">{total.toLocaleString()}</b> compan{total === 1 ? "y" : "ies"}</span>
            <div className="dir-btns">
              <a href={exportHref} className="btn btn-secondary btn-sm"><Download size={14} /> Export</a>
              <Link href="/import/upload" className="btn btn-secondary btn-sm"><Upload size={14} /> Import</Link>
              <Link href="/accounts" className="btn btn-brand btn-sm"><Plus size={14} /> Add company</Link>
              <Link href={href({})} className="btn btn-secondary btn-sm dir-icon" aria-label="Refresh" title="Refresh"><RefreshCw size={14} /></Link>
            </div>
          </div>
          <ActiveChips chips={chips} />

          <ActionForm action={reResearchSelectedAction} className="dir-table-wrap">
            <div className="dir-bulk">
              <span>Ticked companies:</span>
              <SubmitButton className="btn btn-secondary btn-sm"><RotateCcw size={13} /> Re-research</SubmitButton>
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
                    <Th k="employees" className="num">Employees</Th>
                    <Th>Technology</Th>
                    <Th k="intent" className="num">Intent</Th>
                    <Th k="priority" className="num">Priority</Th>
                    <Th>Status</Th>
                    <Th className="dir-wide">Source</Th>
                    <Th k="contacts" className="num">Contacts</Th>
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
                              <small>{r.domain ?? "no website"}{r.city || r.country ? ` · ${[r.city, r.country].filter(Boolean).join(", ")}` : ""}</small>
                            </span>
                          </Link>
                        </td>
                        <td className="dir-ind">{r.industry ? label(r.industry) : <span className="muted">—</span>}</td>
                        <td className="num tnum">{r.employees ? r.employees.toLocaleString() : <span className="muted">—</span>}</td>
                        <td>
                          {r.technologies.length ? (
                            <span className="dir-tech" title={r.technologies.join(", ")}>
                              {r.technologies.slice(0, 2).map((t) => <span key={t}>{t}</span>)}
                              {r.technologies.length > 2 && <em>+{r.technologies.length - 2}</em>}
                            </span>
                          ) : <span className="muted">—</span>}
                        </td>
                        <td className="num"><span className={`dir-intent ${intent >= 70 ? "hot" : intent >= 40 ? "warm" : intent > 0 ? "cool" : ""}`}>{intent}</span></td>
                        <td className="num tnum" title={r.tier ? `Tier ${r.tier}` : undefined}>{r.priorityScore ?? <span className="muted">—</span>}{r.tier && <small className="dir-tier">{r.tier}</small>}</td>
                        <td><StageBadge stage={r.stage} /></td>
                        <td className="dir-src dir-wide" title={src}>{src}</td>
                        <td className="num tnum">{r._count.contacts}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </ActionForm>

          {pages > 1 && (
            <nav className="dir-pages" aria-label="Pages">
              <span className="muted">{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total.toLocaleString()}</span>
              {page > 1 && <Link href={href({ page: String(page - 1) })} className="btn btn-secondary btn-sm">Previous</Link>}
              {page < pages && <Link href={href({ page: String(page + 1) })} className="btn btn-secondary btn-sm">Next</Link>}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
