import { ActionButton } from "@/components/client";
import { Card, PageHeader } from "@/components/ui";
import { SuggestionReview } from "@/components/import-layers";
import { ensureSellerPacks } from "@/lib/seller";
import { fetchApolloVisitorsAction } from "@/app/discover/actions";
import { customerCheck, listVisitorCompanies, parseRange } from "@/lib/web/visitor-prospects";
import { VisitorsTable, type VisitorRow } from "./visitors-table";

export const metadata = { title: "Website visitors · Import" };
export const maxDuration = 300;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const short = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function ApolloImportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await ensureSellerPacks();
  const sp = await searchParams;
  const { from, to } = parseRange(sp.from, sp.to);
  const apollo = Boolean(process.env.APOLLO_API_KEY?.trim());
  const list = Boolean(process.env.APOLLO_VISITOR_LIST?.trim() || process.env.APOLLO_VISITOR_LABEL_ID?.trim());
  const ready = apollo && list;
  const companies = await listVisitorCompanies(from, to);
  const rows: VisitorRow[] = await Promise.all(
    companies.map(async (c) => {
      const chk = await customerCheck(c.name, c.domain);
      const prospects = (c.enrichment?.rows ?? []).filter((r) => r["First Name"]).map((r) => ({ name: [r["First Name"], r["Last Name"]].filter(Boolean).join(" "), title: r["Job Title"] ?? "", linkedin: r["Person LinkedIn URL"] ?? "", email: r["Email"] ?? "" }));
      return {
        key: c.key, name: c.name, domain: c.domain, visits: c.visits, lastVisit: short(c.lastVisit), pages: c.pages,
        inPipeline: chk.inPipeline, customer: chk.customer,
        status: c.enrichment?.status ?? null, message: c.enrichment?.message ?? null,
        enrichedAt: c.enrichment ? short(c.enrichment.enrichedAt) : null, importedAt: c.enrichment?.importedAt ? short(c.enrichment.importedAt) : null,
        prospects,
      };
    }),
  );
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="Import data · Website visitors"
        title="Companies visiting your website"
        sub="Pick companies, find the right people at them with Apollo, then download them as Excel or add them to the ABM pipeline. Nothing is added until you choose."
        actions={ready ? <ActionButton action={fetchApolloVisitorsAction} className="btn btn-secondary">Fetch visitors from Apollo now</ActionButton> : undefined}
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
      <Card className="mb-5">
        <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
          <label className="grid gap-1 text-sm"><span className="secondary">From</span><input className="glass-input" type="date" name="from" defaultValue={ymd(from)} /></label>
          <label className="grid gap-1 text-sm"><span className="secondary">To</span><input className="glass-input" type="date" name="to" defaultValue={ymd(to)} /></label>
          <button className="btn btn-secondary" type="submit">Show visitors</button>
        </form>
        {rows.length ? (
          <VisitorsTable rows={rows} range={{ from: ymd(from), to: ymd(to) }} />
        ) : (
          <p className="secondary text-sm">No identified companies visited between {short(from)} and {short(to)}. Try a wider range{ready ? ", or fetch visitors from Apollo now" : ""}.</p>
        )}
      </Card>
      <h2 className="mb-2 text-base font-semibold">Suggested by your targeting rule</h2>
      <SuggestionReview origin="website_visitor" emptyText={ready ? "No visitor companies waiting for approval." : "Visitor companies appear here once Apollo is connected."} />
    </div>
  );
}
