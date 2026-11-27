import Link from "next/link";
import type { Need } from "@/lib/admin/needs";
import { getMe } from "@/lib/me";

/**
 * Under a page title, when something the page relies on is off. A Super Admin sees each service and a link
 * to Integrations; everyone else sees one plain line, with no mention of settings or who can change them.
 */
export async function NeedsStrip({ list }: { list: Need[] }) {
  if (!list.length) return null;
  const allOn = list.every((n) => n.state === "on");
  const me = await getMe();
  if (!me?.superAdmin) {
    if (allOn) return null;
    return <div className="nd-strip" role="status"><span className="nd-l">Some features on this page are not available right now.</span></div>;
  }
  return (
    <div className={`nd-strip${allOn ? " ok" : ""}`} role="status">
      <span className="nd-l">Needs</span>
      {list.map((n) => (
        <span key={n.key} className={`nd-item ${n.state}`} title={n.why}><i />{n.label} <small>{n.state === "on" ? "on" : n.state === "waiting" ? "waiting" : "off"}</small></span>
      ))}
      {!allOn && <Link href="/admin/integrations" className="nd-link">Integrations ›</Link>}
    </div>
  );
}
