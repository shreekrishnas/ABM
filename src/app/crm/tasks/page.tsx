import Link from "next/link";
import { CheckCircle2, Circle, ListTodo, Phone, Plus, Timer, UserPlus as Linkedin } from "lucide-react";
import { db } from "@/lib/db";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/client";
import { Badge, Card, Empty, PageHeader, ago, cx, date } from "@/components/ui";
import { completeTasksAction, createTaskAction, setTaskStatusAction } from "../../actions";
import { getMe } from "@/lib/me";
import { SelectAllBox } from "@/app/accounts/filters";
import { PeekPanel, closeHref, peekHref } from "@/components/peek/panel";
import { ListKeys } from "@/components/peek/list-keys";

export const metadata = { title: "CRM · Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; peek?: string; when?: string; who?: string }> }) {
  const sp = await searchParams;
  const view = sp.view ?? "open";
  const keep = { view: sp.view, when: sp.when, who: sp.who };
  const me = await getMe();
  const now0 = new Date();
  const startToday = new Date(now0.getFullYear(), now0.getMonth(), now0.getDate());
  const endToday = new Date(startToday.getTime() + 86_400_000);
  const endWeek = new Date(startToday.getTime() + 7 * 86_400_000);
  const WHEN: Record<string, object> = {
    overdue: { dueAt: { lt: startToday } },
    today: { dueAt: { gte: startToday, lt: endToday } },
    week: { dueAt: { gte: endToday, lt: endWeek } },
    later: { OR: [{ dueAt: { gte: endWeek } }, { dueAt: null }] },
  };
  const when = sp.when && WHEN[sp.when] ? sp.when : null;
  const who = sp.who === "me" || sp.who === "none" ? sp.who : null;
  const whoWhere = who === "me" ? { assignee: { email: me?.email ?? "-" } } : who === "none" ? { assigneeId: null } : {};
  const open = { status: { in: ["todo", "in_progress"] as ("todo" | "in_progress")[] } };
  const counts = Object.fromEntries(await Promise.all(Object.entries(WHEN).map(async ([k, w]) => [k, await db.task.count({ where: { ...open, ...whoWhere, ...w } })] as const)));
  const doneCount = await db.task.count({ where: { status: "done", ...whoWhere } });
  const q = (patch: Record<string, string | undefined>) => { const n = new URLSearchParams(Object.entries({ view: sp.view, when: sp.when, who: sp.who, ...patch }).filter(([, v]) => v) as [string, string][]); return `/crm/tasks${n.size ? `?${n}` : ""}`; };
  const [tasks, accounts, users] = await Promise.all([
    db.task.findMany({
      where: view === "done" ? { status: "done", ...whoWhere } : { ...open, ...whoWhere, ...(when ? WHEN[when] : {}) },
      include: { account: true, contact: true, assignee: true },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 200,
    }),
    db.account.findMany({ where: { mergedIntoId: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="page-enter">
      <ListKeys />
      <PeekPanel peek={sp.peek} close={closeHref("/crm/tasks", keep)} />
      <PageHeader
        eyebrow="CRM"
        title="Tasks"
        sub="Rep work in one list: LinkedIn and call steps from sequences, referral asks from replies, and anything added by hand."
        actions={
          <Modal trigger={<><Plus size={16} /> New task</>} title="Create a task" eyebrow="CRM" triggerClass="btn btn-brand">
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
          </Modal>
        }
      />
      <div className="tk-filters">
        <nav className="k-seg tm-tabs" aria-label="When">
          <Link href={q({ view: undefined, when: undefined })} className={cx(view === "open" && !when && "on")}>All open</Link>
          {([["overdue", "Overdue"], ["today", "Today"], ["week", "This week"], ["later", "Later"]] as const).map(([k, l]) => (
            <Link key={k} href={q({ view: undefined, when: k })} className={cx(view === "open" && when === k && "on")}>{l} <span className={`tk-n${k === "overdue" && counts[k] ? " bad" : ""}`}>{counts[k]}</span></Link>
          ))}
          <Link href={q({ view: "done", when: undefined })} className={cx(view === "done" && "on")}>Done <span className="tk-n">{doneCount}</span></Link>
        </nav>
        <nav className="k-seg tm-tabs" aria-label="Whose">
          <Link href={q({ who: undefined })} className={cx(!who && "on")}>Everyone</Link>
          <Link href={q({ who: "me" })} className={cx(who === "me" && "on")}>Mine</Link>
          <Link href={q({ who: "none" })} className={cx(who === "none" && "on")}>Unassigned</Link>
        </nav>
      </div>
      <ActionForm action={completeTasksAction}>
      {view !== "done" && tasks.length > 0 && <div className="tk-bulk"><label className="inline-flex items-center gap-2 text-xs"><SelectAllBox /> Select all</label><SubmitButton className="btn btn-secondary btn-sm"><CheckCircle2 size={14} /> Mark ticked done</SubmitButton></div>}
      <Card pad={false}>
        {tasks.length === 0 ? <Empty icon={<ListTodo size={20} />} title={view === "done" ? "Nothing completed yet" : "All caught up"} /> : (
          <ul>
            {tasks.map((t, i) => {
              const overdue = t.status !== "done" && t.dueAt && t.dueAt < startToday;
              const group = (x: typeof t) => x.status === "done" ? "" : !x.dueAt ? "Later" : x.dueAt < startToday ? "Overdue" : x.dueAt < endToday ? "Today" : x.dueAt < endWeek ? "This week" : "Later";
              const heading = group(t) && (i === 0 || group(tasks[i - 1]) !== group(t)) ? group(t) : null;
              const Icon = t.channel === "linkedin" ? Linkedin : t.channel === "call" ? Phone : Timer;
              return (
                <li key={t.id} className="tk-row">
                  {heading && <div className={`tk-h${heading === "Overdue" ? " bad" : ""}`}>{heading}</div>}
                  <div className="flex items-start gap-3 px-5 py-3.5">
                  {t.status !== "done" && <input type="checkbox" name="ids" value={t.id} aria-label={`Select ${t.title}`} className="mt-1.5" />}
                  <ActionButton action={setTaskStatusAction.bind(null, t.id, t.status === "done" ? "todo" : "done")} className="btn btn-icon -mt-1.5 h-8 w-8" title={t.status === "done" ? "Reopen" : "Mark done"}>
                    {t.status === "done" ? <CheckCircle2 size={18} style={{ color: "var(--success)" }} /> : <Circle size={18} />}
                  </ActionButton>
                  <div className="min-w-0 flex-1">
                    <div className={cx("text-sm font-semibold", t.status === "done" && "line-through opacity-60")} style={{ color: "var(--text-primary)" }}>{t.title}</div>
                    {t.body && <div className="secondary mt-0.5 line-clamp-2 text-xs">{t.body}</div>}
                    <div className="muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="inline-flex items-center gap-1"><Icon size={12} />{t.origin}</span>
                      {t.account && <Link href={peekHref("/crm/tasks", keep, "a", t.account.id)} scroll={false} className="hover:underline">{t.account.name}</Link>}
                      {t.contact && <Link href={peekHref("/crm/tasks", keep, "p", t.contact.id)} scroll={false} className="hover:underline">{t.contact.fullName}</Link>}
                      <span>{t.assignee?.name ?? "Unassigned"}</span>
                      <span>created {ago(t.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {t.status === "todo" && <ActionButton action={setTaskStatusAction.bind(null, t.id, "in_progress")} className="btn btn-ghost btn-sm">Start</ActionButton>}
                    {overdue ? <Badge color="var(--danger)">due {date(t.dueAt)}</Badge> : t.dueAt ? <Badge color="var(--muted)">{date(t.dueAt)}</Badge> : null}
                  </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      </ActionForm>
    </div>
  );
}
