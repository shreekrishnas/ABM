import { notFound } from "next/navigation";
import { ShieldCheck, UserPlus, Building2, History } from "lucide-react";
import { db } from "@/lib/db";
import { getMe } from "@/lib/me";
import { allowedDomains } from "@/lib/auth";
import { SELLERS } from "@/lib/seller";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client";
import { Card, PageHeader, ago } from "@/components/ui";
import { addClientAction, addUserAction, setAssignmentAction, setUserStatusAction } from "./actions";

export const metadata = { title: "Team & Access" };

const ACTION_WORD: Record<string, string> = {
  "user.add": "added a user", "user.remove": "removed a user", "user.restore": "restored a user",
  "assignment.add": "assigned", "assignment.remove": "unassigned", "client.add": "added a client",
  "mode.super_admin": "switched to Super Admin", "mode.user": "switched to User",
};

/** Super Admin only: who can sign in, which clients each person sees, and the audit log. */
export default async function TeamPage() {
  const me = await getMe();
  if (!me?.superAdmin) notFound();
  const [users, clients, log] = await Promise.all([
    db.user.findMany({ where: { OR: allowedDomains().map((d) => ({ email: { endsWith: `@${d}` } })) }, orderBy: [{ status: "asc" }, { name: "asc" }], include: { clients: true } }),
    db.client.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } }),
    db.auditEntry.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <div className="page-enter space-y-5">
      <PageHeader eyebrow="Super Admin" title="Team & Access" sub="Who can sign in, and which clients each person works on. Everyone signed in is a User with full access to their clients; only Super Admin changes this page. Every change here is recorded in the audit log." />

      <Card title={<span className="inline-flex items-center gap-2"><ShieldCheck size={18} /> Users</span>} sub={`${users.filter((u) => u.status === "active").length} active`} pad={false}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Access</th><th>Clients</th><th className="text-right">Sign-in</th></tr></thead>
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
                        {assigned.size === 0 && <span className="muted text-xs">No client yet</span>}
                      </div>
                    </td>
                    <td className="text-right">
                      {u.email === me.email ? <span className="muted text-xs">You</span> : removed
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

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={<span className="inline-flex items-center gap-2"><UserPlus size={18} /> Add a user</span>} sub="They sign in with this email; assign their clients in the table above.">
          <ActionForm action={addUserAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input name="name" className="glass-input" placeholder="Full name" aria-label="Full name" required />
            <input name="email" type="email" className="glass-input" placeholder="name@trilliantdigital.com" aria-label="Email" required />
            <SubmitButton className="btn btn-primary">Add</SubmitButton>
          </ActionForm>
        </Card>
        <Card title={<span className="inline-flex items-center gap-2"><Building2 size={18} /> Clients</span>} sub="Each client is its own workspace.">
          <ul className="mb-3 grid gap-1.5 text-sm">
            {clients.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span className="font-semibold">{c.name}</span>
                <span className="muted text-xs">{c._count.users} user{c._count.users === 1 ? "" : "s"}{SELLERS[c.id] ? "" : " · needs a seller pack before research"}</span>
              </li>
            ))}
          </ul>
          <ActionForm action={addClientAction} className="flex gap-2">
            <input name="name" className="glass-input min-w-0 flex-1" placeholder="Client name" aria-label="Client name" required />
            <SubmitButton className="btn btn-secondary">Add client</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <Card title={<span className="inline-flex items-center gap-2"><History size={18} /> Audit log</span>} sub="Every Super Admin action and mode switch. Entries can't be edited." pad={false}>
        {log.length === 0 ? <p className="muted px-5 py-4 text-sm">Nothing recorded yet.</p> : (
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
    </div>
  );
}
