import { Loader2 } from "lucide-react";
import { queueStatus } from "@/lib/queue/drain";
import { processQueueNowAction } from "@/app/actions";
import { ActionButton } from "./client";
import { ago } from "./ui";

// Background queue status: how many companies are waiting, whether a worker is on them,
// and when the last slice ran. Renders nothing when the queue is empty and idle.
export async function QueuePanel({ className }: { className?: string }) {
  const q = await queueStatus();
  if (q.queued === 0 && q.running === 0) return null;
  const busy = q.working || q.running > 0;
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl px-3 py-3 text-sm ${className ?? ""}`} style={{ background: "var(--surface-card-header)" }} role="status">
      {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" style={{ color: "var(--accent-primary)" }} />}
      <div className="secondary min-w-0 flex-1">
        <b style={{ color: "var(--text-primary)" }}>{q.queued.toLocaleString()}</b> compan{q.queued === 1 ? "y" : "ies"} waiting
        {q.running > 0 && <>, <b style={{ color: "var(--text-primary)" }}>{q.running}</b> running now</>}
        .{" "}
        {busy ? "Processing in the background — you can leave this page." : "Not running right now."}
        {q.lastRunAt && <span className="muted"> Last run {ago(q.lastRunAt)}{q.lastProcessed != null ? ` (${q.lastProcessed} done)` : ""}.</span>}
      </div>
      {!q.working && q.queued > 0 && (
        <ActionButton action={processQueueNowAction} className="btn btn-primary btn-sm">Process now</ActionButton>
      )}
    </div>
  );
}
