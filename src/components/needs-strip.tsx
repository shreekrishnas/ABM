import Link from "next/link";
import type { Need } from "@/lib/admin/needs";

/** "Needs: AI ● on · Web search ● waiting" under a page title; anything not on links to Integrations. */
export function NeedsStrip({ list }: { list: Need[] }) {
  if (!list.length) return null;
  const allOn = list.every((n) => n.state === "on");
  return (
    <div className={`nd-strip${allOn ? " ok" : ""}`} role="status">
      <span className="nd-l">Needs</span>
      {list.map((n) => (
        <span key={n.key} className={`nd-item ${n.state}`} title={n.why}><i />{n.label} <small>{n.state === "on" ? "on" : n.state === "waiting" ? "waiting" : "off"}</small></span>
      ))}
      {!allOn && <Link href="/admin/integrations" className="nd-link">Turn on in Integrations ›</Link>}
    </div>
  );
}
