import Link from "next/link";
import { ArrowRight, FileSpreadsheet, Globe2, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { ensureSellerPacks, seller } from "@/lib/seller";
import { PageHeader } from "@/components/ui";
import { ImportCrumbs } from "@/components/import-layers";

export const metadata = { title: "Import data" };

/** Import data: three ways in, each its own layer. Found companies wait for approval before research. */
export default async function ImportHub() {
  await ensureSellerPacks();
  const sid = seller().id;
  const apollo = Boolean(process.env.APOLLO_API_KEY?.trim());
  const [batches, lookalikes, visitors] = await Promise.all([
    db.importBatch.count(),
    db.prospectSuggestion.count({ where: { sellerId: sid, origin: "lookalike", status: "new" } }),
    db.prospectSuggestion.count({ where: { sellerId: sid, origin: "website_visitor", status: "new" } }),
  ]);
  const options = [
    { href: "/import/upload", icon: FileSpreadsheet, step: "1", title: "Upload CSV", text: "Your own list of companies and people. See what each column needs, map your columns, preview what will be used, then import.", meta: batches ? `${batches} file${batches === 1 ? "" : "s"} imported` : "CSV or Excel" },
    { href: "/import/lookalikes", icon: Sparkles, step: "2", title: "Lookalikes", text: "Enter one company's website. Similar companies are found and sorted by your targeting rule; you approve which ones to research.", meta: lookalikes ? `${lookalikes} waiting for approval` : "From one website" },
    { href: "/import/apollo", icon: Globe2, step: "3", title: "Via Apollo", text: "Companies visiting your website, identified by Apollo. Sorted by your rule; you approve which ones to research.", meta: !apollo ? "Not connected yet" : visitors ? `${visitors} waiting for approval` : "Website visitors" },
  ];
  return (
    <div className="page-enter">
      <ImportCrumbs />
      <PageHeader eyebrow="Import data" title="How do you want to bring companies in?" sub="Every way in ends at the same place: companies you approve are researched, scored and drafted for automatically." />
      <div className="grid gap-4 md:grid-cols-3">
        {options.map((o) => (
          <Link key={o.href} href={o.href} className="layer-card group">
            <span className="layer-icon" aria-hidden><o.icon size={22} strokeWidth={1.6} /></span>
            <span className="micro">Option {o.step}</span>
            <span className="layer-title">{o.title}</span>
            <span className="layer-text">{o.text}</span>
            <span className="layer-foot"><span className="muted text-xs">{o.meta}</span><ArrowRight size={16} className="layer-arrow" /></span>
          </Link>
        ))}
      </div>
    </div>
  );
}
