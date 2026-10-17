import { ActionButton } from "@/components/client";
import { Card, PageHeader } from "@/components/ui";
import { ImportCrumbs, SuggestionReview } from "@/components/import-layers";
import { ensureSellerPacks } from "@/lib/seller";
import { fetchApolloVisitorsAction } from "../../actions";

export const metadata = { title: "Via Apollo · Import" };
export const maxDuration = 300;

export default async function ApolloImportPage() {
  await ensureSellerPacks();
  const apollo = Boolean(process.env.APOLLO_API_KEY?.trim());
  const list = Boolean(process.env.APOLLO_VISITOR_LIST?.trim() || process.env.APOLLO_VISITOR_LABEL_ID?.trim());
  const ready = apollo && list;
  return (
    <div className="page-enter">
      <ImportCrumbs here="Via Apollo" />
      <PageHeader
        eyebrow="Import data · Via Apollo"
        title="Companies visiting your website"
        sub="Apollo identifies the companies behind website visits. They're fetched every day and sorted by your targeting rule; nothing is researched until you approve it."
        actions={ready ? <ActionButton action={fetchApolloVisitorsAction} className="btn btn-primary">Fetch from Apollo now</ActionButton> : undefined}
      />
      {!ready && (
        <Card title="Connect Apollo" className="mb-5">
          <ol className="secondary grid list-decimal gap-1.5 pl-5 text-sm">
            <li className={apollo ? "line-through" : ""}>In Vercel, add <code>APOLLO_API_KEY</code> (a master API key).</li>
            <li className={list ? "line-through" : ""}>In Apollo, save website visitors to an account list, then add its name as <code>APOLLO_VISITOR_LIST</code>.</li>
            <li>Redeploy. Visitors are then fetched daily, or now with one button here.</li>
          </ol>
        </Card>
      )}
      <SuggestionReview origin="website_visitor" emptyText={ready ? "No visitor companies yet. Fetch from Apollo now, or wait for the daily run." : "Visitor companies appear here once Apollo is connected."} />
    </div>
  );
}
