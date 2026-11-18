import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangle, ArrowRight, ArrowUpRight, BadgeCheck, Briefcase, FileSpreadsheet, FlaskConical, Inbox, Radar, Sparkles, Target, TrendingDown } from "lucide-react";
import { db } from "@/lib/db";
import { SESSION_COOKIE, authSecret, verify, type Session } from "@/lib/auth";
import { getMe } from "@/lib/me";
import { GetStarted } from "@/components/home/get-started";
import { SuperAdminSwitch } from "@/components/shell/SuperAdminSwitch";
import { ensureSellerPacks } from "@/lib/seller";
import { activeSeller } from "@/lib/scope";
import { ago } from "@/components/ui";
import { commandCenter, companyFlow } from "@/lib/command-center";
import { DecisionPanel, ExportView, JourneyPanel } from "@/components/home/workspace";
import { openDecisions } from "@/lib/decisions";
import { SearchPill, ThemePill } from "@/components/home/client";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { JobsIndicator } from "@/components/shell/JobsIndicator";
import { GroupedBars, dayLabels, daily } from "@/components/viz/cards";

export const metadata = { title: "Home" };

const DAY = 86_400_000;
type Status = "Researching" | "Awaiting approval" | "Draft ready" | "Researched" | "New";
const STATUS_TAG: Record<Status, string> = { Researching: "purple", "Awaiting approval": "amber", "Draft ready": "purple", Researched: "green", New: "" };

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
export default async function Home({ searchParams }: { searchParams: Promise<{ range?: string; ev?: string }> }) {
  await ensureSellerPacks();
  const p = await activeSeller();
  const { range = "week", ev } = await searchParams;
  const now = new Date();
  const since = range === "today" ? new Date(now.getTime() - DAY) : range === "all" ? undefined : new Date(now.getTime() - 7 * DAY);

  const [cc, flow] = await Promise.all([commandCenter(now), companyFlow(now)]);
  // Two weeks of dates: the last 7 days are charted, the 7 before give "vs last week".
  const wkAgo = new Date(now.getTime() - 14 * DAY);
  const [wkAccounts, wkSent] = await Promise.all([
    db.account.findMany({ where: { mergedIntoId: null, createdAt: { gte: wkAgo } }, select: { createdAt: true } }),
    db.message.findMany({ where: { sentAt: { gte: wkAgo } }, select: { sentAt: true } }),
  ]);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const addedDaily = daily(wkAccounts.map((a) => a.createdAt), 7, now);
  const sentDaily = daily(wkSent.map((m) => m.sentAt).filter((d): d is Date => Boolean(d)), 7, now);
  const days = dayLabels(7, now);
  const [companies, importedWeek, byStage, recent] = await Promise.all([
    db.account.count({ where: { mergedIntoId: null } }),
    db.account.count({ where: { mergedIntoId: null, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    db.account.groupBy({ by: ["stage"], where: { mergedIntoId: null }, _count: true }),
    db.account.findMany({
      where: { mergedIntoId: null, ...(since ? { updatedAt: { gte: since } } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 8,
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

  // Hero: the biggest drop between two steps of the company flow (same rule as the flow chart).
  const reachedN = flow.steps.map((_, i) => flow.accounts.filter((a) => a.reached >= i).length);
  let gap = -1;
  for (let i = 1; i < reachedN.length; i++) {
    if (!reachedN[i - 1]) continue;
    if (gap < 0 || reachedN[i] / reachedN[i - 1] < reachedN[gap] / reachedN[gap - 1]) gap = i;
  }
  const gapRate = gap > 0 ? reachedN[gap] / reachedN[gap - 1] : 0;
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

  const secret = authSecret();
  const session = secret ? await verify<Session>((await cookies()).get(SESSION_COOKIE)?.value, secret) : null;
  // The signed-in user's own name from the team list; the email's first part only as a fallback.
  const me = await getMe();
  const first = session?.email.split("@")[0].split(/[._-]/)[0] ?? "";
  const userName = me?.name.split(/\s+/)[0] || process.env.APP_USER_NAME?.trim() || (first ? first[0].toUpperCase() + first.slice(1) : "");
  const dateLine = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" }).format(now);

  // Today's recommendations for the client in view (built by the morning run): a link in the brief, not a card.
  const recommended = await (async () => {
    const { activeSellerId } = await import("@/lib/scope");
    const { istDate } = await import("@/lib/discover/recommend");
    const row = await db.dailyRecommendation.findUnique({ where: { sellerId_date: { sellerId: await activeSellerId(), date: istDate(now) } }, select: { items: true } }).catch(() => null);
    return ((row?.items ?? []) as { decided?: string }[]).filter((i) => !i.decided).length;
  })();

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

  const center = await openDecisions("all", 30);
  const queue = center.items.map((d) => ({ id: d.id, kind: d.kind, label: d.label, title: d.title, description: d.description, href: d.href, ago: ago(d.createdAt) }));
  const fv = (k: string) => cc.funnel.find((f) => f.key === k)?.value ?? 0;
  const [nImported, nQualified, nResearched] = [fv("imported"), fv("qualified"), fv("researched")];
  const opps = cc.kpis.find((k) => k.key === "opps");
  const stuck = gap > 0 ? reachedN[gap - 1] - reachedN[gap] : 0;
  const strip = flow.steps.slice(0, 5);
  const rows = recent.map((a, i) => ({ a, e: lastEvents[i] })).filter((r) => ev !== "stopped" || r.e?.outcome === "block");
  const exportRows: [string, number, string][] = flow.steps.map((st, i) => [st.label, reachedN[i], i === 0 ? "Entry point" : reachedN[i - 1] ? `${Math.round((reachedN[i] / reachedN[i - 1]) * 100)}% of ${lower(flow.steps[i - 1].label)}` : "No conversions yet"]);
  const firstName = userName ? `, ${userName}` : "";

  return (
    <div className="hm-main ws">
        <header className="ws-topbar">
          <div className="ws-crumb"><span>{p.name}</span><span>/</span><strong>Intelligence overview</strong></div>
          <div className="hm-tools">
            {me?.canSuperAdmin && <SuperAdminSwitch on={me.superAdmin} />}
            <SearchPill />
            <ThemePill />
            <JobsIndicator />
            <NotificationBell />
            {session?.email && <span className="hm-who" title={me ? `${me.name} · ${session.email}` : session.email}><span className="hm-avatar">{(userName || session.email)[0].toUpperCase()}</span></span>}
          </div>
        </header>

        <section className="ws-heading">
          <div>
            <div className="ws-eyebrow">{dateLine} · Client workspace</div>
            <h1>{greeting(now)}{firstName}</h1>
            <p className="ws-subtle">A sharper view of account progress, decisions and what needs to happen next.</p>
          </div>
          <ExportView rows={exportRows} />
        </section>

        <div className="ws-meta">
          <span><i className="ws-live" />Live data · checked {ago(cc.freshAt)}</span>
          <span>Client: <strong>{p.name}</strong></span>
          <span>•</span>
          <span>{importedWeek} imported this week</span>
          {recommended ? <><span>•</span><Link href="/discover#recommended">{recommended} recommended today</Link></> : null}
        </div>

        <section className="ws-hero" aria-label="Today's focus">
          <div className="ws-hero-copy">
            <div className="ws-hero-kicker">{dateLine}<span className="ws-hero-sep">/</span>{p.name} workspace</div>
            <h2>Your account operations, in focus.</h2>
            <p>
              {waiting ? `${waiting} decision${waiting === 1 ? " requires" : "s require"} attention.` : "No decision is waiting on you."}{" "}
              {nQualified} compan{nQualified === 1 ? "y is" : "ies are"} qualified{gap > 0 ? `, while ${stuck} ${lower(flow.steps[gap - 1].label)} ${stuck === 1 ? "account has" : "accounts have"} not progressed to ${lower(flow.steps[gap].label)}.` : "."}
            </p>
            <div className="ws-hero-actions">
              <Link href="/review" className="ws-btn">{waiting ? `Review ${waiting} decision${waiting === 1 ? "" : "s"}` : "Open approvals"} <ArrowUpRight size={13} /></Link>
              <Link href="#journey" className="ws-btn outline">Explore account progression <ArrowRight size={13} /></Link>
            </div>
          </div>
          <div className="ws-focus">
            <span className="ws-focus-label">Current bottleneck</span>
            {gap > 0 ? (
              <>
                <div className="ws-focus-stat"><strong className="tnum">{stuck}</strong><div><b>{flow.steps[gap - 1].label}, not {lower(flow.steps[gap].label)}</b><span>Next transition is at {Math.round(gapRate * 100)}%</span></div></div>
                <div className="ws-track" aria-hidden><span style={{ width: `${Math.round(gapRate * 100)}%` }} /></div>
                <p className="ws-focus-cap">The strongest operational signal in your current workspace.</p>
              </>
            ) : <p className="ws-focus-cap">No bottleneck yet. Import companies to see where they stop.</p>}
          </div>
        </section>

        {getStarted}

        <section className="ws-metrics" aria-label="Key metrics">
          <Link href="/review" className="ws-metric m0"><div className="ws-metric-top">Pending decisions <span className="ws-micon"><Inbox size={16} /></span></div><div className="ws-metric-v tnum">{waiting}</div><div className="ws-metric-d">Approvals and qualification reviews</div></Link>
          <Link href="/accounts" className="ws-metric m1"><div className="ws-metric-top">Qualified accounts <span className="ws-micon"><BadgeCheck size={16} /></span></div><div className="ws-metric-v tnum">{nQualified} <span className="ws-denom">/ {nImported}</span></div><div className="ws-metric-d"><span className="ws-delta">{nImported ? Math.round((nQualified / nImported) * 100) : 0}%</span> qualification rate</div></Link>
          <Link href="/accounts" className="ws-metric m2"><div className="ws-metric-top">Research complete <span className="ws-micon"><FlaskConical size={16} /></span></div><div className="ws-metric-v tnum">{nResearched}</div><div className="ws-metric-d">Of {nQualified} qualified compan{nQualified === 1 ? "y" : "ies"}</div></Link>
          <Link href={opps?.href || "/handoffs"} className="ws-metric m3"><div className="ws-metric-top">Open opportunities <span className="ws-micon"><Briefcase size={16} /></span></div><div className="ws-metric-v tnum">{opps?.value ?? 0}</div><div className="ws-metric-d">{opps?.value ? opps.note : "No opportunities recorded"}</div></Link>
        </section>

        <section className="ws-progress" aria-label="Account progression">
          <div className="ws-progress-cap">
            <span className="ws-eyebrow">Account progression</span>
            <b>{(reachedN[4] ?? 0) === 0 ? "Research is moving. Outreach has not started." : `${reachedN[4]} compan${reachedN[4] === 1 ? "y" : "ies"} contacted so far.`}</b>
            <span>All accounts · current workspace</span>
          </div>
          <div className="ws-steps">
            {strip.map((st, i) => (
              <div key={st.key} className="ws-step-wrap">
                {i > 0 && <i className={reachedN[i] === 0 && reachedN[i - 1] > 0 ? "blocked" : undefined} />}
                <div className={reachedN[i] === 0 ? "zero" : undefined}><b className="tnum">{reachedN[i]}</b><span>{st.label}</span></div>
              </div>
            ))}
          </div>
          <Link href="#journey" className="ws-btn small">Inspect journey <ArrowUpRight size={12} /></Link>
        </section>

        <div className="ws-grid">
          <DecisionPanel items={queue} counts={center.counts} />
          <section className="ws-panel" aria-labelledby="ws-sig">
            <div className="ws-panel-head">
              <div>
                <div className="ws-eyebrow sm">02 / Signals</div>
                <h3 id="ws-sig">Attention &amp; signals</h3>
                <p>Important account signals that need a human decision.</p>
              </div>
              <Link href="/review" className="ws-btn small">All signals</Link>
            </div>
            {cc.attention.slice(0, 3).map((a, i) => (
              <div key={i} className="ws-signal">
                <span className={`ws-sicon ${a.tone}`} aria-hidden><AlertTriangle size={15} /></span>
                <div className="min-w-0"><b>{a.title}</b> <span className={`ws-tag ${a.tone === "risk" ? "red" : a.tone === "warn" ? "amber" : "purple"}`}>{a.kind}</span><p>{a.detail}</p></div>
                <Link href={a.href} className="ws-link">Review →</Link>
              </div>
            ))}
            {gap > 0 && (
              <div className="ws-signal">
                <span className="ws-sicon" aria-hidden><TrendingDown size={15} /></span>
                <div className="min-w-0"><b>{flow.steps[gap - 1].label} → {flow.steps[gap].label}</b><p>{Math.round((1 - gapRate) * 100)}% drop-off at this step based on the current funnel counts.</p></div>
                <Link href="#journey" className="ws-link">Inspect →</Link>
              </div>
            )}
            {cc.attention.length === 0 && gap <= 0 && <p className="ws-empty">All clear · checked {ago(cc.freshAt)}.</p>}
            <div className="ws-summary"><span className="ws-sum-ic" aria-hidden><Target size={16} /></span><span><strong>Priority focus</strong><br />{cc.attention.length ? "Resolve exceptions" : "Keep the queue clear"}{gap > 0 ? ` and advance ${lower(flow.steps[gap - 1].label)} accounts.` : "."}</span></div>
          </section>
          <JourneyPanel steps={flow.steps} accounts={flow.accounts} start={gap > 0 ? gap - 1 : 0} />
        </div>

        <div className="ws-bottom">
          <section className="ws-panel" aria-labelledby="ws-act">
            <div className="ws-panel-head">
              <div>
                <div className="ws-eyebrow sm">04 / Account operations</div>
                <h3 id="ws-act">Account activity</h3>
                <p>Recent events across your companies this week.</p>
              </div>
              <Link href={ev === "stopped" ? "/" : "/?ev=stopped"} scroll={false} className="ws-btn small">{ev === "stopped" ? "Stopped only ⌄" : "All events ⌄"}</Link>
            </div>
            <div className="ws-table-wrap">
              <table className="ws-table">
                <thead><tr><th>Company</th><th>Last event</th><th>Status</th><th>Owner</th><th>Updated</th></tr></thead>
                <tbody>
                  {rows.length === 0 ? <tr><td colSpan={5} className="ws-empty">{companies ? "No matching companies this week." : <>No companies yet. <Link href="/import">Import companies</Link> to get started.</>}</td></tr> : rows.map(({ a, e }) => {
                    const st = statusOf(a);
                    return (
                      <tr key={a.id}>
                        <td><Link href={`/accounts/${a.id}`} className="ws-co"><span className="ws-av" style={{ background: brandColor(a.id) }} aria-hidden>{initials(a.name)}</span><span className="min-w-0"><strong>{a.name}</strong>{a.domain && <small>{a.domain}</small>}</span></Link></td>
                        <td title={e?.reason ?? undefined}>{eventText(e)}</td>
                        <td><span className={`ws-tag ${STATUS_TAG[st]}`}>{st}</span></td>
                        <td>{a.owner?.name ?? "Unassigned"}</td>
                        <td className="tnum">{ago(a.updatedAt)} <Link href={`/accounts/${a.id}`} className="ws-link" aria-label={`Open ${a.name}`}>↗</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className="ws-panel" aria-labelledby="ws-mom">
            <div className="ws-panel-head">
              <div>
                <div className="ws-eyebrow sm">05 / Momentum</div>
                <h3 id="ws-mom">Weekly activity</h3>
                <p>Activity distribution over the last seven days.</p>
              </div>
              <span className="ws-tag">Last 7 days</span>
            </div>
            <div className="ws-activity">
              <GroupedBars categories={days} series={[{ name: "Companies added", values: addedDaily }, { name: "Emails sent", values: sentDaily }]} empty="Nothing happened in the last 7 days." />
              <div className="ws-insight">
                <span><strong>{sum(addedDaily)} compan{sum(addedDaily) === 1 ? "y" : "ies"}</strong> added this week</span>
                <span className="r"><strong>{sum(sentDaily)} email{sum(sentDaily) === 1 ? "" : "s"}</strong><br /><span className="ws-muted">{sum(sentDaily) ? "sent this week" : "No outreach yet"}</span></span>
              </div>
            </div>
          </section>
        </div>

        {companies < 10 && (
          <section className="ws-panel hm2-onboard" aria-label="Import">
            <div className="ws-panel-head"><div><h3>Get companies in</h3></div><Link href="/import" className="ws-link">All options</Link></div>
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

        <footer className="ws-footer"><span>{p.name} · ABM account intelligence</span><span>Every number is counted from recorded events.</span></footer>
    </div>
  );
}
