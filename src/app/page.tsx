import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, FileSpreadsheet, Radar, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { SESSION_COOKIE, authSecret, verify, type Session } from "@/lib/auth";
import { getMe } from "@/lib/me";
import { GetStarted } from "@/components/home/get-started";
import { SuperAdminSwitch } from "@/components/shell/SuperAdminSwitch";
import { ensureSellerPacks } from "@/lib/seller";
import { activeSeller } from "@/lib/scope";
import { ago } from "@/components/ui";
import { commandCenter, companyFlow } from "@/lib/command-center";
import { FunnelTrack } from "@/components/viz/funnel-track";
import { RangeToggle, SearchPill, ThemePill } from "@/components/home/client";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { Donut, GroupedBars, SparkStat, change, dayLabels, daily } from "@/components/viz/cards";

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
  const { range = "week" } = await searchParams;
  const now = new Date();
  const since = range === "today" ? new Date(now.getTime() - DAY) : range === "all" ? undefined : new Date(now.getTime() - 7 * DAY);

  const [cc, flow] = await Promise.all([commandCenter(now), companyFlow(now)]);
  // Two weeks of dates: the last 7 days are charted, the 7 before give "vs last week".
  const wkAgo = new Date(now.getTime() - 14 * DAY);
  const [wkAccounts, wkDrafts, wkSent, wkReplies, wkHandoffs, wkVisits] = await Promise.all([
    db.account.findMany({ where: { mergedIntoId: null, createdAt: { gte: wkAgo } }, select: { createdAt: true } }),
    db.draft.findMany({ where: { createdAt: { gte: wkAgo } }, select: { createdAt: true, status: true } }),
    db.message.findMany({ where: { sentAt: { gte: wkAgo } }, select: { sentAt: true } }),
    db.reply.findMany({ where: { receivedAt: { gte: wkAgo } }, select: { receivedAt: true } }),
    db.handoff.findMany({ where: { createdAt: { gte: wkAgo } }, select: { createdAt: true } }),
    db.webVisit.findMany({ where: { occurredAt: { gte: wkAgo } }, select: { occurredAt: true } }),
  ]);
  const trend = (pts: number[]) => (pts.length < 2 ? "flat" : pts[pts.length - 1] > pts[0] ? "up" : pts[pts.length - 1] < pts[0] ? "down" : "flat") as "up" | "down" | "flat";
  const sparkReplies = daily(wkReplies.map((r) => r.receivedAt), 7, now);
  const sparkDrafts = daily(wkDrafts.map((d) => d.createdAt), 7, now);
  const sparkHandoffs = daily(wkHandoffs.map((h) => h.createdAt), 7, now);
  const sparkVisits = daily(wkVisits.map((v) => v.occurredAt), 7, now);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const vsLast = (dates: Date[], spark: number[]) => change(sum(spark), dates.length - sum(spark));
  const STAGE_WORD: Record<string, string> = { UNAWARE: "Not contacted", AWARE: "Aware", ENGAGED: "Engaged", MQA: "Ready for sales", OPPORTUNITY: "Opportunity", CUSTOMER: "Customer", WATCH: "Watching", DISQUALIFIED: "Ruled out", RECYCLED: "Recycled" };
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
  const waiting = Number(cc.kpis.find((k) => k.key === "approve")?.value ?? 0);
  const actionable = ["approve", "overdue"].map((k) => cc.kpis.find((x) => x.key.includes(k))).filter(Boolean) as typeof cc.kpis;
  const context = cc.kpis.filter((k) => !actionable.includes(k));

  const secret = authSecret();
  const session = secret ? await verify<Session>((await cookies()).get(SESSION_COOKIE)?.value, secret) : null;
  // The signed-in user's own name from the team list; the email's first part only as a fallback.
  const me = await getMe();
  const first = session?.email.split("@")[0].split(/[._-]/)[0] ?? "";
  const userName = me?.name.split(/\s+/)[0] || process.env.APP_USER_NAME?.trim() || (first ? first[0].toUpperCase() + first.slice(1) : "");
  const dateLine = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" }).format(now);

  // First-time checklist: shown until every step is done, or dismissed.
  const getStarted = await (async () => {
    const { prefsFor } = await import("@/lib/prefs");
    const prefs = await prefsFor(me?.email);
    if (prefs.dismissed?.includes("get-started")) return null;
    const { activeSellerId } = await import("@/lib/scope");
    const { setupSteps } = await import("@/lib/admin/client-setup");
    const cid = await activeSellerId();
    const [setup, researched, approved] = await Promise.all([
      setupSteps(cid).catch(() => []),
      db.account.count({ where: { mergedIntoId: null, pipelineStatus: "done" } }),
      db.draft.count({ where: { status: { in: ["approved", "sent"] } } }),
    ]);
    const steps = [
      ...setup.filter((x) => x.key === "brain" || x.key === "companies").map((x) => ({ label: x.label, done: x.done, href: x.href })),
      { label: "First research finished", done: researched > 0, href: "/import" },
      { label: "First email approved", done: approved > 0, href: "/review" },
    ];
    if (steps.every((x) => x.done)) return null;
    const left = steps.filter((x) => !x.done).length;
    return <GetStarted steps={steps} left={left} />;
  })();

  return (
    <div className="hm-main">
        <header className="hm-top">
          <div className="min-w-0">
            <div className="hm-date">{dateLine}</div>
            <h1 className="hm-title">{greeting(now)}{userName ? `, ${userName}` : ""}</h1>
            <p className="hm-brief">{waiting ? <><b>{waiting} item{waiting === 1 ? "" : "s"}</b> waiting for you on <Link href="/review">Approvals</Link></> : "Nothing is waiting for you"}{stageCount("MQA") ? <> · <b>{stageCount("MQA")}</b> ready for sales</> : null}{importedWeek ? <> · <b>{importedWeek}</b> imported this week</> : null}.</p>
          </div>
          <div className="hm-tools">
            {me?.canSuperAdmin && <SuperAdminSwitch on={me.superAdmin} />}
            <SearchPill />
            <ThemePill />
            <NotificationBell />
            {session?.email && <span className="hm-who" title={me ? `${me.name} · ${session.email}` : session.email}><span className="hm-avatar">{(userName || session.email)[0].toUpperCase()}</span></span>}
          </div>
        </header>

        {getStarted}

        <section className="hm2-kpis" aria-label="What needs doing">
          {actionable.map((k) => (
            <Link key={k.key} href={k.href} className={`hm2-q${k.value ? " due" : ""}`} title={k.define}>
              <span className="hm2-q-l">{k.label}<em>Now</em></span>
              <span className="hm2-q-v tnum">{k.value}</span>
              <span className="hm2-q-n">{k.note}</span>
            </Link>
          ))}
          <div className="hm2-ctx" aria-label="Context">
            {context.map((k) => (
              <Link key={k.key} href={k.href} className="hm2-c" title={k.define}>
                <span className="hm2-c-l">{k.label}<em>{k.key === "opps" ? "Open" : "All time"}</em></span>
                <span className="hm2-c-v tnum">{k.value}</span>
                <span className="hm2-c-n">{k.note}</span>
              </Link>
            ))}
          </div>
        </section>



        <div className="hm2-grid charts">
          <section className="hm2-card">
            <div className="hm2-head"><h2>Activity this week</h2><span className="hm2-meta">Last 7 days</span></div>
            <GroupedBars categories={dayLabels(7, now)} series={[
              { name: "Companies added", values: daily(wkAccounts.map((a) => a.createdAt), 7, now) },
              { name: "Emails sent", values: daily(wkSent.map((m) => m.sentAt).filter((d): d is Date => Boolean(d)), 7, now) },
            ]} empty="Nothing happened in the last 7 days. New companies, drafts and emails show here as they happen." />
          </section>
          <section className="hm2-card">
            <div className="hm2-head"><h2>Companies by stage</h2><Link href="/accounts" className="hm-sec-link">All companies</Link></div>
            <Donut data={byStage.map((b) => ({ label: STAGE_WORD[b.stage] ?? b.stage, value: b._count }))} center="of companies" empty="No companies yet." />
          </section>
        </div>

        <section className="vz-sparks" aria-label="This week">
          <SparkStat label="Replies this week" value={sum(sparkReplies)} pct={vsLast(wkReplies.map((r) => r.receivedAt), sparkReplies)} points={sparkReplies} tone={trend(sparkReplies)} href="/outreach" />
          <SparkStat label="Drafts written" value={sum(sparkDrafts)} pct={vsLast(wkDrafts.map((d) => d.createdAt), sparkDrafts)} sub={toApprove ? `${toApprove} waiting` : "None waiting"} points={sparkDrafts} tone={trend(sparkDrafts)} href="/review" />
          <SparkStat label="Hand-offs" value={sum(sparkHandoffs)} pct={vsLast(wkHandoffs.map((h) => h.createdAt), sparkHandoffs)} points={sparkHandoffs} tone={trend(sparkHandoffs)} href="/handoffs" />
          <SparkStat label="Website visits" value={sum(sparkVisits)} pct={vsLast(wkVisits.map((v) => v.occurredAt), sparkVisits)} points={sparkVisits} tone={trend(sparkVisits)} href="/import/apollo" />
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
