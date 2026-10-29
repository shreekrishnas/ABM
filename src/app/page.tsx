import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, FileSpreadsheet, Radar, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { SESSION_COOKIE, authSecret, verify, type Session } from "@/lib/auth";
import { getMe } from "@/lib/me";
import { ensureSellerPacks } from "@/lib/seller";
import { activeSeller, resolveScope } from "@/lib/scope";
import { AccountSwitch } from "@/components/shell/AppNav";
import { ago } from "@/components/ui";
import { commandCenter, companyFlow } from "@/lib/command-center";
import { FunnelTrack } from "@/components/viz/funnel-track";
import { RangeToggle, SearchPill, ThemePill } from "@/components/home/client";

export const metadata = { title: "Home" };

const DAY = 86_400_000;
type Status = "Researching" | "Awaiting approval" | "Draft ready" | "Researched" | "New";
const STATUS_TONE: Record<Status, string> = { Researching: "sky", "Awaiting approval": "amber", "Draft ready": "violet", Researched: "ink", New: "muted" };

const PALETTE = ["#6366F1", "#0EA5E9", "#10B981", "#F59E0B", "#F472B6", "#8B5CF6", "#06B6D4", "#EF4444"];
function brandColor(id: string) {
  let h = 0;
  for (const c of id) h = c.charCodeAt(0) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

function greeting(d: Date) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" }).format(d));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Home is the Command Center: what needs doing, where companies stand, what is stuck, and the two ways in. */
export default async function Home({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await ensureSellerPacks();
  const p = await activeSeller();
  const scope = await resolveScope();
  const { range = "week" } = await searchParams;
  const now = new Date();
  const since = range === "today" ? new Date(now.getTime() - DAY) : range === "all" ? undefined : new Date(now.getTime() - 7 * DAY);

  const [cc, flow] = await Promise.all([commandCenter(now), companyFlow(now)]);
  const [companies, toApprove, draftsReady, importedWeek, byStage, recent] = await Promise.all([
    db.account.count({ where: { mergedIntoId: null } }),
    db.draft.count({ where: { status: "pending_review" } }),
    db.draft.count({ where: { status: "approved", message: null } }),
    db.account.count({ where: { mergedIntoId: null, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    db.account.groupBy({ by: ["stage"], where: { mergedIntoId: null }, _count: true }),
    db.account.findMany({
      where: { mergedIntoId: null, ...(since ? { updatedAt: { gte: since } } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, name: true, domain: true, pipelineStatus: true, updatedAt: true, owner: { select: { name: true } }, contacts: { select: { drafts: { where: { status: { in: ["pending_review", "approved"] }, message: null }, select: { status: true } } } } },
    }),
  ]);
  const statusOf = (a: (typeof recent)[number]): Status => {
    const drafts = a.contacts.flatMap((c) => c.drafts);
    if (a.pipelineStatus === "running" || a.pipelineStatus === "queued") return "Researching";
    if (drafts.some((d) => d.status === "pending_review")) return "Awaiting approval";
    if (drafts.some((d) => d.status === "approved")) return "Draft ready";
    if (a.pipelineStatus === "done") return "Researched";
    return "New";
  };
  const stageCount = (k: string) => byStage.find((s) => s.stage === k)?._count ?? 0;
  // What last happened to each company, so "status" says something ("Research finished", "Blocker raised").
  const lastEvents = await Promise.all(recent.map((a) => db.pipelineEvent.findFirst({ where: { accountId: a.id, outcome: { in: ["pass", "block"] } }, orderBy: { createdAt: "desc" }, select: { step: true, outcome: true, reason: true } })));
  const eventText = (e: (typeof lastEvents)[number]) => {
    if (!e) return "—";
    const [area] = e.step.split(".");
    const what: Record<string, string> = { research_plan: "Research planned", account_research: "Research ran", account_twin: "Evidence updated", investigate: "Investigation", readiness: e.outcome === "block" ? "Held at readiness" : "Ready for outreach", draft_review: "Draft written", rejection: "Rejection proposed", fit_tier: e.outcome === "block" ? "Stopped at fit" : "Fit scored", intake: "Data filled", brain: "Brief written", orchestrator: e.outcome === "block" ? "Stopped" : "Run finished" };
    return what[area] ?? area.replace(/_/g, " ");
  };
  const actionable = ["approve", "overdue"].map((k) => cc.kpis.find((x) => x.key.includes(k))).filter(Boolean) as typeof cc.kpis;
  const context = cc.kpis.filter((k) => !actionable.includes(k));

  const secret = authSecret();
  const session = secret ? await verify<Session>((await cookies()).get(SESSION_COOKIE)?.value, secret) : null;
  // The signed-in user's own name from the team list; the email's first part only as a fallback.
  const me = await getMe();
  const first = session?.email.split("@")[0].split(/[._-]/)[0] ?? "";
  const userName = me?.name.split(/\s+/)[0] || process.env.APP_USER_NAME?.trim() || (first ? first[0].toUpperCase() + first.slice(1) : "");
  const dateLine = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" }).format(now);

  return (
    <div className="hm-main">
        <header className="hm-top">
          <div className="min-w-0">
            <div className="hm-date">{dateLine}</div>
            <h1 className="hm-title">{greeting(now)}{userName ? `, ${userName}` : ""}</h1>
            <p className="hm-brief">{toApprove ? <><b>{toApprove} draft{toApprove === 1 ? "" : "s"}</b> waiting for your approval</> : "Nothing is waiting for you"}{stageCount("MQA") ? <> · <b>{stageCount("MQA")}</b> ready for sales</> : null}{importedWeek ? <> · <b>{importedWeek}</b> imported this week</> : null}.</p>
          </div>
          <div className="hm-tools">
            {scope && scope.choices.length > 1 && <AccountSwitch choices={scope.choices} picked={scope.active && scope.ids?.length === 1 ? scope.active : null} everyClient={scope.all} />}
            <SearchPill />
            <ThemePill />
            {session?.email && <span className="hm-who" title={me ? `${me.name} · ${session.email}` : session.email}><span className="hm-avatar">{(userName || session.email)[0].toUpperCase()}</span></span>}
          </div>
        </header>

        <section className="hm2-kpis" aria-label="What needs doing">
          {actionable.map((k) => (
            <Link key={k.key} href={k.href} className={`hm2-q${k.value ? " due" : ""}`} title={k.define}>
              <span className="hm2-q-l">{k.label}</span>
              <span className="hm2-q-v tnum">{k.value}</span>
              <span className="hm2-q-n">{k.note}</span>
            </Link>
          ))}
          <div className="hm2-ctx" aria-label="Context">
            {context.map((k) => (
              <Link key={k.key} href={k.href} className="hm2-c" title={k.define}>
                <span className="hm2-c-l">{k.label}</span>
                <span className="hm2-c-v tnum">{k.value}</span>
                <span className="hm2-c-n">{k.note}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="hm2-card hm2-flow">
          <FunnelTrack steps={flow.steps} accounts={flow.accounts} />
        </section>


        <div className="hm2-grid">
          <section className="hm-activity" aria-label="Recent activity">
            <div className="hm-sec-head">
              <h2>Recent activity</h2>
              <div className="flex items-center gap-4"><RangeToggle /><Link href="/accounts" className="hm-sec-link">View all</Link></div>
            </div>
            {recent.length === 0 ? (
              <p className="hm-empty">Nothing changed {range === "today" ? "today" : range === "week" ? "this week" : "yet"}. <Link href="/import">Import companies</Link> to get started.</p>
            ) : (
              <table className="hm-table">
                <thead><tr><th>Company</th><th>Last event</th><th>Status</th><th>Owner</th><th className="r">Updated</th></tr></thead>
                <tbody>
                  {recent.map((a, i) => {
                    const s = statusOf(a);
                    return (
                      <tr key={a.id}>
                        <td data-l="Company"><Link href={`/accounts/${a.id}`} className="hm-co"><span className="hm-co-av" style={{ background: brandColor(a.id) }} aria-hidden>{initials(a.name)}</span><span className="min-w-0"><span className="hm-co-n">{a.name}</span>{a.domain && <span className="hm-co-d">{a.domain}</span>}</span></Link></td>
                        <td data-l="Last event" title={lastEvents[i]?.reason ?? undefined}>{eventText(lastEvents[i])}</td>
                        <td data-l="Status"><span className={`hm-status ${STATUS_TONE[s]}`}><i />{s}</span></td>
                        <td data-l="Owner" className="hm-dim">{a.owner?.name ?? "Unassigned"}</td>
                        <td data-l="Updated" className="hm-dim r tnum">{ago(a.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
          <div className="hm2-card" id="attention">
            <div className="hm2-head">
              <h2>Needs attention</h2>
              <span className="hm2-meta">{cc.attention.length ? `${cc.attention.length} item${cc.attention.length === 1 ? "" : "s"}` : "All clear"}</span>
            </div>
            {cc.attention.length === 0 ? (
              <p className="hm-empty">All clear · checked {ago(cc.freshAt)}. Nothing is stuck, overdue or paused.</p>
            ) : (
              <ul className="cc-att">
                {cc.attention.slice(0, 4).map((a, i) => (
                  <li key={i}>
                    <Link href={a.href} className={`cc-a ${a.tone}`}>
                      <i />
                      <span className="min-w-0 flex-1"><span className="cc-a-kind">{a.kind}</span><span className="cc-a-title">{a.title}</span><span className="cc-a-detail">{a.detail}</span></span>
                      <span className="cc-a-at">{ago(a.at)}</span>
                    </Link>
                  </li>
                ))}
                {cc.attention.length > 4 && <li><Link href="/review" className="hm2-more">All {cc.attention.length} <ArrowRight size={14} /></Link></li>}
              </ul>
            )}
          </div>
        </div>

        {companies < 10 && (
          <section className="hm2-card hm2-onboard" aria-label="Import">
            <div className="hm2-head"><h2>Get companies in</h2><Link href="/import" className="hm-sec-link">All options</Link></div>
            <ul className="hm2-imp">
              {[
                { href: "/import/upload", icon: FileSpreadsheet, label: "Upload a CSV", hint: "Map columns, preview, import" },
                { href: "/import/lookalikes", icon: Sparkles, label: "Find lookalikes", hint: "Companies like one website" },
                { href: "/import/apollo", icon: Radar, label: "Website visitors", hint: "Identified by Apollo" },
              ].map((r) => (
                <li key={r.href}><Link href={r.href}><r.icon size={16} strokeWidth={1.75} /><span><b>{r.label}</b><small>{r.hint}</small></span><ArrowRight size={14} /></Link></li>
              ))}
            </ul>
          </section>
        )}

        <footer className="hm-foot">{p.name} · ABM account intelligence</footer>
    </div>
  );
}
