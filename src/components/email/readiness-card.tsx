import Link from "next/link";
import { Check, Info, X } from "lucide-react";
import { Card } from "@/components/ui";
import { emailReadiness } from "@/lib/email/readiness";

/** One client's email readiness: what is in place, what is missing, and how to fix each. */
export async function EmailReadinessCard({ clientId, clientName }: { clientId: string; clientName?: string }) {
  const r = await emailReadiness(clientId);
  return (
    <Card id="email-readiness" title={`Email readiness${clientName ? `: ${clientName}` : ""}`} sub={r.ready ? "Approved emails can go out." : `Approved emails are held until these are done: ${r.missing.join(", ")}.`}>
      <ul className="grid gap-2">
        {r.items.map((i) => (
          <li key={i.key} className="flex gap-2">
            <span aria-hidden className={i.ok ? "tm-ok" : i.blocking ? "tm-warn" : "secondary"}>{i.ok ? <Check size={14} /> : i.blocking ? <X size={14} /> : <Info size={14} />}</span>
            <div className="min-w-0">
              <p className={!i.ok && i.blocking ? "tm-warn font-semibold" : "font-semibold"}>{i.label}<span className="sr-only">{i.ok ? ": done" : i.blocking ? ": missing" : ""}</span></p>
              {i.detail && <p className="secondary text-sm">{i.detail}</p>}
              {!i.ok && i.fix && <p className="text-sm"><b>Fix:</b> {i.href ? <Link href={i.href} className="vz-link">{i.fix}</Link> : i.fix}</p>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Every active client in one list, for System health. */
export async function EmailReadinessAll({ clients }: { clients: { id: string; name: string; status: string }[] }) {
  const rows = await Promise.all(clients.filter((c) => c.status === "active").map(async (c) => ({ c, r: await emailReadiness(c.id) })));
  return (
    <Card title="Email readiness" sub="Per client: approved emails go out only when everything is in place. Open a client's Settings for the full list and how to fix each.">
      <ul className="grid gap-2">
        {rows.map(({ c, r }) => (
          <li key={c.id}>
            <span className="font-semibold">{c.name}</span>{" "}
            {r.ready ? <span className="tm-ok">ready</span> : <span className="tm-warn">held: missing {r.missing.join(", ")}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
