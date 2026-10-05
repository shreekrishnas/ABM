import Link from "next/link";
import { CheckCircle2, Circle, Linkedin, ListTodo, Phone, Plus, Timer } from "lucide-react";
import { db } from "@/lib/db";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/client";
import { Badge, Card, Empty, PageHeader, ago, cx, date } from "@/components/ui";
import { createTaskAction, setTaskStatusAction } from "../../actions";

export const metadata = { title: "CRM · Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view ?? "open";
  const [tasks, accounts, users] = await Promise.all([
    db.task.findMany({
      where: view === "done" ? { status: "done" } : { status: { in: ["todo", "in_progress"] } },
      include: { account: true, contact: true, assignee: true },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 200,
    }),
    db.account.findMany({ where: { mergedIntoId: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ orderBy: { name: "asc" } }),
  ]);
  const now = new Date();

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="CRM"
        title="Tasks"
        sub="Rep work in one list: LinkedIn and call steps from sequences, referral asks from replies, and anything added by hand."
        actions={
          <Modal trigger={<><Plus size={16} /> New task</>} title="Create a task" eyebrow="CRM" triggerClass="btn btn-brand">
            {() => (
              <ActionForm action={createTaskAction} className="grid gap-3">
                <div><label className="field-label" htmlFor="tt">Title</label><input id="tt" name="title" required className="glass-input" /></div>
                <div><label className="field-label" htmlFor="tb">Details</label><textarea id="tb" name="body" className="glass-textarea" /></div>
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="field-label" htmlFor="ta">Account</label><select id="ta" name="accountId" className="glass-select"><option value="">None</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                  <div><label className="field-label" htmlFor="tu">Assignee</label><select id="tu" name="assigneeId" className="glass-select"><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
                  <div><label className="field-label" htmlFor="td">Due</label><input id="td" name="dueAt" type="date" className="glass-input" /></div>
                </div>
                <div className="flex justify-end"><SubmitButton>Create task</SubmitButton></div>
              </ActionForm>
            )}
          </Modal>
        }
      />
      <div className="segmented mb-4">
        <Link href="/crm/tasks" className={cx(view === "open" && "on")}>Open</Link>
        <Link href="/crm/tasks?view=done" className={cx(view === "done" && "on")}>Completed</Link>
      </div>
      <Card pad={false}>
        {tasks.length === 0 ? <Empty icon={<ListTodo size={20} />} title={view === "done" ? "Nothing completed yet" : "All caught up"} /> : (
          <ul>
            {tasks.map((t) => {
              const overdue = t.status !== "done" && t.dueAt && t.dueAt < now;
              const Icon = t.channel === "linkedin" ? Linkedin : t.channel === "call" ? Phone : Timer;
              return (
                <li key={t.id} className="flex items-start gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid var(--border-subtle)", borderLeft: `3px solid ${overdue ? "#EF4444" : t.status === "in_progress" ? "#0EA5E9" : "transparent"}` }}>
                  <ActionButton action={setTaskStatusAction.bind(null, t.id, t.status === "done" ? "todo" : "done")} className="btn btn-icon -mt-1.5 h-8 w-8" title={t.status === "done" ? "Reopen" : "Mark done"}>
                    {t.status === "done" ? <CheckCircle2 size={18} style={{ color: "#10B981" }} /> : <Circle size={18} />}
                  </ActionButton>
                  <div className="min-w-0 flex-1">
                    <div className={cx("text-sm font-semibold", t.status === "done" && "line-through opacity-60")} style={{ color: "var(--text-primary)" }}>{t.title}</div>
                    {t.body && <div className="secondary mt-0.5 line-clamp-2 text-xs">{t.body}</div>}
                    <div className="muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="inline-flex items-center gap-1"><Icon size={12} />{t.origin}</span>
                      {t.account && <Link href={`/accounts/${t.account.id}`} className="hover:underline">{t.account.name}</Link>}
                      <span>{t.assignee?.name ?? "Unassigned"}</span>
                      <span>created {ago(t.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {t.status === "todo" && <ActionButton action={setTaskStatusAction.bind(null, t.id, "in_progress")} className="btn btn-ghost btn-sm">Start</ActionButton>}
                    {overdue ? <Badge color="#DC2626">overdue · {date(t.dueAt)}</Badge> : t.dueAt ? <Badge color="#64748B">{date(t.dueAt)}</Badge> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
