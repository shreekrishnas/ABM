import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Circle, Download, ExternalLink } from "lucide-react";
import { baseDb } from "@/lib/db-base";
import { getMe } from "@/lib/me";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client";
import { Card, PageHeader, ago } from "@/components/ui";
import { AccountLogo } from "@/components/account-logo";
import { switchClientAction } from "@/app/login/actions";
import { monthlyStatus } from "@/lib/budget";
import { setupSteps } from "@/lib/admin/client-setup";
import { CLIENT_STATUS_LABEL, isClientStatus } from "@/lib/admin/client-status";
import { ROLES, ROLE_HELP, ROLE_LABEL } from "@/lib/roles";
import { clearAccountDataAction, renameClientAction, setAssignmentAction, setClientLogoAction, setClientStatusAction, setMonthlyBudgetAction, setRoleAction, setShowExtrasAction } from "../../actions";

export const metadata = { title: "Client settings" };

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Super Admin: one client's setup, basics, people, status, export and danger zone. */
export default async function ClientSettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const me = await getMe();
  if (!me?.superAdmin) notFound();
  const { id } = await params;
  const sp = await searchParams;
  const client = await baseDb.client.findUnique({ where: { id }, include: { users: { include: { user: { select: { id: true, name: true, email: true, status: true, superAdmin: true, lastSignInAt: true } } } } } });
  if (!client) notFound();
  const [steps, month, everyone, companies, lastActivity] = await Promise.all([
    setupSteps(id),
    monthlyStatus(),
    baseDb.user.findMany({ where: { status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    baseDb.account.count({ where: { sellerId: id, mergedIntoId: null } }),
    baseDb.account.findFirst({ where: { sellerId: id }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
  ]);
  const status = isClientStatus(client.status) ? client.status : "active";
  const done = steps.filter((s) => s.done).length;
  const m = month.get(id);
  const assigned = new Set(client.users.map((u) => u.userId));
  const people = client.users.filter((u) => u.user.status === "active").sort((a, b) => a.user.name.localeCompare(b.user.name));
  const others = everyone.filter((u) => !assigned.has(u.id));

  return (
    <div className="page-enter space-y-5">
      <Link href="/team?tab=accounts" className="vz-link"><ArrowLeft size={14} /> All clients</Link>
      <div className="cs-head">
        <AccountLogo name={client.name} url={client.logoUrl} className="cs-logo" />
        <div className="min-w-0">
          <PageHeader title={client.name} sub={`${companies} compan${companies === 1 ? "y" : "ies"} · ${people.length} ${people.length === 1 ? "person" : "people"} · last activity ${lastActivity ? ago(lastActivity.updatedAt) : "never"}`} />
        </div>
        <span className={`cs-status ${status}`}>{CLIENT_STATUS_LABEL[status]}</span>
        <form action={switchClientAction.bind(null, id)}><button type="submit" className="btn btn-primary btn-sm"><ExternalLink size={14} /> Open this client</button></form>
      </div>

      {sp.new && <p className="tm-ok">{client.name} is created. Work through the setup below; research starts once the Account Brain is ready.</p>}

      {done < steps.length && (
        <Card title="Setup" sub={`${done} of ${steps.length} done. Research and outreach run best once every step is done.`} pad={false}>
          <ul className="cs-steps">
            {steps.map((s) => (
              <li key={s.key} className={s.done ? "done" : undefined}>
                {s.done ? <CheckCircle2 size={18} aria-label="Done" /> : <Circle size={18} aria-label="To do" />}
                <span className="min-w-0"><b>{s.label}</b><small>{s.detail}</small></span>
                {!s.done && <Link href={s.href} className="btn btn-secondary btn-sm">Do this</Link>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Basics" sub="Name, logo, spending ceiling and which pages its team sees." className="cs-anchor">
        <span id="basics" />
        <div className="cs-grid">
          <ActionForm action={renameClientAction.bind(null, id)} className="cs-row" resetOnSuccess={false}>
            <label htmlFor="cs-name">Name</label>
            <input id="cs-name" name="name" className="glass-input" defaultValue={client.name} required />
            <SubmitButton className="btn btn-secondary btn-sm">Save</SubmitButton>
          </ActionForm>
          <ActionForm action={setClientLogoAction.bind(null, id)} className="cs-row" resetOnSuccess={false}>
            <label htmlFor="cs-logo">Logo</label>
            <input id="cs-logo" name="logo" className="glass-input" defaultValue={client.logoUrl ?? ""} placeholder="Logo link or website" />
            <SubmitButton className="btn btn-secondary btn-sm">Save</SubmitButton>
          </ActionForm>
          <ActionForm action={setMonthlyBudgetAction.bind(null, id)} className="cs-row" resetOnSuccess={false}>
            <label htmlFor="cs-cap">Monthly cap ($)</label>
            <input id="cs-cap" name="budget" className="glass-input" inputMode="numeric" defaultValue={client.monthlyBudgetUsd ?? ""} placeholder="Empty = no cap" />
            <SubmitButton className="btn btn-secondary btn-sm">Set cap</SubmitButton>
          </ActionForm>
          <p className="muted text-sm">Spent this month: <b className="tnum">{usd(m?.spent ?? 0)}</b>{client.monthlyBudgetUsd != null ? ` of $${client.monthlyBudgetUsd}` : ""}{m?.state === "over" ? " · cap reached, research paused" : ""}</p>
          <div className="cs-row">
            <span>Extra pages</span>
            <span className="muted text-sm">Coverage, Signals, Lookalikes, Market signals, Analytics, Behind the scenes</span>
            <ActionButton action={setShowExtrasAction.bind(null, id, !client.showExtras)} className="btn btn-secondary btn-sm">{client.showExtras ? "Shown: hide them" : "Hidden: show them"}</ActionButton>
          </div>
        </div>
      </Card>

      <Card title="People" sub="Who works on this client and what each may do. Super Admins can do everything regardless." pad={false}>
        <span id="people" />
        {people.length === 0 ? <p className="tm-warn so-pad">Nobody is assigned yet.</p> : (
          <div className="table-wrap">
            <table className="data compact">
              <thead><tr><th>Person</th><th>Role here</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>{people.map((u) => (
                <tr key={u.userId}>
                  <td className="strong">{u.user.name}<div className="muted text-xs font-normal">{u.user.email}</div></td>
                  <td>{u.user.superAdmin ? <span className="tm-role super">Super Admin</span> : (
                    <ActionForm action={setRoleAction} className="tm-roleform">
                      <input type="hidden" name="userId" value={u.userId} /><input type="hidden" name="clientId" value={id} />
                      <select name="role" defaultValue={u.role} aria-label={`${u.user.name}'s role`} title={ROLES.map((r) => `${ROLE_LABEL[r]}: ${ROLE_HELP[r]}`).join("\n")}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                      <SubmitButton className="tm-set">Set</SubmitButton>
                    </ActionForm>
                  )}</td>
                  <td className="muted">{u.user.lastSignInAt ? ago(u.user.lastSignInAt) : "Never"}</td>
                  <td className="r"><ActionButton action={setAssignmentAction.bind(null, u.userId, id, false)} className="btn btn-ghost btn-sm" confirm={`Remove ${u.user.name} from ${client.name}?`}>Remove</ActionButton></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {others.length > 0 && (
          <div className="so-pad flex flex-wrap gap-1.5 items-center"><span className="muted text-xs">Add:</span>
            {others.map((u) => <ActionButton key={u.id} action={setAssignmentAction.bind(null, u.id, id, true)} className="tm-chip">+ {u.name}</ActionButton>)}
          </div>
        )}
      </Card>

      <Card title="Status" sub="Pause stops research and sending for this client only; everything stays readable. Archive also removes it from team members' client menus. Nothing is deleted, and either can be undone.">
        <div className="flex flex-wrap gap-2 items-center">
          {status !== "active" && <ActionButton action={setClientStatusAction.bind(null, id, "active")} className="btn btn-primary btn-sm">{status === "archived" ? "Restore" : "Resume"}</ActionButton>}
          {status === "active" && <ActionButton action={setClientStatusAction.bind(null, id, "paused")} className="btn btn-secondary btn-sm" confirm={`Pause ${client.name}? Its research and approved emails wait until you resume it.`}>Pause</ActionButton>}
          {status !== "archived" && <ActionButton action={setClientStatusAction.bind(null, id, "archived")} className="btn btn-ghost btn-sm" confirm={`Archive ${client.name}? Work stops and it leaves team members' menus. Nothing is deleted; you can restore it.`}>Archive</ActionButton>}
        </div>
      </Card>

      <Card title="Export" sub="Everything for this client in one .zip: companies, people, facts with sources, emails, replies, deals, tasks and notes as spreadsheets, plus its Account Brain. Only this client's data.">
        <a href={`/team/client/${id}/export`} className="btn btn-secondary btn-sm"><Download size={14} /> Download export</a>
      </Card>

      <Card title="Danger zone" sub="Removes this client's companies and everything attached (research, people, drafts, emails, tasks). The client, its team and its Account Brain stay. Export first if you may need it.">
        <ActionForm action={clearAccountDataAction.bind(null, id)} className="flex flex-wrap gap-2 items-center">
          <input name="confirm" className="glass-input" placeholder={`Type ${client.name} to confirm`} aria-label="Type the client name to confirm" />
          <SubmitButton className="btn btn-danger btn-sm">Clear companies</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
