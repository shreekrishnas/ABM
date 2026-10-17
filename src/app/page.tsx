import { LayoutGrid, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { ensureSellerPacks, seller } from "@/lib/seller";
import { Hub } from "@/components/hub";

export const metadata = { title: "Home" };

/** The first page: two doors. Import data, or the Workspace. Each opens its next level in this tab. */
export default async function Landing() {
  await ensureSellerPacks();
  const p = seller();
  const [companies, waiting, approvals] = await Promise.all([
    db.account.count({ where: { mergedIntoId: null } }),
    db.prospectSuggestion.count({ where: { sellerId: p.id, status: "new", origin: { in: ["lookalike", "website_visitor"] } } }),
    db.draft.count({ where: { status: "pending_review" } }),
  ]);
  return (
    <Hub
      size="lg"
      eyebrow={`${p.name} · Account intelligence`}
      title="Where do you want to start?"
      cards={[
        { href: "/import", icon: Upload, title: "Import", text: "Bring companies in: upload a CSV, find lookalikes of one website, or pull website visitors from Apollo.", meta: waiting ? `${waiting} waiting for approval` : "3 ways in", alert: waiting > 0 },
        { href: "/work", icon: LayoutGrid, title: "Workspace", text: "Work on what you have: today's list, research, email drafting, sales and insights.", meta: [`${companies} compan${companies === 1 ? "y" : "ies"}`, approvals ? `${approvals} to approve` : ""].filter(Boolean).join(" · "), alert: approvals > 0 },
      ]}
    />
  );
}
