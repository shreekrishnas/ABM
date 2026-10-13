import Link from "next/link";
import type { OppStage } from "@prisma/client";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { ActionForm, Modal, SubmitButton } from "@/components/client";
import { OppMover } from "@/components/opp-mover";
import { Avatar, Badge, Kpi, PageHeader, date, money } from "@/components/ui";
import { createOpportunityAction } from "../../actions";

export const metadata = { title: "CRM · Opportunities" };

const COLUMNS: { id: OppStage; label: string; color: string }[] = [
  { id: "discovery", label: "Discovery", color: "#94A3B8" },
  { id: "qualification", label: "Qualification", color: "#0EA5E9" },
  { id: "proposal", label: "Proposal", color: "#8B5CF6" },
  { id: "negotiation", label: "Negotiation", color: "#F59E0B" },
  { id: "won", label: "Won", color: "#10B981" },
  { id: "lost", label: "Lost", color: "#EF4444" },
];

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams;
  const [opps, accounts] = await Promise.all([
    db.opportunity.findMany({ where: account ? { accountId: account } : {}, include: { account: true, owner: true }, orderBy: { updatedAt: "desc" } }),
    db.account.findMany({ where: { mergedIntoId: null, relationship: { not: "competitor" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const open = opps.filter((o) => !["won", "lost"].includes(o.stage));
  const won = opps.filter((o) => o.stage === "won");
  const lost = opps.filter((o) => o.stage === "lost");
  const abm = open.filter((o) => o.source === "abm");
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="CRM"
        title="Opportunities"
        sub="Opening a deal moves the account to Opportunity and pauses automated outreach. Closed-lost goes to the watchlist and is recycled after 90 days."
        actions={
          <Modal trigger={<><Plus size={16} /> New opportunity</>} title="Create an opportunity" eyebrow="CRM" triggerClass="btn btn-brand">
              <ActionForm action={createOpportunityAction} className="grid gap-3">
                <div><label className="field-label" htmlFor="oa">Account</label><select id="oa" name="accountId" required className="glass-select" defaultValue={account ?? ""}><option value="" disabled>Choose an account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                <div><label className="field-label" htmlFor="on">Name</label><input id="on" name="name" required className="glass-input" placeholder="Platform — annual" /></div>
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="field-label" htmlFor="oam">Amount (USD)</label><input id="oam" name="amountUsd" inputMode="numeric" className="glass-input" placeholder="50000" /></div>
                  <div><label className="field-label" htmlFor="os">Stage</label><select id="os" name="stage" className="glass-select">{COLUMNS.slice(0, 4).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
                  <div><label className="field-label" htmlFor="oc">Close date</label><input id="oc" name="closeDate" type="date" className="glass-input" /></div>
                </div>
                <div className="flex justify-end"><SubmitButton>Create</SubmitButton></div>
              </ActionForm>
          </Modal>
        }
      />
      <div className="stagger mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Open pipeline" value={money(open.reduce((a, o) => a + o.amountUsd, 0))} meta={`${open.length} open deals`} />
        <Kpi label="ABM-sourced" value={money(abm.reduce((a, o) => a + o.amountUsd, 0))} accent="#7C3AED" meta={`${abm.length} deals from the program`} />
        <Kpi label="Won" value={money(won.reduce((a, o) => a + o.amountUsd, 0))} accent="#10B981" meta={`${won.length} deals`} />
        <Kpi label="Win rate" value={`${winRate}%`} accent="#0EA5E9" meta={`${won.length} won · ${lost.length} lost`} />
      </div>
      {account && <div className="mb-3 text-sm secondary">Filtered to one account · <Link href="/crm/opportunities" className="underline">show all</Link></div>}
      <div className="table-wrap pb-2">
        <div className="grid min-w-[1100px] grid-cols-6 gap-3">
          {COLUMNS.map((col) => {
            const items = opps.filter((o) => o.stage === col.id);
            return (
              <div key={col.id} className="min-w-0 rounded-2xl p-2.5" style={{ background: "var(--surface-track)" }}>
                <div className="mb-2.5 flex items-center justify-between px-1.5">
                  <span className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--text-primary)" }}><span className="h-2 w-2 rounded-full" style={{ background: col.color }} />{col.label}</span>
                  <span className="muted tnum text-xs">{items.length} · {money(items.reduce((a, o) => a + o.amountUsd, 0))}</span>
                </div>
                <div className="grid gap-2">
                  {items.map((o) => (
                    <div key={o.id} className="glass-card min-w-0 overflow-hidden rounded-2xl p-3" style={{ borderRadius: "1rem" }}>
                      <div className="flex items-start gap-2">
                        <Avatar name={o.account.name} id={o.account.id} size={26} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[0.82rem] font-semibold" style={{ color: "var(--text-primary)" }}>{o.name}</div>
                          <Link href={`/accounts/${o.accountId}?tab=crm`} className="muted block truncate text-xs hover:underline">{o.account.name}</Link>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="display-num tnum text-lg">{money(o.amountUsd)}</span>
                        <Badge color={o.source === "abm" ? "#7C3AED" : "#64748B"}>{o.source}</Badge>
                      </div>
                      <div className="muted mt-1 text-[0.7rem]">{o.owner?.name ?? "No owner"} · {o.closedAt ? `closed ${date(o.closedAt)}` : o.closeDate ? `close ${date(o.closeDate)}` : "no close date"}</div>
                      {o.lostReason && <div className="mt-1 text-[0.7rem] text-[#B45309]">{o.lostReason}</div>}
                      {!["won", "lost"].includes(o.stage) && <OppMover id={o.id} stage={o.stage} />}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
