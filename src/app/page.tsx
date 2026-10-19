import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, ArrowUpRight, BarChart3, Building2, FileSpreadsheet, Home as HomeIcon, LayoutGrid, LogOut, Radar, Send, Settings2, Sparkles, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { SESSION_COOKIE, authSecret, verify, type Session } from "@/lib/auth";
import { ensureSellerPacks, seller } from "@/lib/seller";
import { ago } from "@/components/ui";
import { LogoMark } from "@/components/brand/Logo";
import { CountUp, RailLink, RangeToggle, SearchPill, ThemePill } from "@/components/home/client";
import { signOutAction } from "./login/actions";

export const metadata = { title: "Home" };

const DAY = 86_400_000;
type Status = "Researching" | "Awaiting approval" | "Draft ready" | "Researched" | "New";
const STATUS_TONE: Record<Status, string> = { Researching: "sky", "Awaiting approval": "amber", "Draft ready": "violet", Researched: "ink", New: "muted" };
// The buying journey, in order. Watch / recycled / disqualified sit outside it.
const STAGES = [
  { key: "UNAWARE", label: "Unaware" },
  { key: "AWARE", label: "Aware" },
  { key: "ENGAGED", label: "Engaged" },
  { key: "MQA", label: "Ready for sales" },
  { key: "OPPORTUNITY", label: "Opportunity" },
  { key: "CUSTOMER", label: "Customer" },
] as const;

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

