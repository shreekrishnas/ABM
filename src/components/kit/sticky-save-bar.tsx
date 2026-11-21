"use client";

/** Appears while there are unsaved changes; says which sections changed. */
export function StickySaveBar({ changed, saving, onSave, onDiscard, status }: { changed: string[]; saving?: boolean; onSave: () => void; onDiscard: () => void; status?: string }) {
  if (!changed.length && !status) return null;
  return (
    <div className="k-savebar" role="region" aria-label="Unsaved changes">
      <span>{changed.length ? <>Unsaved changes in <b>{changed.join(", ")}</b></> : status}</span>
      {changed.length > 0 && (
        <span className="k-savebar-a">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDiscard} disabled={saving}>Discard</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
        </span>
      )}
    </div>
  );
}
