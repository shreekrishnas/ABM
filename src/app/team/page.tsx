import { notFound } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, Activity, Building2, Download, History, RotateCcw, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getMe } from "@/lib/me";
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
import { ACTION_WORD } from "@/lib/admin/audit";
import { clearEmailConflictsAction, clearErrorsAction, setMonthlyBudgetAction } from "./actions";
import { monthlyStatus } from "@/lib/budget";
import { addClientAction, addUserAction, clearAccountDataAction, clearWorkspaceDataAction, restartQueueAction, setAiPausedAction, setAssignmentAction, setClientLogoAction, removeSampleAction, resolveErrorAction, retryStoppedAction, sendTestEmailAction, setRoleAction, setShowExtrasAction, setUserStatusAction, signOutEverywhereAction } from "./actions";
import { serviceStatus } from "@/lib/adapters";
import { sampleState } from "@/lib/sample";
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
  { key: "audit", label: "Audit log", icon: History },
] as const;
type Tab = (typeof TABS)[number]["key"];

const usd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(n >= 100 ? 0 : 2)}`);

/** Super Admin only: people, accounts, system health, data and the audit log, one tab each. */
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ tab?: string; who?: string; what?: string; account?: string }> }) {
  const me = await getMe();
  if (!me?.superAdmin) notFound();
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "overview";
  const clients = await db.client.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } });
  const [health, month] = await Promise.all([systemHealth(), monthlyStatus()]);
  const problems = (health.tables?.length ? 1 : 0) + (health.queue.stuck ? 1 : 0) + [...month.values()].filter((m) => m.state !== "ok").length + (health.errors.length ? 1 : 0);

  return (
    <div className="page-enter space-y-5">
      <PageHeader eyebrow="Super Admin" title="Super Admin" sub="Every client at a glance, who can sign in and to what, how the system is doing, and every Super Admin action." />
      <nav className="k-seg tm-tabs" aria-label="Team & Access sections">
        {TABS.map((t) => (
          <Link key={t.key} href={`/team?tab=${t.key}`} className={tab === t.key ? "on" : undefined} aria-current={tab === t.key ? "page" : undefined}>
            <t.icon size={15} aria-hidden /> {t.label}
            {t.key === "system" && problems > 0 && <span className="tm-alert" aria-label={`${problems} problem${problems === 1 ? "" : "s"}`}>{problems}</span>}
          </Link>
        ))}
      </nav>
      {tab === "overview" && <OverviewTab health={health} />}
      {tab === "people" && <PeopleTab me={me.email} clients={clients} />}
      {tab === "accounts" && <AccountsTab clients={clients} />}
      {tab === "system" && <SystemTab health={health} clients={clients} />}
      {tab === "data" && <DataTab clients={clients} />}
      {tab === "audit" && <AuditTab clients={clients} who={sp.who} what={sp.what} account={sp.account} />}
    </div>
  );
}

type Clients = Awaited<ReturnType<typeof db.client.findMany<{ include: { _count: { select: { users: true } } } }>>>;

async function PeopleTab({ me, clients }: { me: string; clients: Clients }) {
  const users = await db.user.findMany({ where: { OR: allowedDomains().map((d) => ({ email: { endsWith: `@${d}` } })) }, orderBy: [{ status: "asc" }, { name: "asc" }], include: { clients: true } });
  return (
    <>
      <Card title="People" sub={`${users.filter((u) => u.status === "active").length} active. Click an account to assign or unassign.`} pad={false}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Access</th><th>Clients and role</th><th>Last sign-in</th><th className="text-right">Sign-in</th></tr></thead>
            <tbody>
              {users.map((u) => {
                const assigned = new Set(u.clients.map((c) => c.clientId));
                const roleOf = new Map(u.clients.map((c) => [c.clientId, c.role]));
                const removed = u.status !== "active";
                return (
                  <tr key={u.id} style={removed ? { opacity: 0.55 } : undefined}>
                    <td className="strong">{u.name}<div className="muted mono text-xs font-normal">{u.email}</div></td>
                    <td>{u.superAdmin ? <span className="tm-role super">Super Admin</span> : <span className="tm-role">User</span>}</td>
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
                    <td className="muted text-xs">{u.lastSignInAt ? ago(u.lastSignInAt) : "Never"}{!removed && u.email !== me && u.lastSignInAt && <div><ActionButton action={signOutEverywhereAction.bind(null, u.id)} className="tm-link" confirm={`Sign ${u.name} out on every device?`}>Sign out everywhere</ActionButton></div>}</td>
                    <td className="text-right">
                      {u.email === me ? <span className="muted text-xs">You</span> : removed
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

async function AccountsTab({ clients }: { clients: Clients }) {
  const users = await db.user.findMany({ where: { status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const spend = await spendByAccount();
  return (
    <>
      <Card title="Accounts" sub="Each account is its own workspace with its own brain. Paste a logo link or the website to show its logo." pad={false}>
        <ul className="tm-accts">
          {clients.map((c) => {
            const s = spend.get(c.id);
            return (
              <li key={c.id} className="tm-acct">
                <AccountLogo name={c.name} url={c.logoUrl} className="tm-acct-av" />
                <span className="min-w-0"><span className="font-semibold">{c.name}</span> <span className="muted text-xs"><Link href={`/brain?client=${c.id}`} className="underline">Brain</Link> · {c._count.users} {c._count.users === 1 ? "person" : "people"} · {s ? `${usd(s.month)} last 30 days` : "no spend yet"}</span></span>
                <ActionForm action={setClientLogoAction.bind(null, c.id)} className="tm-acct-logo">
                  <input name="logo" className="glass-input" defaultValue={c.logoUrl ?? ""} placeholder="Logo link or website" aria-label={`${c.name} logo link or website`} />
                  <SubmitButton className="btn btn-secondary btn-sm">Save</SubmitButton>
                </ActionForm>
                <ActionForm action={setMonthlyBudgetAction.bind(null, c.id)} className="tm-acct-logo" resetOnSuccess={false}>
                  <input name="budget" className="glass-input" inputMode="numeric" defaultValue={c.monthlyBudgetUsd ?? ""} placeholder="Monthly cap in $ (empty = no cap)" aria-label={`${c.name} monthly spending cap in dollars`} />
                  <SubmitButton className="btn btn-secondary btn-sm">Set cap</SubmitButton>
                </ActionForm>
                <ActionButton action={setShowExtrasAction.bind(null, c.id, !c.showExtras)} className="btn btn-ghost btn-sm" title="Extra pages: Coverage, Signals, Lookalikes, Market signals, Analytics, Behind the scenes">{c.showExtras ? "Extra pages: on" : "Extra pages: off"}</ActionButton>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title={<span className="inline-flex items-center gap-2"><Building2 size={18} /> Add an account</span>}>
        <ActionForm action={addClientAction} className="grid gap-3">
          <label className="grid gap-1.5"><span className="text-xs font-semibold">Account name</span><input name="name" className="glass-input" placeholder="e.g. Acme Logistics" required /></label>
          <label className="grid gap-1.5"><span className="text-xs font-semibold">Logo <span className="muted font-normal">(optional)</span></span><input name="logo" className="glass-input" placeholder="Logo image link, or the website (e.g. acme.com)" /></label>
          <fieldset className="grid gap-1.5"><legend className="mb-1 text-xs font-semibold">People on this account</legend>
            <div className="flex flex-wrap gap-2">{users.map((u) => <label key={u.id} className="tm-pick"><input type="checkbox" name="users" value={u.id} /> {u.name}</label>)}</div>
          </fieldset>
          <SubmitButton className="btn btn-primary justify-self-start">Add account</SubmitButton>
        </ActionForm>
      </Card>
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
        <p className="muted text-sm">{process.env.SMTP_URL?.trim() ? "Coming next: switch alerts on here." : "Available once email sending is connected (add SMTP_URL and SMTP_FROM in Vercel)."}</p>
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

async function AuditTab({ clients, who, what, account }: { clients: Clients; who?: string; what?: string; account?: string }) {
  const where: Prisma.AuditEntryWhereInput = { ...(who ? { actorEmail: who } : {}), ...(what ? { action: what } : {}), ...(account ? { clientId: account } : {}) };
  const [log, people, actions] = await Promise.all([
    db.auditEntry.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    db.auditEntry.findMany({ distinct: ["actorEmail"], select: { actorEmail: true }, orderBy: { actorEmail: "asc" } }),
    db.auditEntry.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const qs = new URLSearchParams({ ...(who ? { who } : {}), ...(what ? { what } : {}), ...(account ? { account } : {}) }).toString();
  return (
    <Card title="Audit log" sub="Who did what: approvals, sends, hand-offs, deals, research runs and every Super Admin change. Entries can't be edited." pad={false}>
      <form className="tm-filter" action="/team">
        <input type="hidden" name="tab" value="audit" />
        <select name="who" defaultValue={who ?? ""} className="glass-input" aria-label="Who"><option value="">Anyone</option>{people.map((p) => <option key={p.actorEmail} value={p.actorEmail}>{p.actorEmail}</option>)}</select>
        <select name="what" defaultValue={what ?? ""} className="glass-input" aria-label="What"><option value="">Any action</option>{actions.map((a) => <option key={a.action} value={a.action}>{ACTION_WORD[a.action] ?? a.action}</option>)}</select>
        <select name="account" defaultValue={account ?? ""} className="glass-input" aria-label="Account"><option value="">Any account</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button type="submit" className="btn btn-secondary btn-sm">Filter</button>
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
                  <td className="text-sm font-semibold">{ACTION_WORD[e.action] ?? e.action}</td>
                  <td className="muted text-xs">{[e.target, e.clientId ? clientName.get(e.clientId) ?? e.clientId : null].filter(Boolean).join(" · ")}</td>
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
    { ok: live("llm"), t: "AI connected", d: live("llm") ? "The AI key is set" : "Add OPENROUTER_API_KEY in Vercel" },
    { ok: live("research"), t: "Web search connected", d: live("research") ? "Search is set" : "Add a search key (Exa, Tavily or SerpAPI) in Vercel" },
    { ok: live("email"), t: "Email sending connected", d: live("email") ? "A mailbox is set. Send a test to prove it." : "Add SMTP_URL and SMTP_FROM in Vercel. Until then approved emails are held." },
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
                  <td><span className={`so-health ${r.health}`} title={r.issues.join(" · ") || "All good"}><i />{r.health === "ok" ? "Healthy" : r.health === "warn" ? "Check" : "Problem"}</span></td>
                  <td className="r tnum">{r.companies}</td>
                  <td className="r tnum">{r.queued}</td>
                  <td className="r tnum">{r.blocked}</td>
                  <td className="r tnum">{r.waiting}</td>
                  <td className="r tnum">{r.emails7}</td>
                  <td className="r tnum">{r.replies7}</td>
                  <td><div className="so-spend"><span className="tnum">{usd(r.spent)}{r.cap != null ? ` of $${r.cap}` : ""}</span>{r.cap != null && <span className={`so-bar ${r.capState}`}><i style={{ width: `${Math.min(100, (r.spent / Math.max(r.cap, 0.01)) * 100)}%` }} /></span>}</div></td>
                  <td className="muted">{r.lastActivity ? ago(r.lastActivity) : "never"}</td>
                  <td className="r"><form action={switchClientAction.bind(null, r.id)}><button type="submit" className="btn btn-secondary btn-sm">Open</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
