import Link from "next/link";
import { db } from "@/lib/db";
import { getMe } from "@/lib/me";
import { unscoped, withScope } from "@/lib/scope";
import { REGISTRY } from "@/lib/agent/registry";
import { SYSTEM_ACTOR, type AgentContext } from "@/lib/agent/types";
import { ago } from "@/components/ui";
import { humanize } from "@/lib/labels";
import { VegaChat } from "./chat";
import { AutonomyCard, UndoButton } from "./autonomy";
import { RecommendedApprovals } from "./approvals";
import { loadVegaConversation } from "./actions";

export const metadata = { title: "Vega" };
export const maxDuration = 120;

type Overview = { found: boolean; account?: { id: string; name: string; domain: string | null; tier: string | null; stage: string; fitScore: number | null; intentScore: number; priorityScore: number | null }; facts?: { id: string; topic: string; claim: string; label: string; url: string }[]; missingRoles?: string[]; buyingGroup?: { role: string; status: string; people: string[] }[] };

export default async function VegaPage({ searchParams }: { searchParams: Promise<{ c?: string; a?: string; conv?: string }> }) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me?.superAdmin) {
    return (
      <div className="page-enter jv-gate">
        <h1 className="page-title">Vega</h1>
        <p className="secondary">Vega is open to Super Admins for now. Switch to Super Admin mode from your account menu to use it.</p>
      </div>
    );
  }
  const clients = await db.client.findMany({ where: me.superAdminClients === null ? {} : { id: { in: me.superAdminClients } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  // Opened on a company (Ctrl/Cmd+J) without a client: use that company's client.
  const fromAccount = !sp.c && sp.a ? (await unscoped(() => db.account.findUnique({ where: { id: sp.a! }, select: { sellerId: true } })))?.sellerId : null;
  // Default to the client you're working in (the switcher), not the first client alphabetically.
  const { activeSellerId } = await import("@/lib/scope");
  const current = await activeSellerId().catch(() => null);
  const client = clients.find((c) => c.id === (sp.c ?? fromAccount ?? current)) ?? clients[0];
  if (!client) return <div className="page-enter"><h1 className="page-title">Vega</h1><p className="secondary">No client to work with yet.</p></div>;

  const scope = { ids: [client.id], active: client.id, choices: [], all: false };
  const DAY = 86_400_000;
  const since = new Date(Date.now() - DAY);
  const ctx: AgentContext = { sellerId: client.id, actor: SYSTEM_ACTOR, origin: "chat", maxLevel: 0 };
  const [steps, approvals, failedJobs, spend, convos, companies, overview, feed] = await withScope(scope, () =>
    Promise.all([
      db.pipelineEvent.count({ where: { createdAt: { gte: since }, account: { sellerId: client.id } } }),
      db.reviewItem.count({ where: { status: "open" } }),
      db.backgroundJob.count({ where: { sellerId: client.id, status: "failed", createdAt: { gte: since } } }),
      import("@/lib/budget").then(({ monthSpendUsd }) => monthSpendUsd(client.id)).catch(() => 0),
      db.assistantConversation.findMany({ where: { userEmail: me.email, sellerId: client.id }, orderBy: { updatedAt: "desc" }, take: 12, select: { id: true, title: true, updatedAt: true } }),
      db.account.findMany({ where: { mergedIntoId: null }, orderBy: [{ priorityScore: { sort: "desc", nulls: "last" } }], take: 12, select: { id: true, name: true } }),
      sp.a ? (REGISTRY.account_overview.run({ accountId: sp.a }, ctx) as Promise<Overview>) : Promise.resolve(null),
      db.pipelineEvent.findMany({ where: { account: { sellerId: client.id } }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, step: true, outcome: true, createdAt: true, account: { select: { id: true, name: true } } } }),
    ]),
  );
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [setting, acted, spentToday] = await Promise.all([
    db.agentSetting.findUnique({ where: { sellerId: client.id } }),
    db.agentAction.findMany({ where: { sellerId: client.id, level: { gt: 0 } }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, tool: true, level: true, status: true, reason: true, reversible: true, undo: true, error: true, costUsd: true, createdAt: true, accountId: true } }),
    db.agentAction.aggregate({ where: { sellerId: client.id, level: { gt: 0 }, createdAt: { gte: dayStart } }, _sum: { costUsd: true } }),
  ]);
  const { recommendedApprovals, agreement } = await import("@/lib/agent/approvals");
  const [recs, agreed] = await Promise.all([withScope(scope, () => recommendedApprovals(15)).catch(() => []), agreement(client.id).catch(() => ({ decisions: 0, agreedShare: null }))]);
  const budget = (await db.client.findUnique({ where: { id: client.id }, select: { monthlyBudgetUsd: true } }))?.monthlyBudgetUsd ?? null;
  const history = sp.conv ? await loadVegaConversation(client.id, sp.conv) : null;
  const href = (q: Record<string, string | undefined>) => `/vega?${new URLSearchParams(Object.entries({ c: client.id, ...q }).filter(([, v]) => v) as [string, string][])}`;
  const acc = overview?.found ? overview.account! : null;

  return (
    <div className="page-enter jv">
      <header className="jv-head">
        <div>
          <div className="page-eyebrow">Assistant · answers questions, does safe internal work when switched on</div>
          <h1 className="page-title">Vega</h1>
        </div>
        <form className="jv-client" action="/vega">
          <label htmlFor="jv-c" className="muted text-xs">Client</label>
          <select id="jv-c" name="c" defaultValue={client.id} className="glass-select">{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button className="btn btn-secondary btn-sm" type="submit">Switch</button>
        </form>
      </header>

      <section className="jv-brief" aria-label="Briefing">
        <Link prefetch={false} href="/pipeline" className="jv-stat"><b className="tnum">{steps}</b><span>pipeline steps in the last 24 hours</span></Link>
        <Link prefetch={false} href="/review" className="jv-stat"><b className="tnum">{approvals}</b><span>waiting for a person</span></Link>
        <span className="jv-stat"><b className="tnum">{failedJobs}</b><span>background jobs failed today</span></span>
        <span className="jv-stat"><b className="tnum">${spend.toFixed(2)}</b><span>{budget ? `of $${budget} spent this month` : "spent this month (no cap)"}</span></span>
      </section>

      <div className="jv-grid">
        <aside className="jv-side" aria-label="Conversations and activity">
          <div className="jv-card">
            <div className="jv-card-h"><h2>Conversations</h2><Link prefetch={false} href={href({ a: sp.a })} className="ws-link">New</Link></div>
            {convos.length === 0 ? <p className="muted text-xs">None yet. Ask something to start.</p> : (
              <ul className="jv-list">{convos.map((c) => <li key={c.id}><Link prefetch={false} href={href({ conv: c.id, a: sp.a })} className={sp.conv === c.id ? "on" : undefined}>{c.title}<small>{ago(c.updatedAt)}</small></Link></li>)}</ul>
            )}
          </div>
          <AutonomyCard clientId={client.id} setting={{ enabled: setting?.enabled ?? false, paused: setting?.paused ?? false, allowedTools: Array.isArray(setting?.allowedTools) ? (setting.allowedTools as string[]) : [], dailyCapUsd: setting?.dailyCapUsd ?? 3, spentTodayUsd: spentToday._sum.costUsd ?? 0 }} />
          <div className="jv-card">
            <div className="jv-card-h"><h2>What Vega did</h2></div>
            {acted.length === 0 ? <p className="muted text-xs">Nothing yet. Switch it on above, or press Run now.</p> : (
              <ul className="jv-feed">{acted.map((x) => (
                <li key={x.id} className={x.status === "failed" ? "bad" : x.status === "undone" ? "undone" : undefined}>
                  <span><b>{humanize(x.tool.replace("undo:", "undo "))}</b>{x.level === 2 && <span className="jv-lv">reacted · told you</span>}{x.accountId && <> · <Link prefetch={false} href={href({ a: x.accountId, conv: sp.conv })}>open</Link></>}</span>
                  <span>{x.reason}</span>
                  <small>{x.status === "done" ? "Done" : humanize(x.status)}{x.costUsd ? ` · $${x.costUsd.toFixed(2)}` : ""} · {ago(x.createdAt)}{x.error ? ` · ${x.error}` : ""}</small>
                  {x.status === "done" && x.reversible && x.undo != null && <UndoButton clientId={client.id} actionId={x.id} />}
                  {x.status === "done" && !x.reversible && <small className="muted">Cannot be undone</small>}
                </li>
              ))}</ul>
            )}
          </div>
          <div className="jv-card">
            <div className="jv-card-h"><h2>Pipeline activity</h2></div>
            <ul className="jv-feed">{feed.map((e) => (
              <li key={e.id} className={e.outcome === "block" || e.outcome === "error" ? "bad" : undefined}>
                <span>{humanize(e.step.replaceAll(".", " · "))}{e.account && <> · <Link prefetch={false} href={href({ a: e.account.id, conv: sp.conv })}>{e.account.name}</Link></>}</span>
                <small>{humanize(e.outcome)} · {ago(e.createdAt)}</small>
              </li>
            ))}</ul>
          </div>
        </aside>

        <main className="jv-main">
          <VegaChat key={`${client.id}:${sp.conv ?? "new"}:${sp.a ?? ""}`} clientId={client.id} clientName={client.name} accountId={acc?.id ?? null} accountName={acc?.name ?? null} conversationId={sp.conv ?? null} initial={history ?? []} />
        </main>

        <aside className="jv-ctx" aria-label="Company in focus">
          <RecommendedApprovals clientId={client.id} items={recs.map((r) => ({ draftId: r.draftId, reviewId: r.reviewId, person: r.person, company: r.company, subject: r.subject, strength: r.strength, recommendation: r.recommendation, reasons: r.reasons, waitingDays: r.waitingDays }))} agreement={agreed} />
          <div className="jv-card">
            <div className="jv-card-h"><h2>Company in focus</h2>{acc && <Link prefetch={false} href={href({ conv: sp.conv })} className="ws-link">Clear</Link>}</div>
            {!acc ? (
              <>
                <p className="muted text-xs">Pick a company to ask about it. Top priority first:</p>
                <ul className="jv-list">{companies.map((c) => <li key={c.id}><Link prefetch={false} href={href({ a: c.id, conv: sp.conv })}>{c.name}</Link></li>)}</ul>
              </>
            ) : (
              <div className="jv-acc">
                <Link href={`/accounts/${acc.id}`} className="jv-acc-name">{acc.name}</Link>
                <div className="muted text-xs">{acc.domain ?? "no website"} · {humanize(acc.stage)}{acc.tier ? ` · ${acc.tier}` : ""}</div>
                <div className="jv-scores">
                  <span><b className="tnum">{acc.priorityScore ?? "—"}</b>Priority</span>
                  <span><b className="tnum">{acc.fitScore ?? "—"}</b>Fit</span>
                  <span><b className="tnum">{Math.round(acc.intentScore)}</b>Intent</span>
                </div>
                {overview?.missingRoles && overview.missingRoles.length > 0 && <p className="jv-gap">Missing roles: {overview.missingRoles.join(", ")}</p>}
                <h3>Facts</h3>
                <ul className="jv-facts">{(overview?.facts ?? []).slice(0, 8).map((f) => <li key={f.id}><span className={`jv-lbl ${f.label}`}>{f.label}</span><a href={f.url} target="_blank" rel="noreferrer">{f.claim}</a></li>)}</ul>
                {(overview?.facts ?? []).length === 0 && <p className="muted text-xs">No research facts yet.</p>}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
