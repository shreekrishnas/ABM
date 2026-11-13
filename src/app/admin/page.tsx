import Link from "next/link";
import { Brain, DollarSign, Plug, SlidersHorizontal, Users, Activity } from "lucide-react";
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
  const full = Boolean(me?.fullSuperAdmin);
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
  const offNames = list.filter((i) => i.state === "setup" || i.state === "off").map((i) => i.name.replace(" (AI)", ""));
  const { integrationKeyStates } = await import("@/lib/integration-keys");
  const keysSaved = [...(await integrationKeyStates()).values()].flatMap((k) => k.fields).filter((f) => f.source === "app").length;
  const usd = (spend._sum.amountMicros ?? 0) / 1_000_000;
  const tiles = [
    { href: "/admin/integrations", icon: Plug, title: "Integrations", text: `${live} of ${list.length} on${offNames.length ? ` · off: ${offNames.slice(0, 3).join(", ")}${offNames.length > 3 ? "…" : ""}` : ""}${keysSaved ? ` · ${keysSaved} key${keysSaved === 1 ? "" : "s"} saved` : ""}`, show: true },
    { href: "/brain", icon: Brain, title: "Account Brain", text: "What the client sells, to whom, and how to talk about it", show: true },
    { href: "/settings", icon: SlidersHorizontal, title: "Settings", text: "Campaigns, senders, who you target, approval", show: true },
    { href: "/team", icon: Users, title: "Team & Access", text: `${users} people · ${clients} client${clients === 1 ? "" : "s"}`, show: sup },
    { href: "/team?tab=system", icon: Activity, title: "System health", text: `${paused ? "AI paused" : "AI on"} · ${queued} compan${queued === 1 ? "y" : "ies"} in the queue`, show: full },
    { href: "/team?tab=system", icon: DollarSign, title: "Usage & spend", text: `$${usd.toFixed(2)} recorded this month`, show: full },
  ].filter((t) => t.show);
  return (
    <div className="page-enter">
      <PageHeader eyebrow="Admin" title="Workspace settings" sub="Connections, the Account Brain, team and system health." />
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
