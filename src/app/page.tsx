import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, BarChart3, Building2, ChevronDown, ChevronRight, FileSpreadsheet, Home as HomeIcon, LayoutGrid, Radar, Send, Settings2, Sparkles, Upload } from "lucide-react";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE, authSecret, verify, type Session } from "@/lib/auth";
import { signOutAction } from "./login/actions";
import { ensureSellerPacks, seller } from "@/lib/seller";
import { ago } from "@/components/ui";
import { CountUp, RailLink, RangeToggle, SearchPill, ThemePill } from "@/components/home/client";

export const metadata = { title: "Home" };

const DAY = 86_400_000;
type Status = "Researching" | "Awaiting approval" | "Draft ready" | "Approved" | "New" | "Researched";
const STATUS_TONE: Record<Status, string> = { Researching: "sky", "Awaiting approval": "amber", "Draft ready": "violet", Approved: "emerald", New: "neutral", Researched: "neutral" };
const AVATAR = ["#6366F1", "#7C3AED", "#0EA5E9", "#10B981", "#F59E0B", "#EC4899", "#14B8A6", "#8B5CF6"];
const avatarColor = (s: string) => AVATAR[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR.length];

function greeting(d: Date) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" }).format(d));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function SparkleMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5z" fill="#fff" />
      <path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" fill="#fff" opacity=".8" />
    </svg>
  );
}

