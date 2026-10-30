import Link from "next/link";
import { PeekPanel, closeHref, peekHref } from "@/components/peek/panel";
import type { OppStage } from "@prisma/client";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { ActionForm, Modal, SubmitButton } from "@/components/client";
import { OppMover } from "@/components/opp-mover";
import { Avatar, Kpi, PageHeader, date, money } from "@/components/ui";
import { createOpportunityAction } from "../../actions";
import { LIKELIHOOD, attention } from "@/lib/crm/opportunities";

export const metadata = { title: "CRM · Opportunities" };

const COLUMNS: { id: OppStage; label: string; color: string }[] = [
  { id: "discovery", label: "Discovery", color: "#94A3B8" },
  { id: "qualification", label: "Qualification", color: "#0EA5E9" },
  { id: "proposal", label: "Proposal", color: "#8B5CF6" },
  { id: "negotiation", label: "Negotiation", color: "#F59E0B" },
  { id: "won", label: "Won", color: "#10B981" },
  { id: "lost", label: "Lost", color: "#EF4444" },
];

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ account?: string; peek?: string }> }) {
  const { account, peek } = await searchParams;
  const keep = { account };
  const [opps, accounts] = await Promise.all([
    db.opportunity.findMany({ where: account ? { accountId: account } : {}, include: { account: true, owner: true }, orderBy: { updatedAt: "desc" } }),
    db.account.findMany({ where: { mergedIntoId: null, relationship: { not: "competitor" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const open = opps.filter((o) => !["won", "lost"].includes(o.stage));
  const won = opps.filter((o) => o.stage === "won");
  const lost = opps.filter((o) => o.stage === "lost");
  const abm = open.filter((o) => o.source === "abm");
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;
  const now = new Date();
  const weighted = open.reduce((a, o) => a + o.amountUsd * (LIKELIHOOD[o.stage] ?? 0), 0);
  const needs = open.filter((o) => attention(o, now)).length;

  return (
    <div className="page-enter">
      <PeekPanel peek={peek} close={closeHref("/crm/opportunities", keep)} />
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
        <Kpi label="Open pipeline" value={money(open.reduce((a, o) => a + o.amountUsd, 0))} meta={`${open.length} open · ${money(Math.round(weighted))} weighted${needs ? ` · ${needs} need attention` : ""}`} />
        <Kpi label="ABM-sourced" value={money(abm.reduce((a, o) => a + o.amountUsd, 0))} accent="#7C3AED" meta={`${abm.length} deals from the program`} />
        <Kpi label="Won" value={money(won.reduce((a, o) => a + o.amountUsd, 0))} accent="#10B981" meta={`${won.length} deals`} />
        <Kpi label="Win rate" value={`${winRate}%`} accent="#0EA5E9" meta={`${won.length} won · ${lost.length} lost`} />
      </div>
      {account && <div className="mb-3 text-sm secondary">Filtered to one account · <Link href="/crm/opportunities" className="underline">show all</Link></div>}
      <div className="table-wrap pb-2">
        <div className="op-board">
          {COLUMNS.map((col) => {
            const items = opps.filter((o) => o.stage === col.id);
            const flagged = items.filter((o) => attention(o, now)).length;
            return (
              <div key={col.id} className="op-col">
                <div className="op-col-h">
                  <span className="op-col-t"><i style={{ background: col.color }} />{col.label}</span>
                  <span className="op-col-n tnum">{items.length} · {money(items.reduce((a, o) => a + o.amountUsd, 0))}{flagged > 0 && <b title={`${flagged} need attention`}>{flagged} need attention</b>}</span>
                </div>
                <div className="grid gap-2">
                  {items.length === 0 && <p className="op-empty">No deals</p>}
                  {items.map((o) => {
                    const warn = attention(o, now);
                    return (
                      <article key={o.id} className={`op-card${warn ? " warn" : ""}`}>
                        <div className="op-top">
                          <Avatar name={o.account.name} id={o.account.id} size={24} />
                          <div className="min-w-0 flex-1">
                            <h3 title={o.name}>{o.name}</h3>
                            <Link href={peekHref("/crm/opportunities", keep, "a", o.accountId)} scroll={false} className="op-acct">{o.account.name}</Link>
                          </div>
                        </div>
                        <div className="op-amt"><b className="tnum">{money(o.amountUsd)}</b>{o.source !== "abm" && <span className="op-src">{o.source}</span>}</div>
                        <p className="op-meta">{o.owner?.name ?? "No owner"} · {o.closedAt ? `closed ${date(o.closedAt)}` : o.closeDate ? `close ${date(o.closeDate)}` : "no close date"}</p>
                        {warn && <p className="op-warn">{warn}</p>}
                        {o.lostReason && <p className="op-lost">{o.lostReason}</p>}
                        {!["won", "lost"].includes(o.stage) && <OppMover id={o.id} stage={o.stage} />}
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
