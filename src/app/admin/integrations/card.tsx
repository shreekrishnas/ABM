"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { Toggle } from "@/components/toggle";
import type { FieldState } from "@/lib/integration-keys";
import { removeIntegrationKeyAction, saveIntegrationKeysAction, setIntegrationEnabledAction, type KeyResult } from "./actions";

export interface CardProps {
  id: string;
  name: string;
  what: string;
  state: string;
  stateWord: string;
  detail: string;
  last: string;
  note?: string;
  /** null: this integration has no switch (coming soon, or follows another one). */
  on: boolean | null;
  ready: boolean;
  fields: FieldState[];
  canEdit: boolean;
  anyOf?: boolean;
}

/** One integration: an on/off switch, and the keys it needs typed in place (never shown again, only the last 4). */
export function IntegrationCard(p: CardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<KeyResult | null>(null);
  const [saved, save, saving] = useActionState(async (prev: KeyResult | null, fd: FormData) => {
    const r = await saveIntegrationKeysAction(p.id, prev, fd);
    if (r.ok) { setOpen(false); router.refresh(); }
    return r;
  }, null);
  const shown = msg ?? saved;

  const flip = async (next: boolean) => {
    setMsg(null);
    if (next && !p.ready) { setOpen(true); setMsg({ ok: false, message: "Add the key below to switch this on." }); return; }
    const r = await setIntegrationEnabledAction(p.id, next);
    if (r.needsKey) setOpen(true);
    setMsg(r);
    router.refresh();
  };

  return (
    <section className="glass-card-static ig-card">
      <div className="ig-head">
        <span className="ig-logo" aria-hidden>{p.name.slice(0, 2).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <h2>{p.name}</h2>
          <span className={`ig-state ${p.state}`}><i />{p.stateWord}</span>
        </div>
        {p.on !== null && p.canEdit && <Toggle on={p.on} label={`${p.name} ${p.on ? "on" : "off"}`} onChange={flip} />}
      </div>
      <p className="ig-what">{p.what}</p>
      <p className="ig-detail">{p.detail}</p>

      {p.fields.length > 0 && (
        <ul className="ig-keys">
          {p.fields.map((f) => (
            <li key={f.env}>
              <KeyRound size={13} aria-hidden className={f.source ? "on" : undefined} />
              <span className="min-w-0">{f.label}{f.required && !p.anyOf ? <em> required</em> : null}</span>
              {f.source ? <b className="ig-keyset" title={f.source === "app" ? "Saved in the app" : "Set in Vercel"}>{f.secret ? "Key saved" : "Set"} <code>{f.hint}</code>{f.source === "vercel" ? " · Vercel" : ""}</b> : <span className="muted">Not set</span>}
              {f.source === "app" && p.canEdit && (
                <button type="button" className="ig-x" onClick={async () => { setMsg(await removeIntegrationKeyAction(p.id, f.env)); router.refresh(); }} title="Remove this key">Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {p.canEdit && p.fields.length > 0 && !open && (
        <button type="button" className="ig-edit" onClick={() => setOpen(true)}>{p.ready ? "Replace a key" : "Add key"}</button>
      )}

      {open && p.canEdit && (
        <form action={save} className="ig-form" autoComplete="off">
          {p.note && <p className="muted text-xs">{p.note}</p>}
          {p.fields.map((f) => (
            <label key={f.env} className="ig-field">
              <span>{f.label}{f.required && !p.anyOf ? " *" : ""}{f.help ? <small> · {f.help}</small> : null}</span>
              <input name={f.env} type={f.secret ? "password" : "text"} className="glass-input" placeholder={f.source ? `Saved (${f.hint}). Type to replace` : f.placeholder ?? ""} autoComplete="new-password" spellCheck={false} />
            </label>
          ))}
          <div className="flex gap-2 items-center">
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : null} Save key</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setMsg(null); }}>Cancel</button>
          </div>
          <p className="muted text-xs">Keys are stored encrypted and never shown again; only the last 4 characters.</p>
        </form>
      )}

      {shown && <p className={shown.ok ? "tm-ok text-sm" : "tm-warn text-sm"} role="status">{shown.message}</p>}
      <div className="ig-foot"><span className="ig-last">{p.last}</span></div>
    </section>
  );
}