/** Home: live numbers first, then the two ways in (Workspace, Import), then what just happened. */
export default async function Home({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await ensureSellerPacks();
  const p = seller();
  const { range = "week" } = await searchParams;
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const since = range === "today" ? new Date(now.getTime() - DAY) : range === "all" ? undefined : new Date(now.getTime() - 7 * DAY);

  const [companies, companiesSinceMonday, toApprove, draftsReady, importedWeek, importedPrevWeek, recent] = await Promise.all([
    db.account.count({ where: { mergedIntoId: null } }),
    db.account.count({ where: { mergedIntoId: null, createdAt: { gte: monday } } }),
    db.draft.count({ where: { status: "pending_review" } }),
    db.draft.count({ where: { status: "approved", message: null } }),
    db.account.count({ where: { mergedIntoId: null, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    db.account.count({ where: { mergedIntoId: null, createdAt: { gte: new Date(now.getTime() - 14 * DAY), lt: new Date(now.getTime() - 7 * DAY) } } }),
    db.account.findMany({
      where: { mergedIntoId: null, ...(since ? { updatedAt: { gte: since } } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 5,
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
  const weekDelta = importedWeek - importedPrevWeek;
  const secret = authSecret();
  const session = secret ? await verify<Session>((await cookies()).get(SESSION_COOKIE)?.value, secret) : null;
  const fromEmail = session?.email.split("@")[0].split(/[._-]/)[0] ?? "";
  const userName = process.env.APP_USER_NAME?.trim() || (fromEmail ? fromEmail[0].toUpperCase() + fromEmail.slice(1) : "");
  const initial = (userName || p.name)[0]?.toUpperCase() ?? "A";

  const kpis = [
    { label: "Companies", value: companies, tone: "indigo", meta: companiesSinceMonday ? { up: true, text: `+${companiesSinceMonday} since Monday` } : { text: "No new ones since Monday" } },
    { label: "To approve", value: toApprove, tone: "amber", href: "/review", meta: { text: toApprove ? "Drafts waiting for you" : "All clear" } },
    { label: "Drafts ready", value: draftsReady, tone: "violet", meta: { text: "Approved, not sent yet" } },
    { label: "Imported this week", value: importedWeek, tone: "sky", meta: weekDelta ? { up: weekDelta > 0, text: `${weekDelta > 0 ? "+" : ""}${weekDelta} vs last week` } : { text: "Same as last week" } },
  ];

  return (
    <div className="hs-outer">
      <div className="hs-shell glass-panel">
        <nav className="hs-rail" aria-label="Main">
          <Link href="/" className="hs-logo" aria-label="Home"><SparkleMark /></Link>
          <div className="hs-rail-items">
            <RailLink href="/" label="Home"><HomeIcon size={20} strokeWidth={2} /></RailLink>
            <RailLink href="/import" label="Import"><Upload size={20} strokeWidth={2} /></RailLink>
            <RailLink href="/work" label="Workspace"><LayoutGrid size={20} strokeWidth={2} /></RailLink>
            <RailLink href="/accounts" label="Research"><Building2 size={20} strokeWidth={2} /></RailLink>
            <RailLink href="/outreach" label="Emails"><Send size={20} strokeWidth={2} /></RailLink>
            <RailLink href="/overview" label="Insights"><BarChart3 size={20} strokeWidth={2} /></RailLink>
          </div>
          <div className="hs-rail-foot"><RailLink href="/settings" label="Settings"><Settings2 size={20} strokeWidth={2} /></RailLink></div>
        </nav>

        <div className="hs-body">
          <header className="hs-top">
            <div className="min-w-0">
              <div className="hs-micro">{p.name} · Account intelligence</div>
              <h1 className="hs-title">{greeting(now)}{userName ? `, ${userName}` : ""}</h1>
            </div>
            <div className="hs-tools">
              <SearchPill />
              <ThemePill />
              <details className="hs-usermenu">
                <summary className="hs-user" aria-label="Account menu">
                  <span className="hs-avatar">{initial}</span>
                  <span className="hs-user-name">{userName || "You"}</span>
                  <ChevronDown size={15} strokeWidth={2} />
                </summary>
                <div className="hs-usermenu-pop">
                  {session?.email && <div className="who">Signed in as {session.email}</div>}
                  <Link href="/settings">Settings</Link>
                  <form action={signOutAction}><button type="submit">Sign out</button></form>
                </div>
              </details>
            </div>
          </header>

          <div className="hs-content page-enter">
            <section className="hs-kpis stagger" aria-label="Key numbers">
              {kpis.map((k) => {
                const inner = (
                  <>
                    <div className="hs-kpi-label">{k.label}{k.href && k.value > 0 && <span className="hs-pop" aria-hidden />}</div>
                    <div className="hs-kpi-value tnum"><CountUp value={k.value} /></div>
                    <div className="hs-kpi-meta">
                      {"up" in k.meta && k.meta.up !== undefined && (k.meta.up ? <ArrowUp size={12} className="up" /> : <ArrowDown size={12} className="down" />)}
                      {k.meta.text}
                    </div>
                  </>
                );
                return k.href ? (
                  <Link key={k.label} href={k.href} className={`hs-kpi tone-${k.tone} clickable`}>{inner}</Link>
                ) : (
                  <div key={k.label} className={`hs-kpi tone-${k.tone}`}>{inner}</div>
                );
              })}
            </section>

            <section className="hs-actions stagger">
              <article className="hs-work">
                <div className="hs-work-top">
                  <span className="hs-work-icon" aria-hidden><LayoutGrid size={26} strokeWidth={2} /></span>
                  <span className="hs-live"><span className="dot" /> Live</span>
                </div>
                <h2 className="hs-work-title">Workspace</h2>
                <p className="hs-work-text">Today&apos;s list, research, email drafting, sales and insights.</p>
                <div className="hs-chips">
                  <span className="hs-chip">{companies} compan{companies === 1 ? "y" : "ies"}</span>
                  <span className="hs-chip amber">{toApprove} to approve</span>
                  <span className="hs-chip violet">{draftsReady} draft{draftsReady === 1 ? "" : "s"}</span>
                </div>
                <Link href="/work" className="hs-cta">Open workspace <ArrowRight size={16} strokeWidth={2.2} /></Link>
              </article>

              <article className="hs-import glass-card">
                <h2 className="hs-import-title">Import</h2>
                <p className="hs-import-sub">Add companies</p>
                <ul className="hs-rows">
                  {[
                    { href: "/import/upload", icon: FileSpreadsheet, label: "Upload CSV", hint: "Drag a file or browse" },
                    { href: "/import/lookalikes", icon: Sparkles, label: "Find lookalikes", hint: "From one website" },
                    { href: "/import/apollo", icon: Radar, label: "Apollo visitors", hint: "Companies visiting your site" },
                  ].map((r) => (
                    <li key={r.href}>
                      <Link href={r.href} className="hs-row">
                        <span className="hs-row-tile" aria-hidden><r.icon size={18} strokeWidth={2} /></span>
                        <span className="min-w-0 flex-1"><span className="hs-row-label">{r.label}</span><span className="hs-row-hint">{r.hint}</span></span>
                        <ChevronRight size={16} className="hs-row-chev" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </article>
            </section>

            <section className="hs-activity glass-card-static" aria-label="Recent activity">
              <div className="hs-act-head">
                <h2>Recent activity</h2>
                <div className="flex items-center gap-3">
                  <RangeToggle />
                  <Link href="/accounts?sort=updated" className="hs-ghost">View all</Link>
                </div>
              </div>
              {recent.length === 0 ? (
                <p className="hs-empty">Nothing changed {range === "today" ? "today" : range === "week" ? "this week" : "yet"}. Import companies to get started.</p>
              ) : (
                <table className="hs-table">
                  <thead><tr><th>Company</th><th>Status</th><th>Owner</th><th>Updated</th></tr></thead>
                  <tbody>
                    {recent.map((a) => {
                      const s = statusOf(a);
                      return (
                        <tr key={a.id}>
                          <td data-l="Company">
                            <Link href={`/accounts/${a.id}`} className="hs-co">
                              <span className="hs-co-av" style={{ background: avatarColor(a.name) }} aria-hidden>{a.name[0]?.toUpperCase()}</span>
                              <span className="min-w-0"><span className="hs-co-name">{a.name}</span>{a.domain && <span className="hs-co-domain">{a.domain}</span>}</span>
                            </Link>
                          </td>
                          <td data-l="Status"><span className={`hs-status ${STATUS_TONE[s]}`}>{s}</span></td>
                          <td data-l="Owner" className="hs-muted">{a.owner?.name ?? "Unassigned"}</td>
                          <td data-l="Updated" className="hs-muted">{ago(a.updatedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
