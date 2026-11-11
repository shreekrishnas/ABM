import { db } from "@/lib/db";

export type ViewItem = { id: string; name: string; query: string; shared: boolean; mine: boolean };

/** Built-in views, then the person's own and the team's shared ones. */
export const BUILT_IN: Record<string, { name: string; query: string }[]> = {
  companies: [
    { name: "Top priority", query: "tier=T1" },
    { name: "Hot intent", query: "hot=1" },
    { name: "No people yet", query: "nopeople=1" },
    { name: "Customers", query: "rel=customer" },
  ],
  people: [
    { name: "Not contacted", query: "stage=not_contacted" },
    { name: "Talking", query: "lane=talking" },
    { name: "Meetings", query: "lane=meeting" },
  ],
};

export async function savedViews(page: string, email: string | null): Promise<ViewItem[]> {
  if (!email) return [];
  const rows = await db.savedView.findMany({ where: { page, OR: [{ ownerEmail: email }, { shared: true }] }, orderBy: { name: "asc" } }).catch(() => []);
  return rows.map((r) => ({ id: r.id, name: r.name, query: r.query, shared: r.shared, mine: r.ownerEmail === email }));
}
