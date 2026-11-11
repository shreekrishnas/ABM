"use client";

import { useActionState } from "react";
import { HOMES, NOTICE_KINDS, type NoticeKind } from "@/lib/prefs-shared";
import { saveMyProfileAction } from "./actions";

export function ProfileForm({ name, home, mute, superAdmin }: { name: string; home: string; mute: NoticeKind[]; superAdmin: boolean }) {
  const [r, act, pending] = useActionState(saveMyProfileAction, null);
  return (
    <form action={act} className="me-form">
      <label className="me-f"><span>Your name</span><input name="name" className="glass-input" defaultValue={name} required maxLength={80} /></label>
      <label className="me-f"><span>Open after sign-in</span>
        <select name="home" className="glass-select" defaultValue={home}>{HOMES.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}</select>
      </label>
      <fieldset className="me-f"><legend>Show in the notification bell</legend>
        <div className="me-checks">{NOTICE_KINDS.filter((k) => superAdmin || k.key !== "system").map((k) => <label key={k.key}><input type="checkbox" name={`n_${k.key}`} defaultChecked={!mute.includes(k.key)} /> {k.label}</label>)}</div>
      </fieldset>
      <div className="flex items-center gap-3"><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>Save</button>{r && <span className={r.ok ? "tm-ok text-sm" : "tm-warn text-sm"} role="status">{r.message}</span>}</div>
    </form>
  );
}
