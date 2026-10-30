import { notFound } from "next/navigation";
import Link from "next/link";
import { Activity, Building2, Download, History, RotateCcw, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getMe } from "@/lib/me";
import { allowedDomains } from "@/lib/auth";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client";
import { Card, PageHeader, ago } from "@/components/ui";
import { AccountLogo } from "@/components/account-logo";
import { SERVICE_MODE_LABEL } from "@/lib/adapters";
import { spendByAccount, systemHealth } from "@/lib/admin/health";
import { ACTION_WORD } from "@/lib/admin/audit";
import { addClientAction, addUserAction, clearAccountDataAction, clearWorkspaceDataAction, restartQueueAction, setAssignmentAction, setClientLogoAction, setUserStatusAction } from "./actions";
import { reResearchAllAction } from "@/app/actions";

export const metadata = { title: "Team & Access" };

const TABS = [
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
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "people";
  const clients = await db.client.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } });
  const health = await systemHealth();
  const problems = (health.tables?.length ? 1 : 0) + (health.queue.stuck ? 1 : 0);

  return (
    <div className="page-enter space-y-5">
      <PageHeader eyebrow="Super Admin" title="Team & Access" sub="Who can sign in, which accounts each person works on, how the system is doing, and every Super Admin action." />
      <nav className="k-seg tm-tabs" aria-label="Team & Access sections">
        {TABS.map((t) => (
          <Link key={t.key} href={`/team?tab=${t.key}`} className={tab === t.key ? "on" : undefined} aria-current={tab === t.key ? "page" : undefined}>
            <t.icon size={15} aria-hidden /> {t.label}
            {t.key === "system" && problems > 0 && <span className="tm-alert" aria-label={`${problems} problem${problems === 1 ? "" : "s"}`}>{problems}</span>}
          </Link>
        ))}
      </nav>
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
            <thead><tr><th>Name</th><th>Access</th><th>Accounts</th><th className="text-right">Sign-in</th></tr></thead>
            <tbody>
              {users.map((u) => {
                const assigned = new Set(u.clients.map((c) => c.clientId));
                const removed = u.status !== "active";
                return (
                  <tr key={u.id} style={removed ? { opacity: 0.55 } : undefined}>
                    <td className="strong">{u.name}<div className="muted mono text-xs font-normal">{u.email}</div></td>
                    <td>{u.superAdmin ? <span className="tm-role super">Super Admin</span> : <span className="tm-role">User</span>}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {clients.map((c) => assigned.has(c.id) ? (
                          <ActionButton key={c.id} action={setAssignmentAction.bind(null, u.id, c.id, false)} className="tm-chip on" confirm={`Remove ${u.name} from ${c.name}?`} title="Click to unassign">{c.name} ✓</ActionButton>
                        ) : (
                          <ActionButton key={c.id} action={setAssignmentAction.bind(null, u.id, c.id, true)} className="tm-chip" title="Click to assign" disabled={removed}>+ {c.name}</ActionButton>
                        ))}
                        {assigned.size === 0 && <span className="muted text-xs">No account yet</span>}
                      </div>
                    </td>
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
      <Card title={<span className="inline-flex items-center gap-2"><UserPlus size={18} /> Add a person</span>} sub="They sign in with this email; assign their accounts in the table above.">
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
  const spend = await spendByAccount();
  const q = health.queue;
  return (
    <>
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
      <Card title="Services" pad={false}>
        <table className="data compact">
          <tbody>{health.services.map((s) => <tr key={s.key}><td className="strong">{s.label}</td><td><span className={`tm-svc ${s.mode}`}>{SERVICE_MODE_LABEL[s.mode]}</span></td><td className="muted text-xs">{s.via}</td></tr>)}</tbody>
        </table>
      </Card>
      <Card title="Spend by account" sub="Search, AI and contact lookups recorded against companies." pad={false}>
        <table className="data compact">
          <thead><tr><th>Account</th><th className="text-right">Last 30 days</th><th className="text-right">All time</th><th className="text-right">Companies charged</th></tr></thead>
          <tbody>{clients.map((c) => { const s = spend.get(c.id); return <tr key={c.id}><td className="strong">{c.name}</td><td className="text-right tnum">{usd(s?.month ?? 0)}</td><td className="text-right tnum">{usd(s?.total ?? 0)}</td><td className="text-right tnum">{s?.companies ?? 0}</td></tr>; })}</tbody>
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
    <Card title="Audit log" sub="Every Super Admin action and mode switch. Entries can't be edited." pad={false}>
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
