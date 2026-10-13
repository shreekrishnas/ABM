import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Command palette lookup: companies and people by name, website or email. Behind the page password like every page.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 80) ?? "";
  if (q.length < 2) return NextResponse.json({ companies: [], people: [] });
  const [companies, people] = await Promise.all([
    db.account.findMany({ where: { mergedIntoId: null, OR: [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q, mode: "insensitive" } }] }, orderBy: [{ priorityScore: { sort: "desc", nulls: "last" } }], take: 6, select: { id: true, name: true, domain: true, tier: true } }),
    db.contact.findMany({ where: { mergedIntoId: null, OR: [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }, take: 6, select: { id: true, fullName: true, titleNormalized: true, account: { select: { name: true } } } }),
  ]);
  return NextResponse.json({
    companies: companies.map((c) => ({ id: c.id, label: c.name, sub: [c.domain, c.tier].filter(Boolean).join(" · "), href: `/accounts/${c.id}` })),
    people: people.map((p) => ({ id: p.id, label: p.fullName, sub: [p.titleNormalized, p.account.name].filter(Boolean).join(" · "), href: `/people/${p.id}` })),
  }, { headers: { "Cache-Control": "no-store" } });
}
