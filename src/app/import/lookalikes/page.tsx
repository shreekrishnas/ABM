import { ActionForm, SubmitButton } from "@/components/client";
import { Card, PageHeader } from "@/components/ui";
import { ImportCrumbs, SuggestionReview } from "@/components/import-layers";
import { ensureSellerPacks } from "@/lib/seller";
import { findLookalikesAction } from "../../actions";

export const metadata = { title: "Lookalikes · Import" };
export const maxDuration = 300;

export default async function LookalikesPage({ searchParams }: { searchParams: Promise<{ seed?: string }> }) {
  await ensureSellerPacks();
  const { seed } = await searchParams;
  const apollo = Boolean(process.env.APOLLO_API_KEY?.trim());
  return (
    <div className="page-enter">
      <ImportCrumbs here="Lookalikes" />
      <PageHeader eyebrow="Import data · Lookalikes" title="Find companies like one website" sub={`Enter a customer or a great prospect. ${apollo ? "Apollo's company database and the web find" : "A web search finds"} similar companies, and each is sorted by your targeting rule.`} />
      <Card className="mb-5">
        <ActionForm action={findLookalikesAction} className="flex flex-wrap gap-2">
          <input name="website" className="glass-input min-w-0 flex-1" placeholder="company.com" aria-label="Company website" defaultValue={seed ?? ""} required />
          <SubmitButton className="btn btn-primary">Find similar</SubmitButton>
        </ActionForm>
      </Card>
      <SuggestionReview origin="lookalike" seed={seed} emptyText={seed ? `No similar companies saved for ${seed} yet.` : "Enter a website above. Results appear here, sorted into what will be used and what won't."} />
    </div>
  );
}