/** Home: the numbers, where accounts stand, the two ways in, and what just changed. */
export default async function Home({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await ensureSellerPacks();
  const p = seller();
  const { range = "week" } = await searchParams;
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const since = range === "today" ? new Date(now.getTime() - DAY) : range === "all" ? undefined : new Date(now.getTime() - 7 * DAY);

  const [companies, companiesSinceMonday, toApprove, draftsReady, importedWeek, importedPrevWeek, byStage, recent] = await Promise.all([
    db.account.count({ where: { mergedIntoId: null } }),
    db.account.count({ where: { mergedIntoId: null, createdAt: { gte: monday } } }),
    db.draft.count({ where: { status: "pending_review" } }),
    db.draft.count({ where: { status: "approved", message: null } }),
    db.account.count({ where: { mergedIntoId: null, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    db.account.count({ where: { mergedIntoId: null, createdAt: { gte: new Date(now.getTime() - 14 * DAY), lt: new Date(now.getTime() - 7 * DAY) } } }),
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
  const inJourney = STAGES.reduce((n, s) => n + stageCount(s.key), 0);
  const outside = companies - inJourney;
  const weekDelta = importedWeek - importedPrevWeek;

  const secret = authSecret();
  const session = secret ? await verify<Session>((await cookies()).get(SESSION_COOKIE)?.value, secret) : null;
  const first = session?.email.split("@")[0].split(/[._-]/)[0] ?? "";
  const userName = process.env.APP_USER_NAME?.trim() || (first ? first[0].toUpperCase() + first.slice(1) : "");
  const dateLine = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" }).format(now);

  const kpis = [
    { label: "Companies", accent: "indigo", value: companies, note: companiesSinceMonday ? `+${companiesSinceMonday} since Monday` : "None new since Monday", tone: companiesSinceMonday ? "up" : "" },
    { label: "To approve", accent: "amber", value: toApprove, note: toApprove ? "Drafts waiting for you" : "Nothing waiting", href: "/review", tone: toApprove ? "warn" : "" },
    { label: "Drafts ready", accent: "violet", value: draftsReady, note: "Approved, not sent", tone: "" },
    { label: "Imported this week", accent: "sky", value: importedWeek, note: weekDelta ? `${weekDelta > 0 ? "+" : ""}${weekDelta} on last week` : "Same as last week", tone: weekDelta > 0 ? "up" : weekDelta < 0 ? "down" : "" },
  ];

  return (
    <div className="hm-outer">
    <div className="hm">
      <nav className="hm-rail" aria-label="Main">
        <Link href="/" className="hm-logo" aria-label="ABM home"><LogoMark size={40} /></Link>
        <div className="hm-rail-items">
          <RailLink href="/" label="Home"><HomeIcon size={19} strokeWidth={1.8} /></RailLink>
          <RailLink href="/import" label="Import"><Upload size={19} strokeWidth={1.8} /></RailLink>
          <RailLink href="/work" label="Workspace"><LayoutGrid size={19} strokeWidth={1.8} /></RailLink>
          <RailLink href="/accounts" label="Research"><Building2 size={19} strokeWidth={1.8} /></RailLink>
          <RailLink href="/outreach" label="Emails"><Send size={19} strokeWidth={1.8} /></RailLink>
          <RailLink href="/overview" label="Insights"><BarChart3 size={19} strokeWidth={1.8} /></RailLink>
        </div>
        <div className="hm-rail-foot">
          <RailLink href="/settings" label="Settings"><Settings2 size={19} strokeWidth={1.8} /></RailLink>
          <form action={signOutAction}><button type="submit" className="hs-rail-item" data-tip="Sign out" aria-label="Sign out"><LogOut size={19} strokeWidth={1.8} /></button></form>
        </div>
      </nav>

      <div className="hm-main">
        <header className="hm-top">
          <div className="min-w-0">
            <div className="hm-date">{dateLine}</div>
            <h1 className="hm-title">{greeting(now)}{userName ? `, ${userName}` : ""}</h1>
            <p className="hm-brief">{toApprove ? <><b>{toApprove} draft{toApprove === 1 ? "" : "s"}</b> waiting for your approval</> : "Nothing is waiting for you"}{stageCount("MQA") ? <> · <b>{stageCount("MQA")}</b> ready for sales</> : null}{importedWeek ? <> · <b>{importedWeek}</b> imported this week</> : null}.</p>
          </div>
          <div className="hm-tools">
            <SearchPill />
            <ThemePill />
            {session?.email && <span className="hm-who" title={session.email}><span className="hm-avatar">{(userName || session.email)[0].toUpperCase()}</span></span>}
          </div>
        </header>

        <section className="hm-kpis" aria-label="Key numbers">
          {kpis.map((k) => {
            const body = (
              <>
                <span className="hm-k-label">{k.label}</span>
                <span className="hm-k-value tnum"><CountUp value={k.value} /></span>
                <span className={`hm-k-note ${k.tone}`}>{k.note}</span>
                {k.href && <ArrowUpRight size={16} className="hm-k-go" />}
              </>
            );
            return k.href ? <Link key={k.label} href={k.href} className={`hm-k link a-${k.accent}`}>{body}</Link> : <div key={k.label} className={`hm-k a-${k.accent}`}>{body}</div>;
          })}
        </section>

        <section className="hm-journey" aria-label="Where your accounts are">
          <div className="hm-sec-head">
            <h2>Where your accounts are</h2>
            <span className="hm-sec-meta">{inJourney} in the buying journey{outside > 0 ? ` · ${outside} watched or ruled out` : ""}</span>
          </div>
          <ol className="hm-stages">
            {STAGES.map((s, i) => {
              const n = stageCount(s.key);
              const share = inJourney ? n / inJourney : 0;
              return (
                <li key={s.key} className={n ? "has" : ""}>
                  <Link href={`/accounts?stage=${s.key}`}>
                    <span className="hm-st-n tnum">{n}</span>
                    <span className="hm-st-l"><span className="hm-st-i">{String(i + 1).padStart(2, "0")}</span>{s.label}</span>
                    <span className="hm-st-bar"><span style={{ width: `${Math.max(n ? 6 : 0, Math.round(share * 100))}%` }} /></span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="hm-doors">
          <Link href="/work" className="hm-work">
            <span className="hm-work-kicker">Workspace</span>
            <span className="hm-work-title">Pick up where the work is.</span>
            <span className="hm-work-text">Today&apos;s list, research, email drafting, sales hand-offs and insights.</span>
            <span className="hm-work-facts">
              <span><b className="tnum">{companies}</b> compan{companies === 1 ? "y" : "ies"}</span>
              <span><b className="tnum">{toApprove}</b> to approve</span>
              <span><b className="tnum">{draftsReady}</b> ready to send</span>
            </span>
            <span className="hm-work-go">Open workspace <ArrowRight size={17} strokeWidth={2} /></span>
          </Link>

          <div className="hm-import">
            <div className="hm-sec-head"><h2>Import</h2><Link href="/import" className="hm-sec-link">All options</Link></div>
            <ul>
              {[
                { href: "/import/upload", icon: FileSpreadsheet, label: "Upload a CSV", hint: "Map columns, preview, import" },
                { href: "/import/lookalikes", icon: Sparkles, label: "Find lookalikes", hint: "Companies like one website" },
                { href: "/import/apollo", icon: Radar, label: "Website visitors", hint: "Identified by Apollo" },
              ].map((r, i) => (
                <li key={r.href}>
                  <Link href={r.href} className="hm-imp-row">
                    <span className="hm-imp-i">{String(i + 1).padStart(2, "0")}</span>
                    <r.icon size={18} strokeWidth={1.8} className="hm-imp-ic" />
                    <span className="min-w-0 flex-1"><span className="hm-imp-l">{r.label}</span><span className="hm-imp-h">{r.hint}</span></span>
                    <ArrowRight size={16} className="hm-imp-go" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="hm-activity" aria-label="Recent activity">
          <div className="hm-sec-head">
            <h2>Recent activity</h2>
            <div className="flex items-center gap-4"><RangeToggle /><Link href="/accounts" className="hm-sec-link">View all</Link></div>
          </div>
          {recent.length === 0 ? (
            <p className="hm-empty">Nothing changed {range === "today" ? "today" : range === "week" ? "this week" : "yet"}. <Link href="/import">Import companies</Link> to get started.</p>
          ) : (
            <table className="hm-table">
              <thead><tr><th>Company</th><th>Status</th><th>Owner</th><th className="r">Updated</th></tr></thead>
              <tbody>
                {recent.map((a) => {
                  const s = statusOf(a);
                  return (
                    <tr key={a.id}>
                      <td data-l="Company"><Link href={`/accounts/${a.id}`} className="hm-co"><span className="hm-co-av" style={{ background: `linear-gradient(135deg, ${brandColor(a.id)}, ${brandColor(a.id)}CC)`, boxShadow: `0 6px 14px ${brandColor(a.id)}40` }} aria-hidden>{initials(a.name)}</span><span className="min-w-0"><span className="hm-co-n">{a.name}</span>{a.domain && <span className="hm-co-d">{a.domain}</span>}</span></Link></td>
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

        <footer className="hm-foot">{p.name} · ABM account intelligence</footer>
      </div>
    </div>
    </div>
  );
}
