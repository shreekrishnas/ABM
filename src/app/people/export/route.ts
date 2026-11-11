import type { JourneyStage, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { JOURNEY_STAGES, stageLabel } from "@/lib/journey/stages";

// People on the list as CSV, with the same search, campaign, sender and stage filters as the page.
const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const stage = (JOURNEY_STAGES as readonly string[]).includes(sp.stage ?? "") ? (sp.stage as JourneyStage) : undefined;
  const scope: Prisma.JourneyWhereInput = { ...(sp.campaign ? { campaignId: sp.campaign } : {}), ...(sp.sender ? { senderId: sp.sender } : {}) };
  const and: Prisma.ContactWhereInput[] = [{ mergedIntoId: null }];
  if (sp.q) and.push({ OR: [{ fullName: { contains: sp.q, mode: "insensitive" } }, { email: { contains: sp.q, mode: "insensitive" } }, { title: { contains: sp.q, mode: "insensitive" } }, { account: { name: { contains: sp.q, mode: "insensitive" } } }] });
  if (sp.campaign || sp.sender || stage) and.push({ journeys: { some: { ...scope, ...(stage ? { stage } : {}) } } });
  const people = await db.contact.findMany({
    where: { AND: and }, take: 10_000, orderBy: { fullName: "asc" },
    select: { fullName: true, title: true, email: true, phone: true, linkedinUrl: true, updatedAt: true, account: { select: { name: true, domain: true } }, journeys: { where: scope, orderBy: { updatedAt: "desc" }, take: 1, select: { stage: true, campaign: { select: { name: true } }, sender: { select: { name: true } } } } },
  });
  const head = ["Name", "Title", "Company", "Website", "Email", "Phone", "LinkedIn", "Journey stage", "Campaign", "Sender", "Last activity"];
  const rows = people.map((p) => {
    const j = p.journeys[0];
    return [p.fullName, p.title, p.account?.name, p.account?.domain, p.email, p.phone, p.linkedinUrl, j ? stageLabel(j.stage) : "", j?.campaign?.name, j?.sender?.name, p.updatedAt.toISOString().slice(0, 10)].map(cell).join(",");
  });
  return new Response([head.join(","), ...rows].join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="people-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
