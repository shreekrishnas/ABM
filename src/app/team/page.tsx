import { notFound } from "next/navigation";
import Link from "next/link";
import { Lock, LayoutDashboard, Activity, Building2, Download, History, RotateCcw, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { coversClient, getMe, superAdminClientsOf, type Me } from "@/lib/me";
import { allowedDomains } from "@/lib/auth";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client";
import { Card, PageHeader, ago } from "@/components/ui";
import { AccountLogo } from "@/components/account-logo";
import { SERVICE_MODE_LABEL } from "@/lib/adapters";
import { spendByAccount, systemHealth } from "@/lib/admin/health";
import { clientOverview, type ClientRow } from "@/lib/admin/overview";
import { GroupedBars, KpiRow, KpiTile } from "@/components/viz/cards";
import { switchClientAction } from "@/app/login/actions";
import { aiPause } from "@/lib/admin/ai-pause";
import { ACTION_WORD, isSensitive } from "@/lib/admin/audit";
import { auditWhere } from "@/lib/admin/audit-where";
import { clearEmailConflictsAction, clearErrorsAction, setMonthlyBudgetAction } from "./actions";
import { monthlyStatus } from "@/lib/budget";
import { addClientAction, addUserAction, clearAccountDataAction, clearWorkspaceDataAction, restartQueueAction, setAiPausedAction, setAssignmentAction, setClientLogoAction, removeSampleAction, resolveErrorAction, signOutAllAction, retryStoppedAction, sendTestEmailAction, setRoleAction, setShowExtrasAction, setUserStatusAction, signOutEverywhereAction, setSuperAdminAction } from "./actions";
import { serviceStatus } from "@/lib/adapters";
import { sampleState } from "@/lib/sample";
import { setupSteps } from "@/lib/admin/client-setup";
import { CLIENT_STATUS_LABEL, isClientStatus } from "@/lib/admin/client-status";
import { runHistory, stoppedGroups } from "@/lib/admin/ops";
import { SampleLoader } from "./sample-loader";
import { ROLES, ROLE_LABEL, ROLE_HELP } from "@/lib/roles";
import { reResearchAllAction } from "@/app/actions";

export const metadata = { title: "Team & Access" };

// Loading the Test client runs the research steps a few companies at a time.
export const maxDuration = 60;

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "people", label: "People", icon: ShieldCheck },
  { key: "accounts", label: "Accounts", icon: Building2 },
  { key: "system", label: "System health", icon: Activity },
  { key: "data", label: "Data", icon: Trash2 },
  { key: "security", label: "Security", icon: Lock },
  { key: "audit", label: "Audit log", icon: History },
] as const;
type Tab = (typeof TABS)[number]["key"];
/** What a Super Admin over only some clients sees: their people and their clients. */
const SCOPED_TABS: Tab[] = ["people", "accounts"];

