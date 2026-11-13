import Link from "next/link";
import { ActionButton } from "@/components/client";
import { NeedsStrip } from "@/components/needs-strip";
import { JobNote } from "@/components/job-note";
import { needs } from "@/lib/admin/needs";
import { Card, PageHeader } from "@/components/ui";
import { SuggestionReview } from "@/components/import-layers";
import { ensureSellerPacks } from "@/lib/seller";
import { fetchApolloVisitorsAction } from "@/app/discover/actions";
import { customerCheck, earliestVisit, listVisitorCompanies, parseRange } from "@/lib/web/visitor-prospects";
import { VisitorsTable, type VisitorRow } from "./visitors-table";
import { checkApolloAction } from "./actions";

export const metadata = { title: "Website visitors · Import" };
export const maxDuration = 300;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const short = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function ApolloImportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await ensureSellerPacks();
  const sp = await searchParams;
  // Without a chosen range, show every visitor company Apollo has dated (its visit dates can be months back).
  const { from, to } = parseRange(sp.from, sp.to, new Date(), sp.from ? null : await earliestVisit());
  const need = await needs(["apollo"]);
  // The visitor list is found automatically (an account list named "…visitor…") unless one is configured.
  const ready = need.ok;
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
        actions={ready ? <div className="flex flex-wrap gap-2"><ActionButton action={checkApolloAction} className="btn btn-secondary">Check Apollo connection</ActionButton><ActionButton action={fetchApolloVisitorsAction} className="btn btn-primary">Fetch visitors from Apollo now</ActionButton></div> : undefined}
      />
      <NeedsStrip list={need.list} />
      <JobNote sellerId={await (await import("@/lib/scope")).activeSellerId()} kinds={["apollo_fetch"]} />
      {!ready && (
        <Card title="Turn on Apollo" className="mb-5">
          <p className="secondary text-sm">Add your Apollo key and switch Apollo on. Then, in Apollo, save website visitors to an account list with &quot;visitor&quot; in its name; it is found automatically.</p>
          <Link href="/admin/integrations" className="btn btn-primary btn-sm mt-3">Turn on Apollo</Link>
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
      <h2 className="mb-2 text-base font-semibold">Waiting for approval</h2>
      <SuggestionReview origin="website_visitor" emptyText={ready ? "No visitor companies waiting for approval." : "Visitor companies appear here once Apollo is on."} />
    </div>
  );
}
