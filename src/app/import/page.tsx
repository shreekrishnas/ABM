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
  "/import/apollo": "Companies visiting your website, identified by Apollo. Sorted by your rule; you approve which ones to research.",
};

/** Import data: four ways in, each its own layer. Found companies wait for approval before research. */
export default async function ImportHub() {
  await ensureSellerPacks();
  const sid = await activeSellerId();
  const apollo = Boolean(process.env.APOLLO_API_KEY?.trim());
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
    "/import/apollo": [!apollo ? "Not connected yet" : visitors ? `${visitors} waiting for approval` : "Website visitors", visitors > 0],
  };
  return (
    <Hub
      eyebrow="Import data"
      title="How do you want to bring companies in?"
      sub="Every way in ends at the same place: companies you approve are researched, scored and drafted for automatically."
      // A page added to the Import menu without its own text still renders (from its menu blurb).
      cards={IMPORT_PAGES.map((p) => ({ href: p.href, icon: p.icon, title: p.label, text: TEXT[p.href] ?? p.blurb, meta: meta[p.href]?.[0] ?? p.blurb, alert: meta[p.href]?.[1] ?? false }))}
    />
  );
}
