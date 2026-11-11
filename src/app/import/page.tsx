import Link from "next/link";
import { Card, ago } from "@/components/ui";
import { db } from "@/lib/db";
import { ensureSellerPacks } from "@/lib/seller";
import { activeSellerId } from "@/lib/scope";
import { IMPORT_PAGES } from "@/lib/nav";
import { Hub } from "@/components/hub";

export const metadata = { title: "Import data" };

const TEXT: Record<string, string> = {
  "/import/upload": "Your own list of companies and people. See what each column needs, map your columns, preview what will be used, then import.",
  "/import/describe": "Describe the companies you want in plain words. The AI drafts criteria for you to check, searches the web, researches each company it finds against your criteria, and lists them for approval.",
  "/import/lookalikes": "Enter a customer's website. The AI finds companies with the same business model and operations, researches each one and scores fit and readiness; you approve which ones to keep.",
  "/import/apollo": "Companies visiting your website, identified by Apollo. Find the right people at them, download them as Excel or add them to the pipeline.",
};

/** Import data: four ways in, each its own layer. Found companies wait for approval before research. */
export default async function ImportHub() {
  await ensureSellerPacks();
  const sid = await activeSellerId();
  const apollo = (await (await import("@/lib/admin/needs")).needs(["apollo"])).ok;
  const [batches, searched, lookalikes, visitors] = await Promise.all([
    db.importBatch.count(),
    db.prospectSuggestion.count({ where: { sellerId: sid, origin: "discovery", status: "new" } }),
    db.prospectSuggestion.count({ where: { sellerId: sid, origin: "lookalike", status: "new" } }),
    db.prospectSuggestion.count({ where: { sellerId: sid, origin: "website_visitor", status: "new" } }),
  ]);
  const meta: Record<string, [string, boolean]> = {
    "/import/upload": [batches ? `${batches} file${batches === 1 ? "" : "s"} imported` : "CSV or Excel", false],
    "/import/describe": [searched ? `${searched} waiting for approval` : "From a description", searched > 0],
    "/import/lookalikes": [lookalikes ? `${lookalikes} waiting for approval` : "From one website", lookalikes > 0],
    "/import/apollo": [!apollo ? "Apollo is off" : visitors ? `${visitors} waiting for approval` : "Website visitors", visitors > 0],
  };
  const extras = await (await import("@/lib/extras")).showExtras();
  const recentBatches = await db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, filename: true, source: true, status: true, accepted: true, rejected: true, createdAt: true } });
  const market = await db.prospectSuggestion.count({ where: { sellerId: sid, origin: { notIn: ["discovery", "lookalike", "website_visitor"] }, status: "new" } });
  const waiting = [
    { label: "From a description", n: searched, href: "/import/describe" },
    { label: "Lookalikes", n: lookalikes, href: "/import/lookalikes" },
    { label: "Website visitors", n: visitors, href: "/import/apollo" },
    { label: "Market signals", n: market, href: "/discover" },
  ].filter((w) => w.n > 0);
  return (
    <Hub
      eyebrow="Import data"
      title="How do you want to bring companies in?"
      sub="Every way in ends at the same place: companies you approve are researched, scored and drafted for automatically."
      // A page added to the Import menu without its own text still renders (from its menu blurb).
      cards={IMPORT_PAGES.filter((p) => extras || !p.extra).map((p) => ({ href: p.href, icon: p.icon, title: p.label, text: TEXT[p.href] ?? p.blurb, meta: meta[p.href]?.[0] ?? p.blurb, alert: meta[p.href]?.[1] ?? false }))}
    >
      <div className="ih-grid">
        <Card title="Recent imports" sub="The last files and lists brought in" pad={false}>
          {recentBatches.length === 0 ? <p className="muted so-pad text-sm">Nothing imported yet. Upload a CSV to start.</p> : (
            <ul className="ih-list">{recentBatches.map((b) => (
              <li key={b.id}><span className="min-w-0"><b>{b.filename}</b><small>{b.source === "csv" ? "CSV" : b.source} · {ago(b.createdAt)}</small></span><span className="tnum">{b.accepted} added{b.rejected ? ` · ${b.rejected} skipped` : ""}</span><span className={`ih-st ${b.status}`}>{b.status === "done" ? "Done" : b.status === "failed" ? "Failed" : "Working"}</span></li>
            ))}</ul>
          )}
        </Card>
        <Card title="Waiting for you" sub="Companies found for you that need a yes or no before research starts" pad={false}>
          {waiting.length === 0 ? <p className="muted so-pad text-sm">Nothing waiting. Found companies appear here for your approval.</p> : (
            <ul className="ih-list">{waiting.map((w) => <li key={w.href}><Link href={w.href} className="min-w-0"><b>{w.label}</b></Link><span className="tnum">{w.n} to approve</span><Link href={w.href} className="vz-link">Review ›</Link></li>)}</ul>
          )}
        </Card>
      </div>
    </Hub>
  );
}
