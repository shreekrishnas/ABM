import { CONFIG } from "@/lib/config";
import { db } from "@/lib/db";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { seedDemoAction } from "../actions";

export const metadata = { title: "Settings" };
// Seeding a hosted database can take a while.
export const maxDuration = 300;

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <span className="secondary">{k}</span>
      <span className="text-right font-semibold tnum" style={{ color: "var(--text-primary)" }}>{v}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const [users, suppressions] = await Promise.all([db.user.findMany({ orderBy: { name: "asc" } }), db.suppression.count()]);
  const mode = process.env.ADAPTER_MODE ?? "mock";
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
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Integrations" sub="External systems sit behind adapters">
          <Row k="Adapter mode" v={<Badge color={mode === "mock" ? "#B45309" : "#059669"}>{mode}</Badge>} />
          {["Data provider (Apollo / Clearbit)", "Research & search (Exa / Serper)", "LLM gateway (Claude)", "Mailbox verification", "Email sending", "Intent data (Bombora / G2)", "Website visit tracking"].map((x) => <Row key={x} k={x} v={<Badge color="#64748B">mock</Badge>} />)}
          <p className="muted mt-3 text-xs">In live mode the evidence gate refuses mock evidence, so test data can never reach a real send.</p>
        </Card>
        <Card title="Ideal customer profile">
          <Row k="Industries" v={CONFIG.icp.industries.join(", ")} />
          <Row k="Employees" v={`${CONFIG.icp.employees.min}–${CONFIG.icp.employees.max}`} />
          <Row k="Countries" v={CONFIG.icp.countries.join(", ")} />
          <Row k="Weights" v={`industry ${CONFIG.icp.weights.industry} · size ${CONFIG.icp.weights.size} · region ${CONFIG.icp.weights.region}`} />
          <Row k="Fit floor" v={CONFIG.fit.floor} />
          <Row k="Tier cut-offs" v={`T1 ≥ ${CONFIG.fit.tiers.T1} · T2 ≥ ${CONFIG.fit.tiers.T2}`} />
          <Row k="Lost-deal cooldown" v={`${CONFIG.fit.lostDealCooldownDays} days`} />
        </Card>
        <Card title="Budgets & approval">
          {Object.entries(CONFIG.budgetsUsd).map(([t, v]) => <Row key={t} k={`${t} budget per account`} v={`$${v.toFixed(2)}`} />)}
          <Row k="Paid lookup" v={`$${CONFIG.costsUsd.paidLookup.toFixed(2)}`} />
          <Row k="LLM cheap / strong" v={`$${CONFIG.costsUsd.llmCheap} / $${CONFIG.costsUsd.llmStrong}`} />
          <Row k="Human approval for T3" v={CONFIG.approval.requireHumanForT3 ? "Required" : "Auto when checks pass"} />
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
