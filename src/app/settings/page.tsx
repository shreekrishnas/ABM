import { linkSignIn } from "@/lib/auth";
import { allowedDomains } from "@/lib/auth";
import Link from "next/link";
import { CONFIG } from "@/lib/config";
import { ensureSellerPacks } from "@/lib/seller";
import { activeSeller } from "@/lib/scope";
import { db } from "@/lib/db";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client";
import { createCampaignFormAction, createSenderFormAction, seedDemoAction } from "../actions";
import { securityStatus } from "@/lib/api";
import { headers } from "next/headers";
import { DEFAULT_PRIORITY_WEIGHTS } from "@/lib/brain/priority";

export const metadata = { title: "Settings" };
// Seeding a hosted database can take a while.
export const maxDuration = 300;

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="st-row">
      <span className="st-k">{k}</span>
      <span className="st-v tnum">{v}</span>
    </div>
  );
}

export default async function SettingsPage() {
  await ensureSellerPacks();
  const [users, suppressions, campaigns, senders] = await Promise.all([
    db.user.findMany({ orderBy: { name: "asc" } }),
    db.suppression.count(),
    db.campaign.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { journeys: true } } } }),
    db.senderProfile.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { journeys: true } } } }),
  ]);
  const conns = await (await import("@/lib/admin/integrations")).integrations();
  const sec = securityStatus();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "your-app.vercel.app"}`;
  const trackOrigins = Boolean(process.env.TRACK_ORIGINS?.trim());
  const apolloKey = (await (await import("@/lib/admin/needs")).needs(["apollo"])).ok;
  const ok = "var(--success)", warn = "var(--warning)", bad = "var(--danger)", muted = "var(--muted)";
    const visits30 = await db.webVisit.count({ where: { occurredAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } });
  const sp = await activeSeller();
  const accounts = await db.account.count();
  const seedAllowed = process.env.ABM_TEST_COPY === "true" || (process.env.ALLOW_SEED === "true" && process.env.NODE_ENV !== "production");
  return (
    <div className="page-enter">
      <PageHeader eyebrow="Configuration" title="Settings" sub="Campaigns, senders, who you target and how emails are approved. Edits to the Account Brain keep a version history." />
      <div className="st-layout">
      <nav className="st-index" aria-label="Settings sections">
        {[["campaigns", "Campaigns"], ["senders", "Senders"], ["access", "Connections & access"], ["seller", "Seller"], ["visitors", "Visitors"], ["approval", "Approval"], ["freshness", "Freshness"], ["scoring", "Scoring & sending"], ["compliance", "Compliance & team"], ...(seedAllowed ? [["developer", "Developer"]] : [])].map(([id, l]) => <a key={id} href={`#${id}`}>{l}</a>)}
      </nav>
      <div className="st-main">
        <Card id="campaigns" title="ABM campaigns & segments" sub="Chosen at import; a filter on People">
          {campaigns.length === 0 ? <p className="muted text-xs">None yet.</p> : campaigns.map((c) => <Row key={c.id} k={c.name} v={`${c._count.journeys} journeys`} />)}
          <ActionForm action={createCampaignFormAction} className="mt-3 flex gap-2">
            <input name="name" className="glass-input" placeholder="e.g. Q4 Distributor Onboarding" required aria-label="Campaign name" />
            <SubmitButton className="btn btn-primary btn-sm">Add</SubmitButton>
          </ActionForm>
        </Card>
        <Card id="senders" title="LinkedIn sender profiles" sub="Each sender keeps its own journey per person">
          {senders.length === 0 ? <p className="muted text-xs">None yet.</p> : senders.map((x) => <Row key={x.id} k={x.name} v={`${x._count.journeys} journeys`} />)}
          <ActionForm action={createSenderFormAction} className="mt-3 flex gap-2">
            <input name="name" className="glass-input" placeholder="e.g. Sender 1 — Priya" required aria-label="Sender profile name" />
            <SubmitButton className="btn btn-primary btn-sm">Add</SubmitButton>
          </ActionForm>
        </Card>

        <Card id="access" title="Connections & access" sub="What is switched on. Keys and switches for each service are in Admin → Integrations." action={<Link href="/admin/integrations" className="btn btn-secondary btn-sm">Integrations</Link>}>
          <Row k={<span>Services on<span className="muted block text-xs font-normal">{conns.filter((i) => i.state !== "connected" && i.state !== "planned").map((i) => i.name).join(", ") || "Everything needed is on"}{conns.some((i) => i.state !== "connected" && i.state !== "planned") ? ": off" : ""}</span></span>} v={<Badge color={ok}>{conns.filter((i) => i.state === "connected").length} of {conns.filter((i) => i.state !== "planned").length}</Badge>} />
          <Row k={<span>Sign-in<span className="muted block text-xs font-normal">Work emails ending {allowedDomains().map((d) => `@${d}`).join(", ")}</span></span>} v={<Badge color={sec.signIn ? ok : bad}>{!sec.signIn ? "not set up" : linkSignIn() ? "emailed one-time link" : "email only"}</Badge>} />
          <Row k={<span>API access<span className="muted block text-xs font-normal">For webhooks and other tools that send data in</span></span>} v={<Badge color={sec.apiKey ? ok : sec.production && !sec.apiOpen ? bad : warn}>{sec.apiKey ? "protected" : sec.apiOpen ? "open (test only)" : "not set up"}</Badge>} />
          <Row k={<span>Daily schedule<span className="muted block text-xs font-normal">Weekdays 7:30 AM IST: research the queue and refresh signals</span></span>} v={<Badge color={sec.cronSecret ? ok : warn}>{sec.cronSecret ? "on" : "not set up"}</Badge>} />
          <Row k={<span>Spending limit per company<span className="muted block text-xs font-normal">Top ${CONFIG.budgetsUsd.T1} · Mid ${CONFIG.budgetsUsd.T2} · Broad ${CONFIG.budgetsUsd.T3}</span></span>} v={<Badge color={sec.budgetsEnforced ? ok : muted}>{sec.budgetsEnforced ? "on" : "off"}</Badge>} />
          {sec.seedAllowed && <Row k={<span>Sample data reset<span className="muted block text-xs font-normal">Can wipe all data; test copy only</span></span>} v={<Badge color={bad}>allowed</Badge>} />}
          <p className="muted mt-3 text-xs">{sec.budgetsEnforced ? "A company's research stops for review when it reaches its limit." : "Every paid call is still recorded per company; nothing is capped per company. Monthly caps per client are set in Super Admin."} Sample data always runs on stand-in services, so it never reaches a real email.</p>
        </Card>
        <Card id="seller" title={`Seller: ${sp.name}`} sub="Ideal customer profile used for fit scoring" action={<span className="flex gap-2"><Link href="/settings/seller" className="btn btn-secondary btn-sm">Full profile</Link><Link href="/settings/seller/edit" className="btn btn-primary btn-sm">Edit</Link><Link href="/settings/knowledge" className="btn btn-secondary btn-sm">Knowledge base</Link></span>}>
          <Row k="Primary verticals" v={<span className="text-xs font-medium">{sp.icp.industries.filter((i) => i.tier === "primary").map((i) => i.label).join(" · ")}</span>} />
          <Row k="Company size" v={`${sp.icp.employees.sweetSpot.toLocaleString()}+ ideal · ${sp.icp.employees.min}+ minimum`} />
          <Row k="Markets" v={`${sp.icp.geos.primary.join(", ")} first · ${sp.icp.geos.secondary.slice(0, 6).join(", ")}…`} />
          <Row k="Weights" v={<span className="text-xs font-medium">{Object.entries(sp.icp.weights).map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()} ${v}`).join(" · ")}</span>} />
          <Row k="Priority weights" v={<span className="text-xs font-medium">{(() => { const w = sp.icp.priorityWeights ?? DEFAULT_PRIORITY_WEIGHTS; return `intent ${w.intent} · fit ${w.fit} · value ${w.value} · timing ${w.timing}`; })()}</span>} />
          <Row k="Fit floor" v={CONFIG.fit.floor} />
          <Row k="Who you target" v={sp.icp.mustHave ? `${sp.icp.mustHave.countries?.join(", ") ?? "any country"} · more than ${((sp.icp.mustHave.minEmployees ?? 1) - 1).toLocaleString()} employees` : "None"} />
          <Row k="Industries" v={sp.icp.industryMode === "any" ? "Any industry" : "Target list"} />
          <Row k="Priority" v={sp.icp.tierBySize ? `By size: Top ${sp.icp.tierBySize.T1.toLocaleString()}+ employees · Mid ${sp.icp.tierBySize.T2.toLocaleString()}+ · hot intent → Top` : `Top: fit ${CONFIG.fit.tiers.T1}+ · Mid: fit ${CONFIG.fit.tiers.T2}+`} />
          <Row k="Lost-deal cooldown" v={`${CONFIG.fit.lostDealCooldownDays} days`} />
        </Card>
        <Card id="visitors" title="Website visitors" sub="Visits feed intent, priority and the email angle">
          <Row k={<span>Apollo<span className="muted block text-xs font-normal">Switched on in Admin → Integrations</span></span>} v={<Badge color={apolloKey ? ok : muted}>{apolloKey ? "syncing daily" : "off"}</Badge>} />
          <Row k="Visits recorded (30 days)" v={<span className="tnum">{visits30}</span>} />
          <p className="secondary mt-3 text-xs"><b>With Apollo (recommended):</b> in Apollo, save the companies from Website Visitors to an account list (by hand, or with an Apollo workflow). Give it a name with "visitor" in it (it is found automatically), or type its name as the visitor list in Admin → Integrations → Apollo. The app reads it every day: companies you hold get a visit signal; new ones show in Discover.</p>
          <p className="muted mt-3 text-xs font-semibold">Optional: the app&apos;s own script (shows which pages, and who clicked from an email)</p>
          <Row k={<span>Allowed website<span className="muted block text-xs font-normal">Your website address, set by an admin</span></span>} v={<Badge color={trackOrigins ? "#059669" : "#64748B"}>{trackOrigins ? "set" : "not set"}</Badge>} />
          <p className="secondary mt-2 text-xs">1. Paste this before <code>&lt;/body&gt;</code> on every page of your website:</p>
          <pre className="mono mt-1 overflow-x-auto rounded-lg p-2 text-[0.7rem]" style={{ background: "var(--surface-card-header)" }}>{`<script src="${origin}/api/v1/track/script" async></script>`}</pre>
          <p className="secondary mt-2 text-xs">2. Ask an admin to add your website address as the allowed website. Links to it in emails then carry a token, so a click identifies the person.</p>
          <p className="secondary mt-2 text-xs">Other visitor tools can post to <code className="break-all">{origin}/api/v1/visitors</code> using the API key (ask an admin).</p>
        </Card>
        <Card id="approval" title="Approval">
          <Row k="Approval (autonomy)" v={{ review_all: "A person approves every email", auto_t3: "Broad-priority emails that pass every check go out", auto_all: "Emails that pass every check go out" }[sp.autonomy]} />
          <Row k="Guardrail attempts" v={CONFIG.guardrail.maxAttempts} />
        </Card>
        <Card id="freshness" title="Freshness & readiness">
          {Object.entries(CONFIG.freshnessDays).map(([k, v]) => <Row key={k} k={`${k} freshness`} v={`${v} days`} />)}
          <Row k="Trigger window" v={`${CONFIG.readiness.triggerWindowDays} days`} />
          <Row k="Minimum triggers" v={`${CONFIG.readiness.minVerifiedTriggers} verified or ${CONFIG.readiness.minUsableTriggers} usable`} />
        </Card>
        <Card id="scoring" title="Engagement & sending">
          {Object.entries(CONFIG.engagement.points).map(([k, v]) => <Row key={k} k={k.replaceAll("_", " ")} v={`+${v}`} />)}
          <Row k="Half-life" v={`${CONFIG.engagement.halfLifeDays} days`} />
          <Row k="Stages" v={`Aware ${CONFIG.engagement.stages.AWARE} · Engaged ${CONFIG.engagement.stages.ENGAGED} · MQA ${CONFIG.engagement.stages.MQA}`} />
          <Row k="Per-mailbox / global cap" v={`${CONFIG.sending.perMailboxDailyCap} / ${CONFIG.sending.globalDailyCap}`} />
          <Row k="Bounce breaker" v={`> ${CONFIG.sending.bounceBreakerPct}% after ${CONFIG.sending.bounceBreakerMinSends} sends`} />
        </Card>
        <Card id="compliance" title="Compliance & team">
          {Object.entries(CONFIG.lawfulBasis).map(([k, v]) => <Row key={k} k={k} v={<span className="text-xs font-medium">{v}</span>} />)}
          <Row k="Suppressions" v={suppressions} />
          <div className="micro mb-1 mt-4">Team</div>
          {users.map((u) => <Row key={u.id} k={u.name} v={<Badge color="var(--pill)">{u.role}</Badge>} />)}
        </Card>
        {seedAllowed && (
        <Card id="developer" title="Demo data" sub={accounts ? `${accounts} accounts in the database` : "The database is empty"}
          action={<ActionButton action={seedDemoAction} className="btn btn-brand" confirm={accounts ? "This wipes ALL data and reloads the sample workspace. Continue?" : undefined}>Load sample data</ActionButton>}>
          <p className="secondary text-sm">Loads 50 sample companies through the real pipeline using stand-in services. Takes up to a minute. Only available on the test copy.</p>
        </Card>
      )}
      </div>
      </div>
    </div>
  );
}
