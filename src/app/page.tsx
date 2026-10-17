import Link from "next/link";
import { ArrowRight, BarChart3, ClipboardCheck, FileSpreadsheet, Globe2, Handshake, Building2, Sparkles, Sun, Upload, LayoutGrid } from "lucide-react";
import { db } from "@/lib/db";
import { ensureSellerPacks, seller } from "@/lib/seller";

export const metadata = { title: "Home" };

/** The first layer: bring data in, or go to work on it. Everything opens in this tab. */
export default async function Landing() {
  await ensureSellerPacks();
  const p = seller();
  const [companies, waiting, approvals, handoffs] = await Promise.all([
    db.account.count({ where: { mergedIntoId: null } }),
    db.prospectSuggestion.count({ where: { sellerId: p.id, status: "new", origin: { in: ["lookalike", "website_visitor"] } } }),
    db.draft.count({ where: { status: "pending_review" } }),
    db.handoff.count({ where: { acknowledgedAt: null, blocked: false } }),
  ]);
  const importWays = [
    { href: "/import/upload", icon: FileSpreadsheet, label: "Upload CSV", sub: "Map columns, preview, import" },
    { href: "/import/lookalikes", icon: Sparkles, label: "Lookalikes", sub: "Companies like one website" },
    { href: "/import/apollo", icon: Globe2, label: "Via Apollo", sub: "Companies visiting your site" },
  ];
  const work = [
    { href: "/work", icon: Sun, label: "Today", sub: "What needs you now" },
    { href: "/accounts", icon: Building2, label: "Research", sub: `${companies} compan${companies === 1 ? "y" : "ies"}, people, signals` },
    { href: "/review", icon: ClipboardCheck, label: "Email drafting", sub: approvals ? `${approvals} waiting for approval` : "Drafts, approvals, sent" },
    { href: "/handoffs", icon: Handshake, label: "Sales", sub: handoffs ? `${handoffs} open hand-off${handoffs === 1 ? "" : "s"}` : "Hand-offs, opportunities, tasks" },
    { href: "/overview", icon: BarChart3, label: "Insights", sub: "Program, analytics, settings" },
  ];
  return (
    <div className="page-enter landing">
      <header className="landing-head">
        <div className="micro">{p.name} · Account intelligence</div>
        <h1 className="landing-title">Where do you want to start?</h1>
        <p className="secondary max-w-xl">Bring companies in, or work on the ones you have. Both lead to the same research, scoring and outreach.</p>
      </header>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="landing-panel">
          <Link href="/import" className="landing-panel-head">
            <span className="layer-icon" aria-hidden><Upload size={22} strokeWidth={1.6} /></span>
            <span className="min-w-0 flex-1"><span className="layer-title">Import data</span><span className="layer-text">Three ways to bring companies in{waiting ? ` · ${waiting} waiting for approval` : ""}</span></span>
            <ArrowRight size={18} className="layer-arrow" />
          </Link>
          <ul className="landing-list">
            {importWays.map((w) => (
              <li key={w.href}><Link href={w.href} className="landing-row"><w.icon size={17} strokeWidth={1.7} /><span className="min-w-0 flex-1"><b>{w.label}</b><span className="muted block text-xs">{w.sub}</span></span><ArrowRight size={14} className="muted" /></Link></li>
            ))}
          </ul>
        </section>
        <section className="landing-panel">
          <Link href="/work" className="landing-panel-head">
            <span className="layer-icon" aria-hidden><LayoutGrid size={22} strokeWidth={1.6} /></span>
            <span className="min-w-0 flex-1"><span className="layer-title">Workspace</span><span className="layer-text">Research, email drafting, sales and insights</span></span>
            <ArrowRight size={18} className="layer-arrow" />
          </Link>
          <ul className="landing-list">
            {work.map((w) => (
              <li key={w.href}><Link href={w.href} className="landing-row"><w.icon size={17} strokeWidth={1.7} /><span className="min-w-0 flex-1"><b>{w.label}</b><span className="muted block text-xs">{w.sub}</span></span><ArrowRight size={14} className="muted" /></Link></li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
