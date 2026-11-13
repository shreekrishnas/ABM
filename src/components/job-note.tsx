// "Running in the background since 10:42": shown on a page while one of its long tasks is running.
import { Loader2 } from "lucide-react";
import { baseDb } from "@/lib/db-base";
import { JOB_STALE_MS } from "@/lib/jobs";

export async function JobNote({ sellerId, accountId, kinds }: { sellerId: string; accountId?: string; kinds: string[] }) {
  const j = await baseDb.backgroundJob.findFirst({
    where: { sellerId, kind: { in: kinds }, status: { in: ["queued", "running"] }, createdAt: { gte: new Date(Date.now() - JOB_STALE_MS) }, ...(accountId ? { accountId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (!j) return null;
  const at = j.createdAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  return (
    <div className="job-note" role="status">
      <Loader2 size={14} className="spin" aria-hidden />
      <span><b>{j.label}</b> is running in the background since {at}. You can keep working anywhere; the top bar tells you when it&apos;s done.</span>
    </div>
  );
}