const usd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(n >= 100 ? 0 : 2)}`);

/** Super Admin only: people, accounts, system health, data and the audit log, one tab each. */
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ tab?: string; who?: string; what?: string; account?: string; from?: string; to?: string; sensitive?: string; result?: string }> }) {
  const me = await getMe();
  if (!me?.superAdmin) notFound();
  const sp = await searchParams;
  const full = me.fullSuperAdmin;
  const tabs = full ? TABS : TABS.filter((t) => SCOPED_TABS.includes(t.key));
  const tab: Tab = tabs.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : tabs[0].key;
  const clients = await db.client.findMany({ where: full ? {} : { id: { in: me.superAdminClients ?? [] } }, orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } });
  const [health, month] = full ? await Promise.all([systemHealth(), monthlyStatus()]) : [null, null];
  const problems = health && month ? (health.tables?.length ? 1 : 0) + (health.queue.stuck ? 1 : 0) + [...month.values()].filter((m) => m.state !== "ok").length + (health.errors.length ? 1 : 0) : 0;

  return (
    <div className="page-enter space-y-5">
      <PageHeader eyebrow="Super Admin" title="Super Admin" sub={full ? "Every client at a glance, who can sign in and to what, how the system is doing, and every Super Admin action." : `Super Admin for ${clients.map((c) => c.name).join(", ") || "no client yet"}: who works on them, their roles and their settings.`} />
      <nav className="k-seg tm-tabs" aria-label="Team & Access sections">
        {tabs.map((t) => (
          <Link key={t.key} href={`/team?tab=${t.key}`} className={tab === t.key ? "on" : undefined} aria-current={tab === t.key ? "page" : undefined}>
            <t.icon size={15} aria-hidden /> {t.label}
            {t.key === "system" && problems > 0 && <span className="tm-alert" aria-label={`${problems} problem${problems === 1 ? "" : "s"}`}>{problems}</span>}
          </Link>
        ))}
      </nav>
      {tab === "overview" && health && <OverviewTab health={health} />}
      {tab === "people" && <PeopleTab me={me} clients={clients} />}
      {tab === "accounts" && <AccountsTab clients={clients} canAdd={full} />}
      {tab === "system" && health && <SystemTab health={health} clients={clients} />}
      {tab === "data" && <DataTab clients={clients} />}
      {tab === "audit" && <AuditTab clients={clients} who={sp.who} what={sp.what} account={sp.account} from={sp.from} to={sp.to} sensitive={sp.sensitive} />}
      {tab === "security" && <SecurityTab me={me.email} result={sp.result} />}
    </div>
  );
}

type Clients = Awaited<ReturnType<typeof db.client.findMany<{ include: { _count: { select: { users: true } } } }>>>;

/** A Super Admin over some clients can act on a person only when everything that person reaches is theirs. */
function inReach(me: Me, u: { superAdmin: boolean; superAdminClients: string[]; clients: { clientId: string }[] }): boolean {
  if (me.fullSuperAdmin) return true;
  const theirs = superAdminClientsOf(u);
  return theirs !== null && theirs.every((c) => coversClient(me, c)) && u.clients.every((c) => coversClient(me, c.clientId));
}

async function PeopleTab({ me: actor, clients }: { me: Me; clients: Clients }) {
  const me = actor.email;
  const names = new Map((await db.client.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const users = await db.user.findMany({ where: { OR: allowedDomains().map((d) => ({ email: { endsWith: `@${d}` } })) }, orderBy: [{ status: "asc" }, { name: "asc" }], include: { clients: true } });
  return (
    <>
      <Card title="People" sub={`${users.filter((u) => u.status === "active").length} active. Click an account to assign or unassign. Super Admin access can cover every client or only the ones you pick.`} pad={false}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Access</th><th>Clients and role</th><th>Last sign-in</th><th className="text-right">Sign-in</th></tr></thead>
            <tbody>
              {users.map((u) => {
                const assigned = new Set(u.clients.map((c) => c.clientId));
                const roleOf = new Map(u.clients.map((c) => [c.clientId, c.role]));
                const removed = u.status !== "active";
                const reach = inReach(actor, u);
                const covers = superAdminClientsOf(u);
                return (
                  <tr key={u.id} style={removed ? { opacity: 0.55 } : undefined}>
                    <td className="strong">{u.name}<div className="muted mono text-xs font-normal">{u.email}</div></td>
                    <td>
                      {u.superAdmin ? <span className="tm-role super">Super Admin</span> : <span className="tm-role">User</span>}
                      {u.superAdmin && <div className="muted mt-1 text-xs">{covers === null ? "All clients" : covers.map((c) => names.get(c) ?? c).join(", ")}</div>}
                      {u.email !== me && !removed && (reach || !u.superAdmin) && <SuperAdminControl user={u} covers={covers} clients={clients} full={actor.fullSuperAdmin} reach={reach} />}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {clients.map((c) => assigned.has(c.id) ? (
                          <span key={c.id} className="tm-chip on tm-rolechip">
                            <ActionButton action={setAssignmentAction.bind(null, u.id, c.id, false)} className="tm-x" confirm={`Remove ${u.name} from ${c.name}?`} title="Unassign">{c.name}</ActionButton>
                            {!u.superAdmin && (
                              <ActionForm action={setRoleAction} className="tm-roleform">
                                <input type="hidden" name="userId" value={u.id} /><input type="hidden" name="clientId" value={c.id} />
                                <select name="role" defaultValue={roleOf.get(c.id) ?? "manager"} aria-label={`${u.name}'s role in ${c.name}`} title={ROLES.map((r) => `${ROLE_LABEL[r]}: ${ROLE_HELP[r]}`).join("\n")}>
                                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                                </select>
                                <SubmitButton className="tm-set">Set</SubmitButton>
                              </ActionForm>
                            )}
                          </span>
                        ) : (
                          <ActionButton key={c.id} action={setAssignmentAction.bind(null, u.id, c.id, true)} className="tm-chip" title="Click to assign" disabled={removed}>+ {c.name}</ActionButton>
                        ))}
                        {assigned.size === 0 && <span className="muted text-xs">No account yet</span>}
                      </div>
                    </td>
                    <td className="muted text-xs">{u.lastSignInAt ? ago(u.lastSignInAt) : "Never"}{!removed && u.email !== me && u.lastSignInAt && reach && <div><ActionButton action={signOutEverywhereAction.bind(null, u.id)} className="tm-link" confirm={`Sign ${u.name} out on every device?`}>Sign out everywhere</ActionButton></div>}</td>
                    <td className="text-right">
                      {u.email === me ? <span className="muted text-xs">You</span> : !reach ? null : removed
                        ? <ActionButton action={setUserStatusAction.bind(null, u.id, "active")} className="btn btn-secondary btn-sm">Restore</ActionButton>
                        : <ActionButton action={setUserStatusAction.bind(null, u.id, "removed")} className="btn btn-secondary btn-sm" confirm={`Remove ${u.name}? They won't be able to sign in. Their history is kept.`}>Remove</ActionButton>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={<span className="inline-flex items-center gap-2"><UserPlus size={18} /> Add a person</span>} sub="They sign in with this email. Assign their clients and role in the table above; new assignments start as Rep.">
        <ActionForm action={addUserAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input name="name" className="glass-input" placeholder="Full name" aria-label="Full name" required />
          <input name="email" type="email" className="glass-input" placeholder={`name@${allowedDomains()[0] ?? "company.com"}`} aria-label="Email" required />
          <SubmitButton className="btn btn-primary">Add</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}

/**
 * Make someone Super Admin for every client or only some, or take it away. The client list is the
 * giver's own clients; "Every client" only for a Super Admin over all clients.
 */
function SuperAdminControl({ user, covers, clients, full, reach }: { user: { id: string; name: string; superAdmin: boolean }; covers: string[] | null; clients: Clients; full: boolean; reach: boolean }) {
  const current = !user.superAdmin ? "none" : covers === null ? "all" : "some";
  const picked = new Set(covers ?? []);
  return (
    <details className="tm-sa">
      <summary className="tm-link">{user.superAdmin ? "Change Super Admin" : "Make Super Admin"}</summary>
      <ActionForm action={setSuperAdminAction} className="tm-sa-form" resetOnSuccess={false}>
        <input type="hidden" name="userId" value={user.id} />
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-xs font-semibold">{user.name}&apos;s Super Admin access</legend>
          {full && <label className="tm-sa-opt"><input type="radio" name="access" value="all" defaultChecked={current === "all"} /> Every client</label>}
          <label className="tm-sa-opt"><input type="radio" name="access" value="some" defaultChecked={current === "some" || (!full && current === "none")} /> Only these clients:</label>
          <div className="flex flex-wrap gap-1.5 pl-5">
            {clients.map((c) => <label key={c.id} className="tm-pick"><input type="checkbox" name="clients" value={c.id} defaultChecked={picked.has(c.id)} /> {c.name}</label>)}
            {!clients.length && <span className="muted text-xs">No client to give</span>}
          </div>
          {user.superAdmin && reach && <label className="tm-sa-opt"><input type="radio" name="access" value="none" /> Not a Super Admin</label>}
        </fieldset>
        <p className="muted text-xs">In Super Admin mode they can open these clients, manage who works on them and change their settings.{full ? " Only Super Admins over every client see the system, security and workspace settings." : ""}</p>
        <SubmitButton className="btn btn-primary btn-sm justify-self-start">Save access</SubmitButton>
      </ActionForm>
    </details>
  );
}

async function AccountsTab({ clients, canAdd }: { clients: Clients; canAdd: boolean }) {
  const users = await db.user.findMany({ where: { status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const [month, setup, byClient] = await Promise.all([
    monthlyStatus(),
    Promise.all(clients.map((c) => setupSteps(c.id))),
    db.account.groupBy({ by: ["sellerId"], where: { mergedIntoId: null }, _count: true }),
  ]);
  const counts = new Map(byClient.map((r) => [r.sellerId, r._count]));
  return (
    <>
      <Card title="Clients" sub="Each client is its own workspace with its own brain, team and spending cap. Open Settings to set it up, pause or archive it, or export its data." pad={false}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Client</th><th>Status</th><th>Setup</th><th className="r">Companies</th><th className="r">People</th><th>Spend this month</th><th /></tr></thead>
            <tbody>{clients.map((c, i) => {
              const m = month.get(c.id);
              const st = setup[i];
              const ready = st.filter((x) => x.done).length;
              return (
                <tr key={c.id}>
                  <td><span className="inline-flex items-center gap-2"><AccountLogo name={c.name} url={c.logoUrl} className="tm-logo" /><b>{c.name}</b></span></td>
                  <td><span className={`cs-status ${c.status}`}>{CLIENT_STATUS_LABEL[isClientStatus(c.status) ? c.status : "active"]}</span></td>
                  <td>{ready === st.length ? <span className="tm-ok">Ready</span> : <span className="muted">{ready} of {st.length}</span>}</td>
                  <td className="r tnum">{counts.get(c.id) ?? 0}</td>
                  <td className="r tnum">{c._count.users}</td>
                  <td className="tnum">{usd(m?.spent ?? 0)}{c.monthlyBudgetUsd != null ? ` of $${c.monthlyBudgetUsd}` : <span className="muted"> · no cap</span>}</td>
                  <td className="r"><Link href={`/team/client/${c.id}`} className="btn btn-secondary btn-sm">Settings</Link></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </Card>
      {canAdd && <Card title={<span className="inline-flex items-center gap-2"><Building2 size={18} /> Add a client</span>} sub="You go straight to its settings page, with a checklist of what to set up next.">
        <ActionForm action={addClientAction} className="grid gap-3">
          <label className="grid gap-1.5"><span className="text-xs font-semibold">Account name</span><input name="name" className="glass-input" placeholder="e.g. Acme Logistics" required /></label>
          <label className="grid gap-1.5"><span className="text-xs font-semibold">Logo <span className="muted font-normal">(optional)</span></span><input name="logo" className="glass-input" placeholder="Logo image link, or the website (e.g. acme.com)" /></label>
          <fieldset className="grid gap-1.5"><legend className="mb-1 text-xs font-semibold">People on this account</legend>
            <div className="flex flex-wrap gap-2">{users.map((u) => <label key={u.id} className="tm-pick"><input type="checkbox" name="users" value={u.id} /> {u.name}</label>)}</div>
          </fieldset>
          <SubmitButton className="btn btn-primary justify-self-start">Add client</SubmitButton>
        </ActionForm>
      </Card>}
    </>
  );
}

async function SystemTab({ health, clients }: { health: Awaited<ReturnType<typeof systemHealth>>; clients: Clients }) {
  const [spend, month, aiPaused, runs, stopped] = await Promise.all([spendByAccount(), monthlyStatus(), aiPause(), runHistory(30), stoppedGroups()]);
  const q = health.queue;
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const stoppedTotal = stopped.reduce((t, g) => t + g.count, 0);
  const dur = (a: Date, b: Date) => { const s = Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
  return (
    <>
      <Card title="AI spending" sub="Pausing stops all OpenRouter use: no company research runs (they stay queued), scheduled AI jobs are skipped, and AI buttons say it is paused. Searches that need the AI stop with it.">
        {aiPaused
          ? <p className="tm-warn">Paused by an admin {ago(aiPaused.since)}. {q.queued} companies are waiting.</p>
          : <p className="tm-ok">AI is running.</p>}
        <ActionButton action={setAiPausedAction.bind(null, !aiPaused)} className={aiPaused ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"} confirm={aiPaused ? undefined : "Pause all AI spending? Research stops until you resume."}>
          {aiPaused ? "Resume AI" : "Pause AI"}
        </ActionButton>
      </Card>
      <Card title="Database access" sub="Every table must be readable and writable by the app. A table created without access breaks the pages that use it.">
        {health.tables == null ? <p className="tm-warn">Couldn&apos;t check table access.</p>
          : health.tables.length ? <p className="tm-warn">The app can&apos;t use: <b>{health.tables.join(", ")}</b>. Grant access to the app&apos;s database role (see the grant_app_role migration).</p>
          : <p className="tm-ok">All tables are accessible.</p>}
      </Card>
      <Card title="Background queue" sub="Research for imported and approved companies, and lookalike investigations, run here.">
        <div className="tm-queue">
          <span><b className="tnum">{q.queued}</b> waiting</span>
          <span><b className="tnum">{q.running}</b> running</span>
          <span>{q.working ? "A worker is on it" : "No worker right now"}</span>
          <span>Last run {q.lastRunAt ? ago(q.lastRunAt) : "never"}</span>
        </div>
        {q.stuck && <p className="tm-warn">The queue has stopped: work is waiting and nothing has run for over 10 minutes.</p>}
        <ActionButton action={restartQueueAction} className={q.stuck ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}><RotateCcw size={14} /> Restart queue</ActionButton>
      </Card>
      <Card title="Stopped companies" sub={stoppedTotal ? `${stoppedTotal} companies stopped, grouped by client and why. Retry puts a whole group back in the queue from the step it stopped at. Stops that wait for a person's decision link to Approvals instead.` : "Companies that stopped during research show here, grouped by why."} pad={false}>
        {stopped.length === 0 ? <p className="tm-ok so-pad">No stopped companies.</p> : (
          <div className="table-wrap">
            <table className="data compact">
              <thead><tr><th>Client</th><th>Why they stopped</th><th className="r">Companies</th><th /></tr></thead>
              <tbody>{stopped.slice(0, 15).map((g) => (
                <tr key={g.clientId + g.key}>
                  <td className="strong">{clientName.get(g.clientId) ?? g.clientId}</td>
                  <td>{g.reason.length > 140 ? `${g.reason.slice(0, 140)}…` : g.reason}</td>
                  <td className="r tnum">{g.count}</td>
                  <td className="r">{/^(Rejection proposed|Identity confidence)|human review|a person approves/i.test(g.reason) ? <Link href="/review" className="vz-link">Decide on Approvals</Link> : <ActionButton action={retryStoppedAction.bind(null, g.clientId, g.key)} className="btn btn-secondary btn-sm" confirm={`Queue these ${g.count} companies again? ${aiPaused ? "AI is paused, so they wait until you resume it." : "This uses research credits."}`}>Retry {g.count}</ActionButton>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Run history" sub="Each background run: when, how long, how many companies it moved on, and whether it finished cleanly. Newest first." pad={false}>
        {runs.length === 0 ? <p className="muted so-pad text-sm">No runs recorded yet. They appear here from the next background run.</p> : (
          <div className="table-wrap">
            <table className="data compact">
              <thead><tr><th>When</th><th>Job</th><th className="r">Took</th><th className="r">Companies done</th><th className="r">Still waiting</th><th>Result</th></tr></thead>
              <tbody>{runs.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{ago(r.finishedAt)}</td>
                  <td className="strong">{r.job}</td>
                  <td className="r tnum">{dur(r.startedAt, r.finishedAt)}</td>
                  <td className="r tnum">{r.processed}</td>
                  <td className="r tnum">{r.remaining ?? "—"}</td>
                  <td>{r.ok ? <span className="so-health ok"><i />Finished</span> : <span className="so-health bad" title={r.note ?? undefined}><i />Failed{r.note ? `: ${r.note.slice(0, 60)}` : ""}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Recent errors" sub="Server errors from pages, actions, background research and lookalikes, grouped by place and message. Kept here because the host keeps logs for only an hour." action={health.errors.length ? <ActionButton action={clearErrorsAction} className="btn btn-secondary btn-sm" confirm="Clear the error log?">Clear</ActionButton> : undefined} pad={false}>
        {health.errors.length === 0 ? <p className="tm-ok px-5 py-4">No errors recorded.</p> : (
          <ul className="tm-errors">
            {health.errors.map((e) => (
              <li key={e.id}>
                <div className="tm-err-top"><b>{e.message}</b><span className="tnum">{e.count > 1 ? `×${e.count} · ` : ""}{ago(e.lastSeen)}</span></div>
                <div className="tm-err-src">{e.source}{e.detail ? ` · ${e.detail.split("\n")[0]}` : ""}</div>
                <div><ActionButton action={resolveErrorAction.bind(null, e.id)} className="tm-link">Mark resolved</ActionButton></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Alerts" sub="Email the Super Admins when the queue stops, a run fails or a client nears its spending cap.">
        <p className="muted text-sm">{process.env.SMTP_URL?.trim() ? "Coming next: switch alerts on here." : "Available once email sending is switched on in Admin → Integrations."}</p>
      </Card>
      <Card title="Services" pad={false}>
        <table className="data compact">
          <tbody>{health.services.map((s) => <tr key={s.key}><td className="strong">{s.label}</td><td><span className={`tm-svc ${s.mode}`}>{SERVICE_MODE_LABEL[s.mode]}</span></td><td className="muted text-xs">{s.via}</td></tr>)}</tbody>
        </table>
      </Card>
      <Card title="Spend by account" sub="Search, AI and contact lookups, including lookalike research. Set a monthly cap per account on the Accounts tab: research pauses for that account when it is reached." pad={false}>
        <table className="data compact">
          <thead><tr><th>Account</th><th className="text-right">This month</th><th className="text-right">Monthly cap</th><th className="text-right">Last 30 days</th><th className="text-right">All time</th></tr></thead>
          <tbody>{clients.map((c) => {
            const s = spend.get(c.id);
            const mo = month.get(c.id);
            return (
              <tr key={c.id}>
                <td className="strong">{c.name}{mo?.state === "over" ? <span className="tm-cap over">Cap reached: research paused</span> : mo?.state === "warn" ? <span className="tm-cap warn">{Math.round((mo.share ?? 0) * 100)}% of cap</span> : null}</td>
                <td className="text-right tnum">{usd(mo?.spent ?? 0)}</td>
                <td className="text-right tnum">{mo?.cap != null ? usd(mo.cap) : <span className="muted">none</span>}</td>
                <td className="text-right tnum">{usd(s?.month ?? 0)}</td>
                <td className="text-right tnum">{usd(s?.total ?? 0)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </Card>
    </>
  );
}

function DataTab({ clients }: { clients: Clients }) {
  return (
    <>
      <Card title={<span className="inline-flex items-center gap-2"><RotateCcw size={18} /> Re-research all companies</span>} sub="Research every company again from scratch under the current rules, in the background. Bad news found earlier is set aside and checked again. People, imports and approved work are kept.">
        <ActionButton action={reResearchAllAction} className="btn btn-secondary" confirm="Re-research every company from scratch? This uses research credits.">Re-research all</ActionButton>
      </Card>
      <Card title="Accept every email address" sub="People used to be held back when their email wasn't on the company's own domain (gmail.com, another domain). Any address is fine now. This closes the 'Is this the right person?' items that were only about the email; ones where the job title or employer also disagree stay open.">
        <ActionButton action={clearEmailConflictsAction} className="btn btn-secondary">Close email-only identity items</ActionButton>
      </Card>
      <Card title={<span className="inline-flex items-center gap-2"><Trash2 size={18} /> Clear one account</span>} sub="Removes that account's companies and everything attached (research, people, drafts, emails, tasks, opportunities), its imports and suggestions. Its team, brain and the other accounts are untouched. Can't be undone.">
        <ul className="tm-danger">
          {clients.map((c) => (
            <li key={c.id}>
              <b>{c.name}</b>
              <ActionForm action={clearAccountDataAction.bind(null, c.id)} className="tm-confirm">
                <input name="confirm" className="glass-input" placeholder={`Type ${c.name} to confirm`} aria-label={`Type ${c.name} to confirm`} autoComplete="off" required />
                <SubmitButton className="btn btn-danger btn-sm">Clear {c.name}</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={<span className="inline-flex items-center gap-2"><Trash2 size={18} /> Clear every account</span>} sub="Removes every company in every account, plus mailboxes and demo logins. Team, accounts, brains, knowledge files and sequences are kept. Can't be undone.">
        <ActionForm action={clearWorkspaceDataAction} className="tm-confirm">
          <input name="confirm" className="glass-input" placeholder='Type "delete everything" to confirm' aria-label="Type delete everything to confirm" autoComplete="off" required />
          <SubmitButton className="btn btn-danger btn-sm">Clear everything</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}

async function AuditTab({ clients, who, what, account, from, to, sensitive }: { clients: Clients; who?: string; what?: string; account?: string; from?: string; to?: string; sensitive?: string }) {
  const where = auditWhere({ who, what, account, from, to, sensitive });
  const [log, people, actions] = await Promise.all([
    db.auditEntry.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    db.auditEntry.findMany({ distinct: ["actorEmail"], select: { actorEmail: true }, orderBy: { actorEmail: "asc" } }),
    db.auditEntry.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const qs = new URLSearchParams({ ...(who ? { who } : {}), ...(what ? { what } : {}), ...(account ? { account } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(sensitive ? { sensitive } : {}) }).toString();
  return (
    <Card title="Audit log" sub="Who did what: approvals, sends, hand-offs, deals, research runs and every Super Admin change. Entries can't be edited." pad={false}>
      <form className="tm-filter" action="/team">
        <input type="hidden" name="tab" value="audit" />
        <select name="who" defaultValue={who ?? ""} className="glass-input" aria-label="Who"><option value="">Anyone</option>{people.map((p) => <option key={p.actorEmail} value={p.actorEmail}>{p.actorEmail}</option>)}</select>
        <select name="what" defaultValue={what ?? ""} className="glass-input" aria-label="What"><option value="">Any action</option>{actions.map((a) => <option key={a.action} value={a.action}>{ACTION_WORD[a.action] ?? a.action}</option>)}</select>
        <select name="account" defaultValue={account ?? ""} className="glass-input" aria-label="Account"><option value="">Any account</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <label className="tm-date"><span>From</span><input type="date" name="from" defaultValue={from ?? ""} className="glass-input" /></label>
        <label className="tm-date"><span>To</span><input type="date" name="to" defaultValue={to ?? ""} className="glass-input" /></label>
        <label className="tm-pick"><input type="checkbox" name="sensitive" value="1" defaultChecked={sensitive === "1"} /> Sensitive only</label>
        <button type="submit" className="btn btn-secondary btn-sm">Filter</button>
        {qs && <Link href="/team?tab=audit" className="btn btn-ghost btn-sm">Clear</Link>}
        <a href={`/team/audit.csv${qs ? `?${qs}` : ""}`} className="btn btn-secondary btn-sm"><Download size={14} /> Export CSV</a>
      </form>
      {log.length === 0 ? <p className="muted px-5 py-4 text-sm">Nothing recorded{qs ? " for this filter" : " yet"}.</p> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
            <tbody>
              {log.map((e) => (
                <tr key={e.id}>
                  <td className="muted whitespace-nowrap text-xs" title={e.createdAt.toISOString()}>{ago(e.createdAt)}</td>
                  <td className="text-xs">{e.actorEmail}</td>
                  <td className="text-sm font-semibold">{ACTION_WORD[e.action] ?? e.action}{isSensitive(e.action) && <span className="sec-flag">Sensitive</span>}</td>
                  <td className="muted text-xs">{[e.target, e.clientId ? clientName.get(e.clientId) ?? e.clientId : null].filter(Boolean).join(" · ")}{(e.before != null || e.after != null) && <details className="sec-diff"><summary>Before / after</summary><code>{JSON.stringify(e.before ?? null)}</code> → <code>{JSON.stringify(e.after ?? null)}</code></details>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Every client side by side, what needs a Super Admin's attention, and activity across clients. */
async function OverviewTab({ health }: { health: Awaited<ReturnType<typeof systemHealth>> }) {
  const rows = await clientOverview();
  const [setups, statuses] = await Promise.all([Promise.all(rows.map((r) => setupSteps(r.id))), db.client.findMany({ select: { id: true, status: true } })]);
  const setupLeft = new Map(rows.map((r, i) => { const d = setups[i].filter((x) => x.done).length; return [r.id, d < setups[i].length ? `${d} of ${setups[i].length}` : ""]; }));
  const statusOf = new Map(statuses.map((c) => [c.id, c.status]));
  const paused = await aiPause();
  const sum = (k: keyof ClientRow) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const alerts: { tone: "bad" | "warn"; text: string; href: string }[] = [
    ...(paused ? [{ tone: "warn" as const, text: `AI is paused: ${sum("queued")} companies waiting across clients`, href: "/team?tab=system" }] : []),
    ...(health.queue.stuck ? [{ tone: "bad" as const, text: "The background queue has stopped", href: "/team?tab=system" }] : []),
    ...(health.tables?.length ? [{ tone: "bad" as const, text: `The app can't use ${health.tables.length} table(s)`, href: "/team?tab=system" }] : []),
    ...(health.errors.length ? [{ tone: "warn" as const, text: `${health.errors.length} error type(s) in the log`, href: "/team?tab=system" }] : []),
    ...rows.flatMap((r) => r.issues.map((i) => ({ tone: (r.health === "bad" ? "bad" : "warn") as "bad" | "warn", text: `${r.name}: ${i}`, href: "/team?tab=accounts" }))),
  ];
  const sample = await sampleState();
  const svc = new Map(serviceStatus().map((x) => [x.key, x]));
  const live = (k: string) => svc.get(k as never)?.mode === "live";
  const noCap = rows.filter((r) => r.cap == null).map((r) => r.name);
  const checks = [
    { ok: live("llm"), t: "AI connected", d: live("llm") ? "The AI key is set" : "Add the OpenRouter key in Admin → Integrations" },
    { ok: live("research"), t: "Web search connected", d: live("research") ? "Search is set" : "Add a search key (Exa, Tavily or SerpAPI) in Admin → Integrations" },
    { ok: live("email"), t: "Email sending connected", d: live("email") ? "A mailbox is set. Send a test to prove it." : "Add the mailbox in Admin → Integrations. Until then approved emails are held." },
    { ok: noCap.length === 0 && rows.length > 0, t: "Monthly cap on every client", d: noCap.length ? `No cap: ${noCap.join(", ")}. Set it under Clients.` : "Every client has a spending ceiling" },
    { ok: !paused, t: "AI running", d: paused ? "Paused. Resume it under System once the rows above are green." : "Research and drafting are running" },
  ];
  const ready = checks.filter((c) => c.ok).length;
  return (
    <div className="grid gap-5">
      {ready < checks.length && (
        <Card title="Go live" sub={`${ready} of ${checks.length} ready. Real emails go out only when all are green.`} pad={false}>
          <ul className="gl-list">
            {checks.map((c) => <li key={c.t} className={c.ok ? "ok" : "todo"}><i aria-hidden />{c.ok ? "Done" : "To do"}<b>{c.t}</b><span>{c.d}</span></li>)}
          </ul>
          <div className="so-pad"><ActionButton action={sendTestEmailAction} className="btn btn-secondary btn-sm">Send me a test email</ActionButton></div>
        </Card>
      )}
      <Card title="Test client" sub="A separate client filled with 50 made-up companies, people, emails and deals, for trying things safely. It never touches your real clients, spends no credits and sends no email.">
        {sample.done ? (
          <div className="flex items-center gap-3 flex-wrap"><span className="tm-ok">Loaded: {sample.companies} sample companies. Pick &quot;Test (sample data)&quot; in the client menu.</span><ActionButton action={removeSampleAction} className="btn btn-secondary btn-sm" confirm="Remove the Test client and all its sample data? Your real clients are not affected.">Remove it</ActionButton></div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap"><SampleLoader label={sample.exists ? "Continue loading" : "Create the Test client"} />{sample.exists && <ActionButton action={removeSampleAction} className="btn btn-ghost btn-sm" confirm="Remove the partly loaded Test client?">Remove it</ActionButton>}</div>
        )}
      </Card>
      <KpiRow>
        <KpiTile tint={0} label="Clients" value={rows.length} note={`${rows.filter((r) => r.health === "ok").length} healthy`} />
        <KpiTile tint={1} label="Companies" value={sum("companies").toLocaleString()} note={`${sum("added7")} added this week`} />
        <KpiTile tint={2} label="Waiting for people" value={sum("waiting")} note="approvals across clients" />
        <KpiTile tint={3} label="Emails / replies" period="7 days" value={`${sum("emails7")} / ${sum("replies7")}`} note="sent and received" />
        <KpiTile tint={0} label="Spend" period="This month" value={usd(sum("spent"))} note="recorded across clients" />
      </KpiRow>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Needs attention" sub={alerts.length ? `${alerts.length} item${alerts.length === 1 ? "" : "s"}` : "All clear"} pad={false}>
          {alerts.length ? (
            <ul className="so-alerts">{alerts.slice(0, 10).map((a, i) => <li key={i}><Link href={a.href} className={a.tone}><i />{a.text}</Link></li>)}</ul>
          ) : <p className="tm-ok so-pad">Nothing needs you right now.</p>}
        </Card>
        <Card title="This week by client" sub="Companies added, emails sent and replies" className="xl:col-span-2">
          <GroupedBars categories={rows.map((r) => r.name)} series={[{ name: "Companies added", values: rows.map((r) => r.added7) }, { name: "Emails sent", values: rows.map((r) => r.emails7) }, { name: "Replies", values: rows.map((r) => r.replies7) }]} height={200} empty="No activity this week in any client." />
        </Card>
      </div>

      <Card title="Clients" sub="Health, work waiting and spend against each client's monthly cap" pad={false}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Client</th><th>Health</th><th className="r">Companies</th><th className="r">Queued</th><th className="r">Stopped</th><th className="r">Waiting</th><th className="r">Emails 7d</th><th className="r">Replies 7d</th><th>Spend this month</th><th>Last activity</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><span className="inline-flex items-center gap-2"><AccountLogo name={r.name} url={r.logoUrl} className="tm-logo" /><b>{r.name}</b></span><div className="muted text-xs">{r.people} {r.people === 1 ? "person" : "people"}</div></td>
                  <td><span className={`so-health ${r.health}`} title={r.issues.join(" · ") || "All good"}><i />{r.health === "ok" ? "Healthy" : r.health === "warn" ? "Check" : "Problem"}</span>{statusOf.get(r.id) && statusOf.get(r.id) !== "active" ? <div><span className={`cs-status ${statusOf.get(r.id)}`}>{CLIENT_STATUS_LABEL[statusOf.get(r.id) as "paused" | "archived"]}</span></div> : setupLeft.get(r.id) ? <div className="muted text-xs"><Link href={`/team/client/${r.id}`}>Setup {setupLeft.get(r.id)}</Link></div> : null}</td>
                  <td className="r tnum">{r.companies}</td>
                  <td className="r tnum">{r.queued}</td>
                  <td className="r tnum">{r.blocked}</td>
                  <td className="r tnum">{r.waiting}</td>
                  <td className="r tnum">{r.emails7}</td>
                  <td className="r tnum">{r.replies7}</td>
                  <td><div className="so-spend"><span className="tnum">{usd(r.spent)}{r.cap != null ? ` of $${r.cap}` : ""}</span>{r.cap != null && <span className={`so-bar ${r.capState}`}><i style={{ width: `${Math.min(100, (r.spent / Math.max(r.cap, 0.01)) * 100)}%` }} /></span>}</div></td>
                  <td className="muted">{r.lastActivity ? ago(r.lastActivity) : "never"}</td>
                  <td className="r"><span className="inline-flex gap-1"><Link href={`/team/client/${r.id}`} className="btn btn-ghost btn-sm">Settings</Link><form action={switchClientAction.bind(null, r.id)}><button type="submit" className="btn btn-secondary btn-sm">Open</button></form></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/** Sign-ins, failed attempts, sensitive changes and an emergency "sign everyone out". */
async function SecurityTab({ me, result }: { me: string; result?: string }) {
  const { SENSITIVE } = await import("@/lib/admin/audit");
  const { linkSignIn } = await import("@/lib/auth");
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const ok = result === "ok" ? true : result === "failed" ? false : undefined;
  const [events, failedByEmail, failedWeek, okWeek, changes, people] = await Promise.all([
    db.signInEvent.findMany({ where: ok === undefined ? {} : { ok }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.signInEvent.groupBy({ by: ["email"], where: { ok: false, createdAt: { gte: weekAgo } }, _count: true, orderBy: { _count: { email: "desc" } }, take: 5 }),
    db.signInEvent.count({ where: { ok: false, createdAt: { gte: weekAgo } } }),
    db.signInEvent.count({ where: { ok: true, createdAt: { gte: weekAgo } } }),
    db.auditEntry.findMany({ where: { action: { in: [...SENSITIVE] }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 15 }),
    db.user.count({ where: { status: "active" } }),
  ]);
  const byLink = linkSignIn();
  return (
    <>
      <KpiRow>
        <KpiTile tint={0} label="Sign-ins" period="7 days" value={okWeek} note="successful" />
        <KpiTile tint={failedWeek ? 2 : 3} label="Failed attempts" period="7 days" value={failedWeek} note={failedWeek ? "see who below" : "none"} />
        <KpiTile tint={1} label="Sensitive changes" period="30 days" value={changes.length} note="access, data, spending" />
        <KpiTile tint={3} label="Sign-in method" value={byLink ? "Email link" : "Email only"} note={byLink ? "proves the person owns the inbox" : "add SMTP_URL to switch to email links"} />
      </KpiRow>

      {!byLink && <p className="tm-warn">Anyone who types an allowed team email can sign in, because nothing checks they own that inbox. Once email sending is switched on in Admin → Integrations, sign-in switches to a one-time emailed link automatically.</p>}

      <div className="grid gap-5 xl:grid-cols-2 items-start">
        <Card title="Failed attempts by email" sub="Last 7 days. Many failures for one address can mean someone guessing." pad={false}>
          {failedByEmail.length === 0 ? <p className="tm-ok so-pad">No failed sign-ins this week.</p> : (
            <table className="data compact"><tbody>{failedByEmail.map((f) => <tr key={f.email}><td>{f.email}</td><td className="r tnum">{f._count}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="Sensitive changes" sub="Last 30 days: people and roles, data removal, exports, spending caps and client status." pad={false} action={<Link href="/team?tab=audit&sensitive=1" className="btn btn-ghost btn-sm">All</Link>}>
          {changes.length === 0 ? <p className="muted so-pad text-sm">None in the last 30 days.</p> : (
            <ul className="sec-list">{changes.map((c) => <li key={c.id}><span><b>{c.actorEmail === me ? "You" : c.actorEmail}</b> {ACTION_WORD[c.action] ?? c.action}{c.target ? `: ${c.target}` : ""}</span><time className="muted">{ago(c.createdAt)}</time></li>)}</ul>
          )}
        </Card>
      </div>

      <Card title="Sign-in history" sub="Every attempt, newest first, with where it came from." pad={false}>
        <div className="so-pad"><nav className="k-seg tm-tabs" aria-label="Filter sign-ins">
          <Link href="/team?tab=security" className={result ? undefined : "on"}>All</Link>
          <Link href="/team?tab=security&result=ok" className={result === "ok" ? "on" : undefined}>Successful</Link>
          <Link href="/team?tab=security&result=failed" className={result === "failed" ? "on" : undefined}>Failed</Link>
        </nav></div>
        {events.length === 0 ? <p className="muted so-pad text-sm">No sign-ins recorded yet.</p> : (
          <div className="table-wrap">
            <table className="data compact">
              <thead><tr><th>When</th><th>Email</th><th>Result</th><th>From</th><th>Browser</th></tr></thead>
              <tbody>{events.map((e) => (
                <tr key={e.id}>
                  <td className="muted" title={e.createdAt.toISOString()}>{ago(e.createdAt)}</td>
                  <td>{e.email}</td>
                  <td>{e.ok ? <span className="so-health ok"><i />{e.reason ?? "Signed in"}</span> : <span className="so-health bad"><i />{e.reason ?? "Failed"}</span>}</td>
                  <td className="muted mono text-xs">{e.ip ?? "—"}</td>
                  <td className="muted text-xs">{browserOf(e.userAgent)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Sign everyone out" sub={`For an emergency, e.g. a lost laptop. Every one of the ${people} active people (you too) must sign in again on every device. Nothing else changes.`}>
        <ActionButton action={signOutAllAction} className="btn btn-danger btn-sm" confirm="Sign everyone out on every device, including you?">Sign everyone out</ActionButton>
      </Card>
    </>
  );
}

/** "Chrome on Windows" from a user-agent string. */
function browserOf(ua: string | null): string {
  if (!ua) return "—";
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const o = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return o ? `${b} on ${o}` : b;
}
