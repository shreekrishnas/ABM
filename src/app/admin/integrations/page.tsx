import Link from "next/link";
import { PageHeader, ago } from "@/components/ui";
import { integrations, type IntegrationState } from "@/lib/admin/integrations";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

const STATE: Record<IntegrationState, { word: string; cls: string }> = {
  connected: { word: "Connected", cls: "ok" },
  paused: { word: "Paused", cls: "warn" },
  setup: { word: "Needs set-up", cls: "info" },
  off: { word: "Not connected", cls: "off" },
  planned: { word: "Coming soon", cls: "off" },
  sample: { word: "Sample data", cls: "warn" },
};

/** Every connection in one place: what it does, whether it's working, when it last did something. */
export default async function IntegrationsPage() {
  const list = await integrations();
  const live = list.filter((i) => i.state === "connected").length;
  return (
    <div className="page-enter">
      <PageHeader eyebrow="Admin" title="Integrations" sub={`${live} of ${list.length} connected. Keys live in Vercel's environment settings; nothing secret is shown here.`} />
      <div className="ig-grid">
        {list.map((i) => (
          <section key={i.key} className="glass-card-static ig-card">
            <div className="ig-head">
              <span className="ig-logo" aria-hidden>{i.name.slice(0, 2).toUpperCase()}</span>
              <div className="min-w-0">
                <h2>{i.name}</h2>
                <span className={`ig-state ${STATE[i.state].cls}`}><i />{STATE[i.state].word}</span>
              </div>
            </div>
            <p className="ig-what">{i.what}</p>
            <p className="ig-detail">{i.detail}</p>
            <div className="ig-foot">
              <span className="ig-last">{i.lastLabel ? (i.last ? `${i.lastLabel} ${ago(i.last)}` : `${i.lastLabel}: never`) : ""}</span>
              {i.href && i.action && <Link href={i.href} className="btn btn-secondary btn-sm">{i.action}</Link>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
