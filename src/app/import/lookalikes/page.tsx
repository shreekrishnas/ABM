import Link from "next/link";
import { db } from "@/lib/db";
import { ActionForm, SubmitButton } from "@/components/client";
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
  const [recent, best] = await Promise.all([
    db.prospectSuggestion.groupBy({ by: ["seed"], where: { origin: "lookalike", seed: { not: null } }, _count: true, _max: { createdAt: true }, orderBy: { _max: { createdAt: "desc" } }, take: 6 }),
    db.account.findMany({ where: { mergedIntoId: null, domain: { not: null }, OR: [{ stage: { in: ["CUSTOMER", "OPPORTUNITY", "MQA"] } }, { tier: "T1" }] }, orderBy: { priorityScore: { sort: "desc", nulls: "last" } }, take: 3, select: { name: true, domain: true } }),
  ]);
  return (
    <div className="page-enter">
      <PageHeader eyebrow="Import data · Lookalikes" title="Find companies like one website" sub="Enter a customer or a qualified account. The AI finds companies with the same business model and operations (Exa and Tavily), researches each one, verifies what it finds and scores fit and buying readiness. You approve, reject or ask for more research; contacts are looked up only after you approve." />
      <Card className="mb-5">
        <ActionForm action={findLookalikesAction} className="flex flex-wrap gap-2">
          <input name="website" className="glass-input min-w-0 flex-1" placeholder="company.com" aria-label="Company website" defaultValue={seed ?? ""} required />
          <SubmitButton className="btn btn-primary">Find similar</SubmitButton>
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
