import Link from "next/link";
import { Brain, DollarSign, Plug, ShieldCheck, SlidersHorizontal, Users, Activity } from "lucide-react";
import { db } from "@/lib/db";
import { getMe } from "@/lib/me";
import { PageHeader } from "@/components/ui";
import { aiPause } from "@/lib/admin/ai-pause";
import { integrations } from "@/lib/admin/integrations";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

/** Admin: every workspace setting in one place. */
export default async function AdminHome() {
  const me = await getMe();
  const sup = Boolean(me?.superAdmin);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [list, paused, users, clients, spend, queued] = await Promise.all([
    integrations(),
    aiPause(),
    db.user.count({ where: { status: "active" } }),
    db.client.count(),
    db.ledgerEntry.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { amountMicros: true } }),
    db.account.count({ where: { pipelineStatus: "queued", mergedIntoId: null } }),
  ]);
  const live = list.filter((i) => i.state === "connected").length;
  const setup = list.filter((i) => i.state === "setup" || i.state === "off").length;
  const usd = (spend._sum.amountMicros ?? 0) / 1_000_000;
  const tiles = [
    { href: "/admin/integrations", icon: Plug, title: "Integrations", text: `${live} connected${setup ? ` · ${setup} to set up` : ""}`, show: true },
    { href: "/brain", icon: Brain, title: "Account Brain", text: "What the client sells, to whom, and how to talk about it", show: true },
    { href: "/settings", icon: SlidersHorizontal, title: "Settings", text: "Seller pack, senders, knowledge base", show: true },
    { href: "/team", icon: Users, title: "Team & Access", text: `${users} people · ${clients} client accounts`, show: sup },
    { href: "/team?tab=system", icon: Activity, title: "System health", text: paused ? `AI paused · ${queued} companies waiting` : `${queued} companies in the queue`, show: sup },
    { href: "/team?tab=system", icon: DollarSign, title: "Usage & spend", text: `$${usd.toFixed(2)} recorded this month`, show: sup },
  ].filter((t) => t.show);
  return (
    <div className="page-enter">
      <PageHeader eyebrow="Admin" title="Workspace settings" sub="Connections, the Account Brain, team and system health." />
      {paused && sup && (
        <div className="ad-banner" role="status"><ShieldCheck size={16} /> <span><b>AI is paused</b> by an admin. {queued} companies are waiting in the queue.</span> <Link href="/team?tab=system" className="btn btn-secondary btn-sm">Review</Link></div>
      )}
      <div className="ig-grid">
        {tiles.map((t) => (
          <Link key={t.title} href={t.href} className="glass-card ad-tile">
            <span className="ad-ic"><t.icon size={18} /></span>
            <span className="min-w-0"><b>{t.title}</b><small>{t.text}</small></span>
          </Link>
        ))}
      </div>
    </div>
  );
}
