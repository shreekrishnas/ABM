import Link from "next/link";
import { CONFIG } from "@/lib/config";
import { seller } from "@/lib/seller";
import { db } from "@/lib/db";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client";
import { createCampaignFormAction, createSenderFormAction, seedDemoAction } from "../actions";
import { serviceStatus } from "@/lib/adapters";

export const metadata = { title: "Settings" };
// Seeding a hosted database can take a while.
export const maxDuration = 300;

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <span className="secondary">{k}</span>
      <span className="text-right font-semibold tnum" style={{ color: "var(--text-primary)" }}>{v}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const [users, suppressions, campaigns, senders] = await Promise.all([
    db.user.findMany({ orderBy: { name: "asc" } }),
    db.suppression.count(),
    db.campaign.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { journeys: true } } } }),
    db.senderProfile.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { journeys: true } } } }),
  ]);
  const services = serviceStatus();
  const sp = seller();
  const accounts = await db.account.count();
  const seedAllowed = process.env.ALLOW_SEED === "true";
  return (
    <div className="page-enter">
      {seedAllowed && (
        <Card title="Demo data" sub={accounts ? `${accounts} accounts in the database` : "The database is empty"} className="mb-5"
          action={<ActionButton action={seedDemoAction} className="btn btn-brand" confirm={accounts ? "This wipes ALL data and reloads the sample workspace. Continue?" : undefined}>Load sample data</ActionButton>}>
          <p className="secondary text-sm">Runs 24 sample accounts through the real pipeline (mock external services). Takes up to a minute. Remove the <code className="mono">ALLOW_SEED</code> variable in Vercel afterwards so nobody can wipe the data.</p>
        </Card>
      )}
      <PageHeader eyebrow="Configuration" title="Settings" sub={<>Every threshold lives in <code className="mono">src/lib/config.ts</code>. This page is read-only for now; editable settings with an audit history are on the roadmap.</>} />
      <div className="mb-5 grid gap-5 md:grid-cols-2">
        <Card title="ABM campaigns & segments" sub="Chosen at import; a filter on People">
          {campaigns.length === 0 ? <p className="muted text-xs">None yet.</p> : campaigns.map((c) => <Row key={c.id} k={c.name} v={`${c._count.journeys} journeys`} />)}
          <ActionForm action={createCampaignFormAction} className="mt-3 flex gap-2">
            <input name="name" className="glass-input" placeholder="e.g. Q4 Distributor Onboarding" required aria-label="Campaign name" />
            <SubmitButton className="btn btn-primary btn-sm">Add</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="LinkedIn sender profiles" sub="Each sender keeps its own journey per person">
          {senders.length === 0 ? <p className="muted text-xs">None yet.</p> : senders.map((x) => <Row key={x.id} k={x.name} v={`${x._count.journeys} journeys`} />)}
          <ActionForm action={createSenderFormAction} className="mt-3 flex gap-2">
            <input name="name" className="glass-input" placeholder="e.g. Sender 1 — Priya" required aria-label="Sender profile name" />
            <SubmitButton className="btn btn-primary btn-sm">Add</SubmitButton>
          </ActionForm>
        </Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Integrations" sub="Each service goes live once its API key is set in Vercel">
          {services.map((x) => (
            <Row key={x.key} k={<span>{x.label}<span className="muted block text-xs font-normal">{x.via}</span></span>} v={<Badge color={x.mode === "live" ? "#059669" : "#64748B"}>{x.mode}</Badge>} />
          ))}
          <p className="muted mt-3 text-xs">When web research is live the evidence gate refuses mock evidence, so test data can never reach a real send. Sample data always runs on mocks.</p>
        </Card>
        <Card title={`Seller: ${sp.name}`} sub="Ideal customer profile used for fit scoring" action={<Link href="/settings/seller" className="btn btn-secondary btn-sm">Full profile</Link>}>
          <Row k="Primary verticals" v={<span className="text-xs font-medium">{sp.icp.industries.filter((i) => i.tier === "primary").map((i) => i.label).join(" · ")}</span>} />
          <Row k="Company size" v={`${sp.icp.employees.sweetSpot.toLocaleString()}+ ideal · ${sp.icp.employees.min}+ minimum`} />
          <Row k="Markets" v={`${sp.icp.geos.primary.join(", ")} first · ${sp.icp.geos.secondary.slice(0, 6).join(", ")}…`} />
          <Row k="Weights" v={<span className="text-xs font-medium">{Object.entries(sp.icp.weights).map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()} ${v}`).join(" · ")}</span>} />
          <Row k="Fit floor" v={CONFIG.fit.floor} />
          <Row k="Targeting rule" v={sp.icp.mustHave ? `${sp.icp.mustHave.countries?.join(", ") ?? "any country"} · more than ${((sp.icp.mustHave.minEmployees ?? 1) - 1).toLocaleString()} employees` : "None"} />
          <Row k="Industries" v={sp.icp.industryMode === "any" ? "Any industry" : "Target list"} />
          <Row k="Tiers" v={sp.icp.tierBySize ? `By size: T1 ${sp.icp.tierBySize.T1.toLocaleString()}+ · T2 ${sp.icp.tierBySize.T2.toLocaleString()}+ · hot intent → T1` : `T1 ≥ ${CONFIG.fit.tiers.T1} · T2 ≥ ${CONFIG.fit.tiers.T2}`} />
          <Row k="Lost-deal cooldown" v={`${CONFIG.fit.lostDealCooldownDays} days`} />
        </Card>
        <Card title="Approval">
          <Row k="Approval (autonomy)" v={{ review_all: "A person approves every email", auto_t3: "T3 emails that pass every critic go out", auto_all: "Emails that pass every critic go out" }[sp.autonomy]} />
          <Row k="Guardrail attempts" v={CONFIG.guardrail.maxAttempts} />
        </Card>
        <Card title="Freshness & readiness">
          {Object.entries(CONFIG.freshnessDays).map(([k, v]) => <Row key={k} k={`${k} freshness`} v={`${v} days`} />)}
          <Row k="Trigger window" v={`${CONFIG.readiness.triggerWindowDays} days`} />
          <Row k="Minimum triggers" v={`${CONFIG.readiness.minVerifiedTriggers} verified or ${CONFIG.readiness.minUsableTriggers} usable`} />
        </Card>
        <Card title="Engagement & sending">
          {Object.entries(CONFIG.engagement.points).map(([k, v]) => <Row key={k} k={k.replaceAll("_", " ")} v={`+${v}`} />)}
          <Row k="Half-life" v={`${CONFIG.engagement.halfLifeDays} days`} />
          <Row k="Stages" v={`Aware ${CONFIG.engagement.stages.AWARE} · Engaged ${CONFIG.engagement.stages.ENGAGED} · MQA ${CONFIG.engagement.stages.MQA}`} />
          <Row k="Per-mailbox / global cap" v={`${CONFIG.sending.perMailboxDailyCap} / ${CONFIG.sending.globalDailyCap}`} />
          <Row k="Bounce breaker" v={`> ${CONFIG.sending.bounceBreakerPct}% after ${CONFIG.sending.bounceBreakerMinSends} sends`} />
        </Card>
        <Card title="Compliance & team">
          {Object.entries(CONFIG.lawfulBasis).map(([k, v]) => <Row key={k} k={k} v={<span className="text-xs font-medium">{v}</span>} />)}
          <Row k="Suppressions" v={suppressions} />
          <div className="micro mb-1 mt-4">Team</div>
          {users.map((u) => <Row key={u.id} k={u.name} v={<Badge color="#4F46E5">{u.role}</Badge>} />)}
        </Card>
      </div>
    </div>
  );
}
