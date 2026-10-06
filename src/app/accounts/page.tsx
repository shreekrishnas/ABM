import Link from "next/link";
import type { BuyingStage, Prisma, Tier } from "@prisma/client";
import { Building2, Plus, Search, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { STAGES } from "@/lib/config";
import { ActionForm, Modal, SubmitButton } from "@/components/client";
import { Avatar, Badge, Card, Empty, Meter, PageHeader, STAGE_STYLE, StageBadge, TierBadge, ago, cx } from "@/components/ui";
import { createAccountAction } from "../actions";

export const metadata = { title: "Companies" };

const SORTS = { engagement: "Engagement", fit: "Fit", intent: "Intent", recent: "Recently updated", name: "Name" } as const;

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const stage = sp.stage as BuyingStage | undefined;
  const tier = sp.tier as Tier | undefined;
  const sort = (sp.sort as keyof typeof SORTS) ?? "engagement";

  const where: Prisma.AccountWhereInput = {
    mergedIntoId: null,
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q, mode: "insensitive" } }, { industry: { contains: q, mode: "insensitive" } }] } : {}),
    ...(stage ? { stage } : {}),
    ...(tier ? { tier } : {}),
  };
  const orderBy: Prisma.AccountOrderByWithRelationInput =
    sort === "fit" ? { fitScore: { sort: "desc", nulls: "last" } } : sort === "intent" ? { intentScore: "desc" } : sort === "recent" ? { updatedAt: "desc" } : sort === "name" ? { name: "asc" } : { engagementScore: "desc" };

  const [accounts, stageCounts, users] = await Promise.all([
    db.account.findMany({ where, orderBy, include: { owner: true, _count: { select: { contacts: true, reviewItems: { where: { status: "open" } } } } }, take: 300 }),
    db.account.groupBy({ by: ["stage"], where: { mergedIntoId: null }, _count: true }),
    db.user.findMany({ orderBy: { name: "asc" } }),
  ]);

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ q, stage, tier, sort, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/accounts${p.size ? `?${p}` : ""}`;
  };
  const total = stageCounts.reduce((a, s) => a + s._count, 0);

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="Company master"
        title="Companies"
        sub="Every target company with its tier, buying stage, fit, intent and engagement. One record per company — all channel activity returns here."
        actions={
          <div className="flex flex-wrap gap-2">
          <Link href="/import" className="btn btn-secondary"><Upload size={15} /> Import Companies &amp; People</Link>
          <Modal trigger={<><Plus size={16} /> New company</>} title="Add a company" eyebrow="Companies" triggerClass="btn btn-brand">
              <ActionForm action={createAccountAction} className="grid gap-3">
                <div><label className="field-label" htmlFor="name">Company name</label><input id="name" name="name" required className="glass-input" placeholder="Northwind Analytics" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="field-label" htmlFor="domain">Website</label><input id="domain" name="domain" className="glass-input" placeholder="northwind.com" /></div>
                  <div><label className="field-label" htmlFor="industry">Industry</label><input id="industry" name="industry" className="glass-input" placeholder="analytics" /></div>
                  <div><label className="field-label" htmlFor="employees">Employees</label><input id="employees" name="employees" className="glass-input" inputMode="numeric" placeholder="850" /></div>
                  <div><label className="field-label" htmlFor="country">Country (ISO)</label><input id="country" name="country" className="glass-input" placeholder="US" maxLength={2} /></div>
                </div>
                <div><label className="field-label" htmlFor="ownerId">Owner</label>
                  <select id="ownerId" name="ownerId" className="glass-select"><option value="">Unassigned</option>{users.filter((u) => u.role === "rep").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                </div>
                <p className="muted text-xs">Every field starts as unknown and keeps its source until the pipeline verifies it.</p>
                <div className="mt-1 flex justify-end"><SubmitButton>Create account</SubmitButton></div>
              </ActionForm>
          </Modal>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form className="search-pill w-full max-w-sm" action="/accounts">
          <Search size={16} />
          <input name="q" defaultValue={q} className="glass-input" placeholder="Search name, domain or industry" aria-label="Search accounts" />
          {stage && <input type="hidden" name="stage" value={stage} />}
          {tier && <input type="hidden" name="tier" value={tier} />}
        </form>
        <div className="segmented" role="group" aria-label="Tier">
          {[undefined, "T1", "T2", "T3"].map((t) => <Link key={t ?? "all"} href={link({ tier: t })} className={cx(tier === t && "on")}>{t ?? "All tiers"}</Link>)}
        </div>
        <div className="segmented ml-auto" role="group" aria-label="Sort">
          {Object.entries(SORTS).map(([k, l]) => <Link key={k} href={link({ sort: k })} className={cx(sort === k && "on")}>{l}</Link>)}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <Link href={link({ stage: undefined })} className="badge" style={{ background: !stage ? "var(--accent-indigo)" : "var(--surface-card)", color: !stage ? "#fff" : "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}>All · {total}</Link>
        {(Object.keys(STAGE_STYLE) as BuyingStage[]).map((s) => {
          const n = stageCounts.find((c) => c.stage === s)?._count ?? 0;
          if (!n) return null;
          const on = stage === s;
          return <Link key={s} href={link({ stage: on ? undefined : s })} className="badge" style={{ background: on ? STAGE_STYLE[s].color : "var(--surface-card)", color: on ? "#fff" : STAGE_STYLE[s].color, border: "1px solid var(--border-subtle)" }}>{STAGE_STYLE[s].label} · {n}</Link>;
        })}
      </div>

      <Card pad={false}>
        {accounts.length === 0 ? <Empty icon={<Building2 size={20} />} title="No accounts match" sub="Try clearing filters, or import a CSV to add accounts." action={<Link href="/import" className="btn btn-primary btn-sm">Import accounts</Link>} /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Account</th><th>Tier</th><th>Stage</th><th>Fit</th><th>Intent</th><th className="w-40">Engagement</th><th>Pipeline</th><th>Owner</th><th>Updated</th></tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const st = STAGES.find((s) => s.n === a.pipelineStage);
                  return (
                    <tr key={a.id}>
                      <td className="strong">
                        <Link href={`/accounts/${a.id}`} className="flex items-center gap-3">
                          <Avatar name={a.name} id={a.id} size={34} />
                          <span className="min-w-0">
                            <span className="block truncate hover:underline">{a.name}</span>
                            <span className="mono muted block truncate font-normal">{a.domain ?? "no domain"} · {a._count.contacts} contacts</span>
                          </span>
                        </Link>
                      </td>
                      <td><TierBadge tier={a.tier} /></td>
                      <td><StageBadge stage={a.stage} /></td>
                      <td className="tnum">{a.fitScore ?? <span className="muted">—</span>}</td>
                      <td className="tnum">{Math.round(a.intentScore)}</td>
                      <td><div className="flex items-center gap-2"><div className="flex-1"><Meter value={a.engagementScore} /></div><span className="tnum w-8 text-right text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{Math.round(a.engagementScore)}</span></div></td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <Badge color={a.pipelineStatus === "error" ? "#DC2626" : a.pipelineStatus === "blocked" ? "#B45309" : a.pipelineStatus === "done" ? "#059669" : "#64748B"}>{a.pipelineStage ? `${a.pipelineStage} · ${st?.name ?? ""}` : "Not started"}</Badge>
                          {a._count.reviewItems > 0 && <Badge color="#7C3AED" title="Open review items">{a._count.reviewItems} review</Badge>}
                        </div>
                      </td>
                      <td>{a.owner ? <span className="flex items-center gap-2"><Avatar name={a.owner.name} size={24} round />{a.owner.name.split(" ")[0]}</span> : <span className="muted">—</span>}</td>
                      <td className="muted whitespace-nowrap text-xs">{ago(a.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
