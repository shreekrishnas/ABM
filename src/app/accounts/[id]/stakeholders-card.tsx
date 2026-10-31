import { Search, Sparkles, UserPlus } from "lucide-react";
import { db } from "@/lib/db";
import { seller } from "@/lib/seller";
import { ActionButton } from "@/components/client";
import { Card } from "@/components/ui";
import { GROUP_BY_KEY, stakeholderMap, targetGroups } from "@/lib/buying-group/stakeholders";
import { latestInfluencerPlan } from "@/lib/buying-group/expand";
import { findInfluencersAction, searchStakeholdersAction } from "./stakeholder-actions";

const ROLE_LABEL: Record<string, string> = { decision_maker: "Decision maker", champion: "Champion", influencer: "Influencer", budget_owner: "Budget owner", unknown: "Role unknown" };
const FOUND_BY: Record<string, string> = { stakeholder_search: "stakeholder search", influencer_search: "influencer search", board_research: "board research", provider: "provider" };
const BOARD_LABEL: Record<string, string> = { board_member: "Board", independent_director: "Independent director", adviser: "Adviser", investor: "Investor" };

/** Every group that shapes the decision, who covers it, and the additional influencers the facts point to. */
export async function StakeholdersCard({ accountId }: { accountId: string }) {
  const [account, people, plan] = await Promise.all([
    db.account.findUniqueOrThrow({ where: { id: accountId }, select: { id: true, tier: true, sellerId: true } }),
    db.contact.findMany({ where: { accountId, mergedIntoId: null }, select: { id: true, fullName: true, title: true, titleNormalized: true, buyingRole: true, stakeholderType: true, discoveredBy: true, influenceReason: true } }),
    latestInfluencerPlan(accountId),
  ]);
  const groups = targetGroups(seller().personas.flatMap((p) => p.functions));
  const map = stakeholderMap(people.map((p) => ({ ...p, title: p.titleNormalized ?? p.title })), groups);
  const byId = new Map(people.map((p) => [p.id, p]));
  const canSearch = account.tier === "T1" || account.tier === "T2";

  return (
    <Card
      title={`Stakeholders · ${map.covered} of ${map.total} groups covered`}
      sub="Everyone who shapes the decision, not only the buyer. Sequences email decision makers and champions; everyone else is for planning and multi-threading."
      action={
        <span className="flex flex-wrap gap-2">
          <ActionButton action={searchStakeholdersAction.bind(null, accountId)} className="btn btn-secondary btn-sm" title={canSearch ? "Search the contact provider for the uncovered groups (approved companies only)" : "Stakeholder search runs for T1 and T2 companies"}><Search size={14} /> Find missing groups</ActionButton>
          <ActionButton action={findInfluencersAction.bind(null, accountId)} className="btn btn-secondary btn-sm" title="Ask the AI for 3–4 less-obvious people the facts point to, then look them up"><Sparkles size={14} /> Find influencers</ActionButton>
        </span>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>By group</h3>
          <ul className="grid gap-2">
            {map.rows.map(({ group, people: inGroup }) => (
              <li key={group.key} className="grid gap-0.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: inGroup.length ? "var(--success)" : "var(--neutral)" }} aria-hidden />
                  <b style={{ color: "var(--text-primary)" }}>{group.label}</b>
                  {inGroup.length === 0 && <span className="muted">nobody yet</span>}
                </div>
                <div className="muted pl-4">{group.role}</div>
                {inGroup.length > 0 && (
                  <div className="secondary pl-4">
                    {inGroup.map((p, i) => <span key={p.id}>{i > 0 && " · "}{p.fullName} ({p.title ?? "title unknown"}, {ROLE_LABEL[p.buyingRole] ?? p.buyingRole}{p.discoveredBy && FOUND_BY[p.discoveredBy] ? `, via ${FOUND_BY[p.discoveredBy]}` : ""})</span>)}
                  </div>
                )}
              </li>
            ))}
            {map.board.length > 0 && (
              <li className="grid gap-0.5 text-xs">
                <div className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--indigo)" }} aria-hidden /><b style={{ color: "var(--text-primary)" }}>Board, investors and advisers</b></div>
                <div className="secondary pl-4">{map.board.map((p, i) => <span key={p.id}>{i > 0 && " · "}{p.fullName} ({BOARD_LABEL[p.stakeholderType] ?? p.stakeholderType})</span>)}</div>
              </li>
            )}
          </ul>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Additional influencers</h3>
          <p className="muted mb-2 text-xs">Less-obvious people whose work this company&apos;s own facts touch. Each is tied to a fact; obvious executive buyers and roles already mapped are left out.</p>
          {!plan ? (
            <p className="muted text-xs">{canSearch ? "Not proposed yet: runs with the buying group step, or use Find influencers." : "Proposed automatically for T1 and T2 companies; use Find influencers to ask now."}</p>
          ) : plan.roles.length === 0 ? (
            <p className="muted text-xs">No grounded roles found on {plan.at.toISOString().slice(0, 10)}.</p>
          ) : (
            <ol className="grid gap-3">
              {plan.roles.map((r) => {
                const found = r.found.map((id) => byId.get(id)).filter(Boolean);
                return (
                  <li key={r.title} className="text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <b style={{ color: "var(--text-primary)" }}>{r.title}</b>
                      <span className="muted">{GROUP_BY_KEY[r.group]?.label ?? r.group}</span>
                      {found.length > 0
                        ? <span className="inline-flex items-center gap-1" style={{ color: "var(--success-strong)" }}><UserPlus size={12} aria-hidden /> {found.map((p) => p!.fullName).join(", ")}</span>
                        : <span style={{ color: "var(--warning-strong)" }}>Look for this person (not found in the contact provider)</span>}
                    </div>
                    <div className="secondary mt-0.5">{r.why}</div>
                    <div className="muted mt-0.5">Based on: {r.facts.map((f) => `“${f.claim}”`).join(" · ")}</div>
                  </li>
                );
              })}
            </ol>
          )}
          {plan && plan.dropped.length > 0 && <p className="muted mt-2 text-xs" title={plan.dropped.map((d) => `${d.title}: ${d.reason}`).join("\n")}>{plan.dropped.length} AI proposal{plan.dropped.length === 1 ? "" : "s"} left out (hover for why).</p>}
        </section>
      </div>
    </Card>
  );
}
