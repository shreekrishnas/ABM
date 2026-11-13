import Link from "next/link";
import { db } from "@/lib/db";
import { ActionForm, SubmitButton } from "@/components/client";
import { NeedsStrip } from "@/components/needs-strip";
import { JobNote } from "@/components/job-note";
import { needs } from "@/lib/admin/needs";
import { Card, PageHeader } from "@/components/ui";
import { LookalikeReview } from "./review";
import { ensureSellerPacks } from "@/lib/seller";
import { findLookalikesAction } from "@/app/discover/actions";

export const metadata = { title: "Lookalikes · Import" };
export const maxDuration = 300;

export default async function LookalikesPage({ searchParams }: { searchParams: Promise<{ seed?: string; view?: string }> }) {
  await ensureSellerPacks();
  const { seed, view } = await searchParams;
  // Recent seeds and the best existing accounts give the empty page something useful to start from.
  const need = await needs(["ai", "search"]);
  const [recent, best] = await Promise.all([
    db.prospectSuggestion.groupBy({ by: ["seed"], where: { origin: "lookalike", seed: { not: null } }, _count: true, _max: { createdAt: true }, orderBy: { _max: { createdAt: "desc" } }, take: 6 }),
    db.account.findMany({ where: { mergedIntoId: null, domain: { not: null }, OR: [{ stage: { in: ["CUSTOMER", "OPPORTUNITY", "MQA"] } }, { tier: "T1" }] }, orderBy: { priorityScore: { sort: "desc", nulls: "last" } }, take: 3, select: { name: true, domain: true } }),
  ]);
  return (
    <div className="page-enter">
      <PageHeader eyebrow="Import data · Lookalikes" title="Find companies like one website" sub="Enter a customer or a good-fit company. The AI finds companies like it, researches each one and lists them for your approval." />
      <NeedsStrip list={need.list} />
      <JobNote sellerId={await (await import("@/lib/scope")).activeSellerId()} kinds={["lookalikes"]} />
      <Card className="mb-5">
        <ActionForm action={findLookalikesAction} className="flex flex-wrap gap-2">
          <input name="website" className="glass-input min-w-0 flex-1" placeholder="company.com" aria-label="Company website" defaultValue={seed ?? ""} required />
          <SubmitButton className="btn btn-primary" disabled={!need.ok} title={need.blocker ?? undefined}>Find similar</SubmitButton>
          {!need.ok && <span className="nd-blocked w-full">{need.blocker}</span>}
        </ActionForm>
      </Card>
      {!seed && (recent.length > 0 || best.length > 0) && (
        <div className="lk-start">
          {recent.length > 0 && (
            <section>
              <h2>Recent lookalike searches</h2>
              <ul>{recent.map((r) => <li key={r.seed}><Link href={`/import/lookalikes?seed=${encodeURIComponent(r.seed!)}`}>{r.seed}</Link><span className="tnum">{r._count} found</span></li>)}</ul>
            </section>
          )}
          {best.length > 0 && (
            <section>
              <h2>Start from your customers and best accounts</h2>
              <ul>{best.map((b) => <li key={b.domain}><Link href={`/import/lookalikes?seed=${encodeURIComponent(b.domain!)}`}>{b.name}</Link><span className="mono">{b.domain}</span></li>)}</ul>
            </section>
          )}
        </div>
      )}
      <LookalikeReview seed={seed} view={view} />
    </div>
  );
}
