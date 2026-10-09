import Link from "next/link";
import { ArrowLeft, RefreshCw, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { DEFAULT_SELLER_ID, ensureSellerPacks, sellerFor } from "@/lib/seller";
import { getAdapters } from "@/lib/adapters";
import { ensureIndexed, knowledgeStats } from "@/lib/knowledge/rag/store";
import { Card, PageHeader, ago } from "@/components/ui";
import { StatStrip } from "@/components/v2";
import { ActionButton } from "@/components/client";
import { deleteDocumentAction, reindexAction } from "./actions";
import { AddDocumentForm, KIND_LABEL, KnowledgeSearch } from "./kb-client";

export const metadata = { title: "Knowledge base" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ORIGIN_LABEL: Record<string, string> = { built_in: "Built in", upload: "Added", learned: "Learned from replies" };

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ origin?: string }> }) {
  const origin = (await searchParams).origin;
  await ensureSellerPacks();
  const sp = sellerFor(DEFAULT_SELLER_ID);
  const embedder = getAdapters().embedder;
  let indexError: string | null = null;
  try {
    await ensureIndexed(sp);
  } catch (e) {
    indexError = e instanceof Error ? e.message.slice(0, 200) : String(e);
  }
  const [stats, docs] = await Promise.all([
    knowledgeStats(sp.id),
    db.knowledgeDoc.findMany({
      where: { sellerId: sp.id, ...(origin ? { origin } : {}) },
      orderBy: [{ origin: "desc" }, { kind: "asc" }, { title: "asc" }],
      select: { id: true, title: true, kind: true, origin: true, approved: true, url: true, updatedAt: true, _count: { select: { chunks: true } } },
    }),
  ]);
  const count = (o: string) => stats.byKind.filter((b) => b.origin === o).reduce((a, b) => a + b._count, 0);
  const otherModel = stats.models.filter((m) => m.model !== embedder.model);

  return (
    <div className="page-enter">
      <Link href="/settings" className="btn btn-ghost btn-sm mb-3 -ml-2"><ArrowLeft size={14} /> Settings</Link>
      <PageHeader
        eyebrow="What the writer knows"
        title="Knowledge base"
        sub="Researched outreach studies, the writing playbook, buyer personas, objection answers, example messages and Manch's own material, split into chunks and embedded. Every draft pulls the pieces that fit the person, channel and trigger."
        actions={<ActionButton action={reindexAction} className="btn btn-secondary"><RefreshCw size={15} /> Re-index</ActionButton>}
      />

      {indexError && <p className="read-surface mb-4 rounded-xl px-4 py-3 text-sm" role="alert" style={{ color: "var(--stop, #DC2626)" }}>Indexing failed: {indexError}. Drafts are still written, without the knowledge base.</p>}

      <StatStrip items={[
        { label: "Built in", value: count("built_in"), meta: "from research, playbook and seller profile" },
        { label: "Added by the team", value: count("upload"), meta: "documents you added" },
        { label: "Learned", value: count("learned"), meta: "emails that got a positive reply" },
        { label: "Chunks", value: stats.chunks.toLocaleString(), meta: stats.lastUpdated ? `updated ${ago(stats.lastUpdated)}` : "not indexed yet" },
        { label: "Search", value: <span style={{ fontSize: "1rem" }}>{embedder.live ? "By meaning" : "By words"}</span>, meta: embedder.live ? embedder.model : "set OPENROUTER_API_KEY for meaning-based search" },
      ]} />
      {otherModel.length > 0 && <p className="muted mt-2 text-xs">{otherModel.reduce((a, m) => a + m.chunks, 0)} chunks were embedded with another model ({otherModel.map((m) => m.model).join(", ")}). Re-index to switch them to {embedder.model}.</p>}

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid min-w-0 gap-5">
          <Card title="Try it" sub="The same search the writer runs before each message. Type what a message is about.">
            <KnowledgeSearch />
          </Card>
          <Card title={`Documents (${docs.length})`} sub="Built-in documents come from the code and the seller profile; edit them there." pad={false}
            action={
              <nav className="flex gap-1 text-xs" aria-label="Filter by origin">
                {[["", "All"], ["built_in", "Built in"], ["upload", "Added"], ["learned", "Learned"]].map(([k, l]) => (
                  <Link key={k} href={k ? `/settings/knowledge?origin=${k}` : "/settings/knowledge"} className={`btn btn-sm ${(origin ?? "") === k ? "btn-primary" : "btn-ghost"}`}>{l}</Link>
                ))}
              </nav>
            }>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Document</th><th>Kind</th><th>From</th><th>Chunks</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id}>
                      <td className="max-w-[360px]">
                        <span className="strong">{d.title}</span>
                        {d.approved && <span className="chip ml-2" style={{ ["--c" as string]: "#059669" }}>may be stated</span>}
                        {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="muted ml-2 text-xs underline">source</a>}
                      </td>
                      <td className="text-xs">{KIND_LABEL[d.kind] ?? d.kind}</td>
                      <td className="text-xs">{ORIGIN_LABEL[d.origin] ?? d.origin}</td>
                      <td className="tnum">{d._count.chunks}</td>
                      <td className="muted whitespace-nowrap text-xs">{ago(d.updatedAt)}</td>
                      <td>{d.origin !== "built_in" && <ActionButton action={deleteDocumentAction.bind(null, d.id)} className="btn btn-icon" title="Remove" confirm={`Remove "${d.title}" from the knowledge base?`}><Trash2 size={15} aria-label="Remove" /></ActionButton>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <Card title="Add knowledge" sub="Case studies, call notes, objection answers, emails that got replies. The more of your own, the better the drafts.">
          <AddDocumentForm />
        </Card>
      </div>
    </div>
  );
}
