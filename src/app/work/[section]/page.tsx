import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { SECTIONS } from "@/lib/nav";
import { Hub } from "@/components/hub";

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return { title: SECTIONS.find((s) => s.key === section)?.label ?? "Workspace" };
}

/** One workspace section: its pages as cards. */
export default async function SectionHub({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const s = SECTIONS.find((x) => x.key === section);
  if (!s) notFound();
  const [review, handoffs, tasks] = await Promise.all([
    db.reviewItem.count({ where: { status: "open" } }),
    db.handoff.count({ where: { acknowledgedAt: null, blocked: false } }),
    db.task.count({ where: { status: { in: ["todo", "in_progress"] }, dueAt: { lte: new Date() } } }),
  ]);
  const counts = { review, handoffs, tasks };
  return (
    <Hub
      eyebrow={`Workspace · ${s.label}`}
      title={s.label}
      sub={s.blurb}
      cards={s.items.map((it) => {
        const n = it.count ? counts[it.count] : 0;
        return { href: it.href, icon: it.icon, title: it.label, text: it.blurb, meta: n ? `${n} waiting` : undefined, alert: n > 0 };
      })}
    />
  );
}
