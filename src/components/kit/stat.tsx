import Link from "next/link";
import { Info } from "lucide-react";
import { metric, type MetricKey } from "@/lib/metrics";
import { Skeleton } from "./feedback";

type Tone = "default" | "success" | "warning" | "danger";

/**
 * A headline number. Its name, definition (tooltip) and link come from the metric registry,
 * never typed on the page. A metric with no honest destination shows no link.
 */
export function Stat({ id, value, sub, tone = "default", loading, pending }: { id: MetricKey; value: number | string; sub?: string; tone?: Tone; loading?: boolean; pending?: string }) {
  const m = metric(id);
  const body = (
    <>
      <span className="k-stat-l">{tone !== "default" && <i className={`k-dot ${tone}`} aria-hidden />}{m.label}<span className="k-info" title={m.define} aria-label={`Definition: ${m.define}`}><Info size={12} /></span></span>
      {loading ? <Skeleton w="60%" h={28} /> : <span className={`k-stat-v tnum${tone !== "default" ? ` ${tone}` : ""}`}>{value}</span>}
      {(sub || pending) && <span className="k-stat-s">{pending ?? sub}</span>}
    </>
  );
  return m.href && !pending ? <Link href={m.href} className="k-stat link">{body}</Link> : <div className="k-stat">{body}</div>;
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="k-stats">{children}</div>;
}
