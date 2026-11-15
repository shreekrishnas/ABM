"use client";

// Create, show once, or turn off a client's API key.
import { useState, useTransition } from "react";
import { createClientApiKeyAction, revokeClientApiKeyAction } from "../../actions";

export function ApiKeyPanel({ clientId, active, since }: { clientId: string; active: boolean; since: string | null }) {
  const [key, setKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const create = () => start(async () => {
    if (active && !confirm("Create a new key? The current key stops working at once.")) return;
    const r = await createClientApiKeyAction(clientId);
    setKey(r.key ?? null);
    setNote(r.message);
  });
  const revoke = () => start(async () => {
    if (!confirm("Turn this client's API key off? Calls with it are refused from now on.")) return;
    const r = await revokeClientApiKeyAction(clientId);
    setKey(null);
    setNote(r?.message ?? null);
  });
  return (
    <div className="grid gap-3">
      <p className="text-sm">{active ? <>An API key is active{since ? ` (created ${since})` : ""}. Calls made with it only ever see and change this client&apos;s records.</> : "No API key yet. Integrations (imports, signals, replies, website visitors) need one to send data for this client."}</p>
      {key && (
        <div className="grid gap-1">
          <input readOnly value={key} className="glass-input mono text-xs" aria-label="New API key" onFocus={(e) => e.currentTarget.select()} />
          <span className="muted text-xs">Copy it now: it is not stored and won&apos;t be shown again.</span>
        </div>
      )}
      {note && !key && <p className="muted text-xs">{note}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={create} disabled={pending}>{active ? "Create a new key" : "Create an API key"}</button>
        {active && <button type="button" className="btn btn-ghost btn-sm" onClick={revoke} disabled={pending}>Turn the key off</button>}
      </div>
    </div>
  );
}
