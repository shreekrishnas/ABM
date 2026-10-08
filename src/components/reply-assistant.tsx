"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { JOURNEY_STAGES, STAGE_INFO, type Stage } from "@/lib/journey/stages";
import { confirmReplyAction, suggestReplyAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "./client";

/** Agent-assisted reply classification: paste a reply → suggested stage and next action → a person confirms. */
export function ReplyAssistant({ contactId, campaignId, senderId }: { contactId: string; campaignId: string; senderId: string }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [s, setS] = useState<{ stage: Stage; reason: string; nextAction: string; by: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <ActionForm action={confirmReplyAction} className="grid gap-3">
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="senderId" value={senderId} />
      <textarea name="text" className="glass-textarea" rows={3} placeholder="Paste the reply exactly as received…" value={text} onChange={(e) => { setText(e.target.value); setS(null); }} required />
      {!s ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary btn-sm" disabled={pending || !text.trim()} onClick={() => start(async () => {
            setErr(null);
            const r = await suggestReplyAction(contactId, campaignId, senderId, text);
            if (r.ok) setS({ stage: r.stage, reason: r.reason, nextAction: r.nextAction, by: r.by });
            else setErr(r.message);
          })}>
            {pending ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Suggest meaning
          </button>
          {err && <span className="text-xs" style={{ color: "#B91C1C" }}>{err}</span>}
        </div>
      ) : (
        <div className="grid gap-2 rounded-xl px-3 py-3 text-sm" style={{ background: "var(--surface-card-header)", border: "1px solid var(--border-subtle)" }}>
          <div className="micro">Suggested by {s.by === "rules" ? "rules" : s.by === "mock" ? "sample rules" : s.by}</div>
          <div className="secondary">{s.reason}. <b style={{ color: "var(--text-primary)" }}>Next:</b> {s.nextAction}</div>
          <input type="hidden" name="suggestedBy" value={s.by} />
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="field-label" htmlFor={`rs-${contactId}`}>Stage this reply means</label>
              <select id={`rs-${contactId}`} name="stage" defaultValue={s.stage} className="glass-select" style={{ minWidth: 220 }}>
                {JOURNEY_STAGES.map((k) => <option key={k} value={k}>{STAGE_INFO[k].label}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor={`rd-${contactId}`}>Received</label>
              <input id={`rd-${contactId}`} type="date" name="date" className="glass-input" defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
            <SubmitButton className="btn btn-primary btn-sm">Confirm and save</SubmitButton>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setS(null)}>Discard</button>
          </div>
          <p className="muted text-xs">Every reply counts toward the reply total; the stage you confirm becomes the current stage (it never moves a qualified person backwards for a neutral reply).</p>
        </div>
      )}
    </ActionForm>
  );
}
