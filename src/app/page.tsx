import { humanize } from "@/lib/labels";
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
import { VegaOrb } from "@/components/home/vega-orb";
import { openDecisions } from "@/lib/decisions";
import { SearchPill, ThemePill } from "@/components/home/client";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { JobsIndicator } from "@/components/shell/JobsIndicator";
import { Donut, GroupedBars, change, dayLabels, daily } from "@/components/viz/cards";
import { AreaTrend } from "@/components/charts";
import { PeekPanel, closeHref, peekHref } from "@/components/peek/panel";
import { ListKeys } from "@/components/peek/list-keys";

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

/** A 14-day sparkline for a metric tile: a smooth curve across the tile's foot with a soft fill. */
function Spark({ points, id }: { points: number[]; id: string }) {
  const W = 300, H = 34, max = Math.max(1, ...points);
  const pts = points.map((v, i) => [(i / Math.max(1, points.length - 1)) * W, H - 3 - (v / max) * (H - 8)] as const);
  // Catmull-Rom to cubic Bezier: a smooth line through every day's point.
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return (
    <svg className="ws-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <defs><linearGradient id={`sp-${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" className="ws-spark-s0" /><stop offset="100%" className="ws-spark-s1" /></linearGradient></defs>
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={`url(#sp-${id})`} />
      <path d={d} className="ws-spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** "↑ 30% vs last 14 days" (or the plain count when there is nothing to compare with). */
function Trend({ pct, total, unit }: { pct: number | null; total: number; unit: string }) {
  if (pct === null || pct === 0) return <span className="ws-trend">{total} {unit} in 14 days{pct === 0 ? " · no change" : ""}</span>;
  return <span className="ws-trend"><span className={pct > 0 ? "ws-up" : "ws-down"}>{pct > 0 ? "↑" : "↓"} {Math.abs(pct)}%</span> vs last 14 days</span>;
}

/** Home is the Command Center: what needs doing, where companies stand, what is stuck, and the two ways in. */
export default async function Home({ searchParams }: { searchParams: Promise<{ range?: string; ev?: string; peek?: string; wk?: string }> }) {
  await ensureSellerPacks();
  const p = await activeSeller();
  const { range = "week", ev, peek, wk } = await searchParams;
  const keep = { ev, wk };
  const peekTo = (kind: "a" | "d", id: string) => peekHref("/", keep, kind, id);
  const long = wk === "30";
  const now = new Date();
  const since = range === "today" ? new Date(now.getTime() - DAY) : range === "all" ? undefined : new Date(now.getTime() - 7 * DAY);

  // Start every independent query at once; each section below awaits only its own.
  const wkAgo = new Date(now.getTime() - 30 * DAY);
  const d28 = new Date(now.getTime() - 28 * DAY);
  const ccP = Promise.all([commandCenter(now), companyFlow(now)]);
  const wkP = Promise.all([
    db.account.findMany({ where: { mergedIntoId: null, createdAt: { gte: wkAgo } }, select: { createdAt: true } }),
    db.message.findMany({ where: { sentAt: { gte: wkAgo } }, select: { sentAt: true } }),
  ]);
  const datesP = Promise.all([
    db.reviewItem.findMany({ where: { createdAt: { gte: d28 } }, select: { createdAt: true } }),
    db.pipelineEvent.findMany({ where: { createdAt: { gte: d28 }, outcome: "pass", step: { startsWith: "fit_tier" } }, select: { createdAt: true } }),
    db.accountBrief.findMany({ where: { createdAt: { gte: d28 } }, select: { createdAt: true } }),
    db.opportunity.findMany({ where: { createdAt: { gte: d28 } }, select: { createdAt: true } }),
  ]);
  const baseP = Promise.all([
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
  const centerP = openDecisions("all", 30);
  const meP = getMe();
  // Awaited further down; a failure surfaces there, not as an unhandled rejection.
  for (const q of [ccP, wkP, datesP, baseP, centerP, meP]) q.catch(() => {});
  const [cc, flow] = await ccP;
  // Two weeks of dates: the last 7 days are charted, the 7 before give "vs last week".
    const [wkAccounts, wkSent] = await wkP;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const addedDaily = daily(wkAccounts.map((a) => a.createdAt), 7, now);
  const sentDaily = daily(wkSent.map((m) => m.sentAt).filter((d): d is Date => Boolean(d)), 7, now);
  const days = dayLabels(7, now);
  const added30 = daily(wkAccounts.map((a) => a.createdAt), 30, now);
  const added30Data = dayLabels(30, now).map((label, i) => ({ label, value: added30[i] }));
  const dayKey = (i: number, n: number) => new Date(now.getTime() - (n - 1 - i) * DAY).toISOString().slice(0, 10);

  // 28 days of each tile's events: the last 14 drawn as a sparkline, the 14 before for the change.
  const [rvDates, fitDates, briefDates, oppDates] = await datesP;
  const trend = (dates: { createdAt: Date }[]) => {
    const all = daily(dates.map((x) => x.createdAt), 28, now);
    const last = all.slice(14), prev = all.slice(0, 14);
    return { points: last, total: sum(last), pct: change(sum(last), sum(prev)) };
  };
  const tiles = { decisions: trend(rvDates), qualified: trend(fitDates), research: trend(briefDates), opps: trend(oppDates) };
  const [companies, importedWeek, byStage, recent] = await baseP;
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
    return what[area] ?? humanize(area);
  };
  const waitingKpi = cc.kpis.find((k) => k.key === "approve");
  const waiting = Number(waitingKpi?.value ?? 0);
  const waitingSplit = waitingKpi?.note ?? "";
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
  const me = await meP;
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

  const center = await centerP;
  const queue = center.items.map((d) => ({ id: d.id, kind: d.kind, label: d.label, title: d.title, description: d.description, href: peekTo("d", d.id), ago: ago(d.createdAt) }));
  const STAGE_WORD: Record<string, string> = { UNAWARE: "Not contacted", AWARE: "Aware", ENGAGED: "Engaged", MQA: "Ready for sales", OPPORTUNITY: "Opportunity", CUSTOMER: "Customer", WATCH: "Watching", DISQUALIFIED: "Ruled out", RECYCLED: "Recycled" };
  const stageData = byStage.map((b) => ({ label: STAGE_WORD[b.stage] ?? b.stage, value: b._count, href: `/accounts?stage=${b.stage}` }));
  const ageDays = center.items.map((d) => (now.getTime() - d.createdAt.getTime()) / DAY);
  const ages = { today: ageDays.filter((d) => d < 1).length, few: ageDays.filter((d) => d >= 1 && d < 3).length, old: ageDays.filter((d) => d >= 3).length };
  const fv = (k: string) => cc.funnel.find((f) => f.key === k)?.value ?? 0;
  const [nImported, nQualified, nResearched] = [fv("imported"), fv("qualified"), fv("researched")];
  const opps = cc.kpis.find((k) => k.key === "opps");
  const stuck = gap > 0 ? reachedN[gap - 1] - reachedN[gap] : 0;
  const strip = flow.steps.slice(0, 5);
  const rows = recent.map((a, i) => ({ a, e: lastEvents[i] })).filter((r) => ev !== "stopped" || r.e?.outcome === "block");
  const exportRows: [string, number, string][] = flow.steps.map((st, i) => [st.label, reachedN[i], i === 0 ? "Entry point" : reachedN[i - 1] ? `${Math.round((reachedN[i] / reachedN[i - 1]) * 100)}% of ${lower(flow.steps[i - 1].label)}` : "No conversions yet"]);
  const firstName = userName ? `, ${userName}` : "";
  // Vega lives on Home (Super Admins for now): a live core that opens the conversation in place.
  const vega = me?.superAdmin
    ? await (async () => {
        const { activeSellerId } = await import("@/lib/scope");
        const cid = await activeSellerId();
        const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
        const [setting, doneToday, recentActs] = await Promise.all([
          db.agentSetting.findUnique({ where: { sellerId: cid }, select: { enabled: true, paused: true } }),
          db.agentAction.count({ where: { sellerId: cid, level: { gt: 0 }, status: "done", createdAt: { gte: dayStart } } }),
          db.agentAction.findMany({ where: { sellerId: cid, level: { gt: 0 } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, reason: true, status: true, createdAt: true } }),
        ]);
        const { recommendedApprovals, agreement } = await import("@/lib/agent/approvals");
        const [recs, agreed] = await Promise.all([recommendedApprovals(10).catch(() => []), agreement(cid).catch(() => ({ decisions: 0, agreedShare: null }))]);
        // The client's own name: the brain pack falls back to the default client while a new client's brain is incomplete.
        const name = (await db.client.findUnique({ where: { id: cid }, select: { name: true } }).catch(() => null))?.name ?? p.name;
        return { cid, name, on: Boolean(setting?.enabled && !setting.paused), doneToday, agreed, recs: recs.map((r) => ({ draftId: r.draftId, reviewId: r.reviewId, person: r.person, company: r.company, subject: r.subject, strength: r.strength, recommendation: r.recommendation, reasons: r.reasons, waitingDays: r.waitingDays })), actions: recentActs.map((a) => ({ id: a.id, reason: a.reason, status: a.status, at: a.createdAt.toISOString() })) };
      })().catch(() => null)
    : null;

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
          <div className="ws-heading-side">
            {vega && <VegaOrb clientId={vega.cid} clientName={vega.name} doneToday={vega.doneToday} waiting={waiting} actions={vega.actions} on={vega.on} recs={vega.recs} agreement={vega.agreed} />}
            <ExportView rows={exportRows} />
          </div>
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
              {waiting ? `${waiting} waiting for you (${waitingSplit}).` : "Nothing is waiting for you."}{" "}
              {nQualified} compan{nQualified === 1 ? "y is" : "ies are"} qualified{gap > 0 ? `, while ${stuck} ${lower(flow.steps[gap - 1].label)} ${stuck === 1 ? "account has" : "accounts have"} not progressed to ${lower(flow.steps[gap].label)}.` : "."}
            </p>
            <div className="ws-hero-actions">
              <Link href="/review" className="ws-btn">{waiting ? `Review ${waiting} waiting` : "Open approvals"} <ArrowUpRight size={13} /></Link>
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
          <Link href="/review" className="ws-metric m0"><div className="ws-metric-top">Waiting for you <span className="ws-micon"><Inbox size={16} /></span></div><div className="ws-metric-v tnum">{waiting}</div><div className="ws-metric-d">{waitingSplit} · <Trend pct={tiles.decisions.pct} total={tiles.decisions.total} unit="opened" /></div><Spark id="dec" points={tiles.decisions.points} /></Link>
          <Link href="/accounts?flow=qualified" className="ws-metric m1"><div className="ws-metric-top">Qualified accounts <span className="ws-micon"><BadgeCheck size={16} /></span></div><div className="ws-metric-v tnum">{nQualified} <span className="ws-denom">/ {nImported}</span></div><div className="ws-metric-d"><span className="ws-delta">{nImported ? Math.round((nQualified / nImported) * 100) : 0}%</span> qualification rate · <Trend pct={tiles.qualified.pct} total={tiles.qualified.total} unit="passed fit" /></div><Spark id="qual" points={tiles.qualified.points} /></Link>
          <Link href="/accounts?flow=researched" className="ws-metric m2"><div className="ws-metric-top">Research complete <span className="ws-micon"><FlaskConical size={16} /></span></div><div className="ws-metric-v tnum">{nResearched}</div><div className="ws-metric-d">Of {nQualified} qualified compan{nQualified === 1 ? "y" : "ies"} · <Trend pct={tiles.research.pct} total={tiles.research.total} unit="briefs written" /></div><Spark id="res" points={tiles.research.points} /></Link>
          <Link href={opps?.href || "/accounts?flow=opportunity"} className="ws-metric m3"><div className="ws-metric-top">Open opportunities <span className="ws-micon"><Briefcase size={16} /></span></div><div className="ws-metric-v tnum">{opps?.value ?? 0}</div><div className="ws-metric-d">{opps?.value ? opps.note : "No opportunities recorded"} · <Trend pct={tiles.opps.pct} total={tiles.opps.total} unit="created" /></div><Spark id="opp" points={tiles.opps.points} /></Link>
        </section>

        <div className="ws-main">
          <div className="ws-col">
            <DecisionPanel items={queue} counts={center.counts} ages={ages} />
            <JourneyPanel steps={flow.steps} accounts={flow.accounts} start={gap > 0 ? gap - 1 : 0} />
          </div>
          <aside className="ws-rail" aria-label="Signals and breakdowns">
            <section className="ws-panel" aria-labelledby="ws-sig">
              <div className="ws-panel-head">
                <div>
                  <div className="ws-eyebrow sm">02 / Signals</div>
                  <h3 id="ws-sig">Attention &amp; signals</h3>
                  <p>What needs a human decision.</p>
                </div>
                <Link href="/review" className="ws-btn small">All</Link>
              </div>
              {cc.attention.slice(0, 3).map((a, i) => (
                <Link key={i} href={a.href} className="ws-signal">
                  <span className={`ws-sicon ${a.tone}`} aria-hidden><AlertTriangle size={15} /></span>
                  <div className="min-w-0"><b>{a.title}</b> <span className={`ws-tag ${a.tone === "risk" ? "red" : a.tone === "warn" ? "amber" : "purple"}`}>{a.kind}</span><p>{a.detail}</p></div>
                </Link>
              ))}
              {gap > 0 && (
                <Link href={`/accounts?flow=${flow.steps[gap - 1].key}`} className="ws-signal">
                  <span className="ws-sicon" aria-hidden><TrendingDown size={15} /></span>
                  <div className="min-w-0"><b>{flow.steps[gap - 1].label} → {flow.steps[gap].label}</b><p>{Math.round((1 - gapRate) * 100)}% drop-off at this step. See the {stuck} compan{stuck === 1 ? "y" : "ies"}.</p></div>
                </Link>
              )}
              {cc.attention.length === 0 && gap <= 0 && <p className="ws-empty">All clear · checked {ago(cc.freshAt)}.</p>}
            </section>
            <section className="ws-panel" aria-labelledby="ws-stage">
              <div className="ws-panel-head">
                <div>
                  <div className="ws-eyebrow sm">03 / Breakdown</div>
                  <h3 id="ws-stage">Companies by stage</h3>
                  <p>Click a stage to see its companies.</p>
                </div>
                <Link href="/accounts" className="ws-btn small">All companies</Link>
              </div>
              <div className="ws-donut"><Donut data={stageData} center="companies" size={180} empty="No companies yet." /></div>
            </section>
            <section className="ws-panel" aria-labelledby="ws-mom">
              <div className="ws-panel-head">
                <div>
                  <div className="ws-eyebrow sm">04 / Momentum</div>
                  <h3 id="ws-mom">{long ? "Last 30 days" : "This week"}</h3>
                  <p>{long ? "Companies added per day." : "Companies added and emails sent per day."}</p>
                </div>
                <div className="k-seg sg-seg" role="group" aria-label="Period">
                  <Link href={peek ? `/?wk=7&peek=${peek}` : "/"} scroll={false} className={long ? undefined : "on"}>7d</Link>
                  <Link href={peek ? `/?wk=30&peek=${peek}` : "/?wk=30"} scroll={false} className={long ? "on" : undefined}>30d</Link>
                </div>
              </div>
              <div className="ws-activity">
                {long ? <AreaTrend data={added30Data} unit="companies" height={180} empty="No companies added in 30 days." /> : <GroupedBars categories={days} series={[{ name: "Companies added", values: addedDaily }, { name: "Emails sent", values: sentDaily }]} height={180} empty="Nothing happened in the last 7 days." />}
                {!long && <div className="ws-daylinks" aria-label="Companies added by day">{addedDaily.map((v, i) => v ? <Link key={i} href={`/accounts?added=${dayKey(i, 7)}`}>{days[i]} · {v}</Link> : null)}</div>}
                <div className="ws-insight">
                  <span><strong>{long ? sum(added30) : sum(addedDaily)} compan{(long ? sum(added30) : sum(addedDaily)) === 1 ? "y" : "ies"}</strong> added</span>
                  {!long && <span className="r"><strong>{sum(sentDaily)} email{sum(sentDaily) === 1 ? "" : "s"}</strong> sent</span>}
                </div>
              </div>
            </section>
          </aside>
        </div>

        <section className="ws-panel ws-wide-panel" aria-labelledby="ws-act">
          <div className="ws-panel-head">
            <div>
              <div className="ws-eyebrow sm">05 / Account operations</div>
              <h3 id="ws-act">Account activity</h3>
              <p>Recent events across your companies. Click a row to preview it.</p>
            </div>
            <Link href={ev === "stopped" ? (wk ? `/?wk=${wk}` : "/") : `/?ev=stopped${wk ? `&wk=${wk}` : ""}`} scroll={false} className="ws-btn small">{ev === "stopped" ? "Stopped only ⌄" : "All events ⌄"}</Link>
          </div>
          <div className="ws-table-wrap">
            <table className="ws-table">
              <thead><tr><th>Company</th><th>Last event</th><th>Status</th><th>Owner</th><th>Updated</th></tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={5} className="ws-empty">{companies ? "No matching companies this week." : <>No companies yet. <Link href="/import">Import companies</Link> to get started.</>}</td></tr> : rows.map(({ a, e }) => {
                  const st = statusOf(a);
                  return (
                    <tr key={a.id} data-row-select={peekTo("a", a.id)} data-row-open={`/accounts/${a.id}`} className={peek === `a_${a.id}` ? "is-on" : undefined} data-selected={peek === `a_${a.id}` ? "" : undefined}>
                      <td><Link href={peekTo("a", a.id)} scroll={false} className="ws-co"><span className="ws-av" style={{ background: brandColor(a.id) }} aria-hidden>{initials(a.name)}</span><span className="min-w-0"><strong>{a.name}</strong>{a.domain && <small>{a.domain}</small>}</span></Link></td>
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
        <PeekPanel peek={peek} close={closeHref("/", keep)} />
        <ListKeys />
    </div>
  );
}
