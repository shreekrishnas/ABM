import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { DEFAULT_SELLER_ID, builtInPack, ensureSellerPacks, loadSeller, packSource } from "@/lib/seller";
import { listRevisions, versionUsage } from "@/lib/seller/edit";
import { PackEditor, type RevisionRow } from "./pack-editor";

export const metadata = { title: "Edit seller profile" };
export const dynamic = "force-dynamic";

export default async function EditSellerPage({ searchParams }: { searchParams: Promise<{ seller?: string }> }) {
  const sellerId = (await searchParams).seller ?? DEFAULT_SELLER_ID;
  if (!builtInPack(sellerId)) notFound();
  await ensureSellerPacks();
  const { pack, version } = loadSeller(sellerId);
  const source = packSource(sellerId);
  const revisions = await listRevisions(sellerId);
  const usage = await versionUsage(sellerId, [...new Set(revisions.map((r) => r.version))]);
  const rows: RevisionRow[] = revisions.map((r) => ({
    id: r.id,
    version: r.version,
    changed: r.changed,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    isReset: r.pack == null,
    facts: usage.get(r.version)?.facts ?? 0,
    drafts: usage.get(r.version)?.drafts ?? 0,
  }));
  return (
    <div className="page-enter">
      <Link href="/settings/seller" className="btn btn-ghost btn-sm mb-3 -ml-2"><ArrowLeft size={14} /> Seller profile</Link>
      <PageHeader
        eyebrow="Seller profile"
        title={`Edit ${pack.name}`}
        sub={<>Targeting, messaging and approval rules the brain uses for every company. Each save is a new version: runs pick it up straight away, and you can restore any earlier version. Active version <code className="mono">{version}</code>.</>}
      />
      {/* Remount on a new active version so the form starts from what was saved. */}
      <PackEditor key={version} sellerId={sellerId} base={pack} builtIn={source.source === "built-in"} source={{ rejected: source.rejected?.problems ?? null }} revisions={rows} />
    </div>
  );
}
