import Link from "next/link";
import type { JourneyStage } from "@prisma/client";
import { STAGE_INFO } from "@/lib/journey/stages";
import { Avatar, ago } from "@/components/ui";

/** Lanes a person moves through. Several detailed stages share a lane so the board stays readable. */
export const LANES: { id: string; title: string; hint: string; stages: JourneyStage[]; color: string }[] = [
  { id: "new", title: "Not contacted", hint: "Send the request", stages: ["not_contacted"], color: "#64748B" },
  { id: "invited", title: "Invited", hint: "Waiting to accept", stages: ["connection_sent"], color: "#0EA5E9" },
  { id: "connected", title: "Connected", hint: "Follow up", stages: ["connection_accepted", "follow_up_sent"], color: "#4F46E5" },
  { id: "talking", title: "Talking", hint: "Answer them", stages: ["replied_neutral", "details_requested", "details_shared", "referred"], color: "#9333EA" },
  { id: "interested", title: "Interested", hint: "Book the call", stages: ["interested"], color: "#DB2777" },
  { id: "meeting", title: "Meeting", hint: "Run it", stages: ["call_scheduled", "demo_scheduled"], color: "#E11D48" },
  { id: "won", title: "Opportunity", hint: "With sales", stages: ["opportunity", "closed_won"], color: "#059669" },
  { id: "parked", title: "Parked", hint: "Later or closed", stages: ["nurture", "not_interested", "disqualified", "closed_lost"], color: "#94A3B8" },
];

export interface BoardCard { journeyId: string; contactId: string; name: string; title: string | null; company: string; sender: string; stage: JourneyStage; followUps: number; last: Date | null; /** The next step, when it is due now. */ due: string | null }

/** Cards shown per lane; the rest are one click away in the list. */
const PER_LANE = 8;

export function JourneyBoard({ cards }: { cards: BoardCard[] }) {
  return (
    <div className="-mx-1 overflow-x-auto pb-2">
      <div className="flex gap-3 px-1">
        {LANES.map((lane) => {
          // Whoever needs a step now comes first, then the most recent.
          const items = cards.filter((c) => lane.stages.includes(c.stage)).sort((a, b) => Number(Boolean(b.due)) - Number(Boolean(a.due)) || (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0));
          const due = items.filter((c) => c.due).length;
          // An empty lane collapses to a thin sliver with its count, so the board shows the journey, not empty space.
          if (items.length === 0) return <section key={lane.id} className="jb-empty" aria-label={`${lane.title}: nobody`} title={`${lane.title}: nobody here yet`}><span>{lane.title}</span><b className="tnum">0</b></section>;
          return (
            <section key={lane.id} className="glass-card-static flex w-[228px] shrink-0 flex-col" style={{ padding: "0.75rem", borderRadius: "1.25rem", borderTop: `3px solid ${lane.color}` }} aria-label={lane.title}>
              <header className="mb-2 flex items-baseline justify-between px-1">
                <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{lane.title}</span>
                <span className="jb-count">{due > 0 && <span className="jb-due-n" title={`${due} need a step now`}>{due} due</span>}<span className="tnum muted text-xs font-semibold">{items.length}</span></span>
              </header>
              <p className="muted mb-2 px-1 text-[0.7rem]">{lane.hint}</p>
              <div className="grid gap-2">
                {items.slice(0, PER_LANE).map((c) => (
                  <Link key={c.journeyId} href={`/people/${c.contactId}`} className="read-surface block rounded-xl p-2.5 transition-transform hover:-translate-y-0.5" style={{ border: "1px solid var(--border-subtle)", background: "var(--surface-read)" }}>
                    <div className="flex items-center gap-2">
                      <Avatar name={c.name} id={c.contactId} size={26} round />
                      <div className="min-w-0">
                        <div className="truncate text-[0.82rem] font-semibold" style={{ color: "var(--text-primary)" }}>{c.name}</div>
                        <div className="muted truncate text-[0.7rem]">{c.company}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {lane.stages.length > 1 && <span className="chip" style={{ ["--c" as string]: STAGE_INFO[c.stage].color }}>{STAGE_INFO[c.stage].label}{c.stage === "follow_up_sent" && c.followUps ? ` ${c.followUps}` : ""}</span>}
                      <span className="muted text-[0.68rem]">{c.sender} · {ago(c.last)}</span>
                    </div>
                    {c.due && <div className="jb-due">{c.due}</div>}
                  </Link>
                ))}
                {items.length > PER_LANE && <Link href={`/people?view=list&lane=${lane.id}`} className="jb-all">Show all {items.length}</Link>}
                {items.length === 0 && <div className="muted rounded-xl px-2 py-4 text-center text-xs" style={{ border: "1px dashed var(--border-default)" }}>Nobody here</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
