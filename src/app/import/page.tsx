import { db } from "@/lib/db";
import { ensureSellerPacks } from "@/lib/seller";
import { activeSellerId } from "@/lib/scope";
import { IMPORT_PAGES } from "@/lib/nav";
import { Hub } from "@/components/hub";

export const metadata = { title: "Import data" };

const TEXT: Record<string, string> = {
  "/import/upload": "Your own list of companies and people. See what each column needs, map your columns, preview what will be used, then import.",
  "/import/lookalikes": "Enter one company's website. Similar companies are found and sorted by your targeting rule; you approve which ones to research.",
  "/import/apollo": "Companies visiting your website, identified by Apollo. Sorted by your rule; you approve which ones to research.",
};

/** Import data: three ways in, each its own layer. Found companies wait for approval before research. */
export default async function ImportHub() {
  await ensureSellerPacks();
  const sid = await activeSellerId();
  const apollo = Boolean(process.env.APOLLO_API_KEY?.trim());
  const [batches, lookalikes, visitors] = await Promise.all([
    db.importBatch.count(),
    db.prospectSuggestion.count({ where: { sellerId: sid, origin: "lookalike", status: "new" } }),
    db.prospectSuggestion.count({ where: { sellerId: sid, origin: "website_visitor", status: "new" } }),
  ]);
  const meta: Record<string, [string, boolean]> = {
    "/import/upload": [batches ? `${batches} file${batches === 1 ? "" : "s"} imported` : "CSV or Excel", false],
    "/import/lookalikes": [lookalikes ? `${lookalikes} waiting for approval` : "From one website", lookalikes > 0],
    "/import/apollo": [!apollo ? "Not connected yet" : visitors ? `${visitors} waiting for approval` : "Website visitors", visitors > 0],
  };
  return (
    <Hub
      eyebrow="Import data"
      title="How do you want to bring companies in?"
      sub="Every way in ends at the same place: companies you approve are researched, scored and drafted for automatically."
      cards={IMPORT_PAGES.map((p) => ({ href: p.href, icon: p.icon, title: p.label, text: TEXT[p.href], meta: meta[p.href][0], alert: meta[p.href][1] }))}
    />
  );
}
