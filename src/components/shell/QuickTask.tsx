"use client";

import { useEffect, useState } from "react";
import { ListTodo, X } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/client";
import { createTaskAction } from "@/app/actions";

export type TaskTarget = { accountId?: string; contactId?: string; label?: string; title?: string; origin?: string };

/** Open the quick-add task window from anywhere: window.dispatchEvent(new CustomEvent("abm:task", { detail })). */
export function openTask(detail: TaskTarget) {
  window.dispatchEvent(new CustomEvent("abm:task", { detail }));
}

const day = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** One small window for adding a task about a company or person, from any page. */
export function QuickTask({ users }: { users: { id: string; name: string }[] }) {
  const [t, setT] = useState<TaskTarget | null>(null);
  const [due, setDue] = useState(day(1));
  useEffect(() => {
    const on = (e: Event) => { setT((e as CustomEvent<TaskTarget>).detail ?? {}); setDue(day(1)); };
    window.addEventListener("abm:task", on);
    return () => window.removeEventListener("abm:task", on);
  }, []);
  if (!t) return null;
  return (
    <div className="palette-backdrop" onMouseDown={() => setT(null)}>
      <div className="palette qt" role="dialog" aria-label="Add a task" onMouseDown={(e) => e.stopPropagation()}>
        <div className="qt-head"><ListTodo size={17} /><b>Add a task</b>{t.label && <span className="muted text-xs">about {t.label}</span>}<button type="button" className="ml-auto br-icon" onClick={() => setT(null)} aria-label="Close"><X size={16} /></button></div>
        <ActionForm action={async (s, fd) => { const r = await createTaskAction(s, fd); if (r?.ok) setT(null); return r; }} className="grid gap-3 p-4">
          {t.accountId && <input type="hidden" name="accountId" value={t.accountId} />}
          {t.contactId && <input type="hidden" name="contactId" value={t.contactId} />}
          <input type="hidden" name="origin" value={t.origin ?? "manual"} />
          <input name="title" className="glass-input" defaultValue={t.title ?? ""} placeholder="e.g. Call Priya about the pricing visit" autoFocus required aria-label="Task" />
          <textarea name="body" className="glass-input br-area" rows={2} placeholder="Notes (optional)" aria-label="Notes" />
          <div className="flex flex-wrap items-center gap-2">
            {[["Today", 0], ["Tomorrow", 1], ["In 3 days", 3], ["Next week", 7]].map(([l, n]) => (
              <button key={l} type="button" className={`qt-chip${due === day(n as number) ? " on" : ""}`} onClick={() => setDue(day(n as number))}>{l}</button>
            ))}
            <input type="date" name="dueAt" value={due} onChange={(e) => setDue(e.target.value)} className="glass-input" style={{ width: "auto" }} aria-label="Due date" />
          </div>
          {users.length > 0 && (
            <select name="assigneeId" className="glass-input" defaultValue="" aria-label="Assign to">
              <option value="">Assign to me</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <div className="flex justify-end"><SubmitButton className="btn btn-primary btn-sm">Add task</SubmitButton></div>
        </ActionForm>
      </div>
    </div>
  );
}

/** A button that opens the quick-add window for a company or person. */
export function AddTaskButton({ target, className = "btn btn-secondary btn-sm", children }: { target: TaskTarget; className?: string; children?: React.ReactNode }) {
  return <button type="button" className={className} onClick={() => openTask(target)} title="Add a task">{children ?? <><ListTodo size={14} /> Add task</>}</button>;
}
