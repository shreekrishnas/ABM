"use client";
// Small controls for the People table: a role picker that saves on change, an "add client"
// picker, and a ⋯ menu for the less common actions.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Plus, X } from "lucide-react";
import { setAssignmentAction, setRoleAction, setUserStatusAction, signOutEverywhereAction } from "./actions";

const ROLE_OPTS = [["owner", "Owner"], ["manager", "Manager"], ["rep", "Rep"], ["viewer", "Viewer"]] as const;

export function ClientChip({ userId, userName, clientId, clientName, role, superAdmin }: { userId: string; userName: string; clientId: string; clientName: string; role: string; superAdmin: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const setRole = (r: string) => start(async () => {
    const fd = new FormData();
    fd.set("userId", userId); fd.set("clientId", clientId); fd.set("role", r);
    const res = await setRoleAction(null, fd);
    setMsg(res && !res.ok ? res.message : null);
    router.refresh();
  });
  const unassign = () => {
    if (!confirm(`Remove ${userName} from ${clientName}?`)) return;
    start(async () => { await setAssignmentAction(userId, clientId, false); router.refresh(); });
  };
  return (
    <span className={`pp-chip${pending ? " busy" : ""}`} title={msg ?? undefined}>
      <span className="pp-chip-name">{clientName}</span>
      {!superAdmin && (
        <select value={role} onChange={(e) => setRole(e.target.value)} disabled={pending} aria-label={`${userName}'s role in ${clientName}`}>
          {ROLE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}
      <button type="button" className="pp-chip-x" onClick={unassign} disabled={pending} aria-label={`Remove ${userName} from ${clientName}`}><X size={12} /></button>
    </span>
  );
}

export function AddClient({ userId, options, disabled }: { userId: string; options: { id: string; name: string }[]; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!options.length) return null;
  return (
    <label className={`pp-add${pending ? " busy" : ""}`}>
      <Plus size={12} aria-hidden />
      <select value="" disabled={disabled || pending} aria-label="Add to a client" onChange={(e) => { const id = e.target.value; if (id) start(async () => { await setAssignmentAction(userId, id, true); router.refresh(); }); }}>
        <option value="">Add client</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

export function RowMenu({ userId, userName, removed, canSignOut, children }: { userId: string; userName: string; removed: boolean; canSignOut: boolean; children?: React.ReactNode }) {
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDetailsElement>(null);
  const router = useRouter();
  const run = (fn: () => Promise<unknown>, ask?: string) => { if (ask && !confirm(ask)) return; start(async () => { await fn(); ref.current?.removeAttribute("open"); router.refresh(); }); };
  return (
    <details className="pp-menu" ref={ref}>
      <summary aria-label={`More for ${userName}`}><MoreHorizontal size={16} /></summary>
      <div className="pp-menu-pop" role="menu">
        {children}
        {canSignOut && !removed && <button type="button" role="menuitem" disabled={pending} onClick={() => run(() => signOutEverywhereAction(userId), `Sign ${userName} out on every device?`)}>Sign out everywhere</button>}
        {removed
          ? <button type="button" role="menuitem" disabled={pending} onClick={() => run(() => setUserStatusAction(userId, "active"))}>Restore access</button>
          : <button type="button" role="menuitem" className="danger" disabled={pending} onClick={() => run(() => setUserStatusAction(userId, "removed"), `Remove ${userName}? They won't be able to sign in. Their history is kept.`)}>Remove access</button>}
      </div>
    </details>
  );
}
