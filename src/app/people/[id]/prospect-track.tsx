import Link from "next/link";
import { prospectTrack, MILESTONES, type TrackKind } from "@/lib/journey/track";
import { readIntent } from "@/lib/brain/intent";
import { withSeller } from "@/lib/seller";
import { Card, Empty, date } from "@/components/ui";
import { FamilyChip, IntentPill, Stepper } from "@/components/v2";

const KIND: Record<TrackKind, { label: string; color: string }> = {
  linkedin: { label: "LinkedIn", color: "#0A66C2" },
  email: { label: "Email", color: "#4F46E5" },
  brain: { label: "Brain", color: "#7C3AED" },
  engagement: { label: "Engagement", color: "#DB2777" },
  data: { label: "Data checks", color: "#0D9488" },
  people: { label: "People & reviews", color: "#B45309" },
};
const TONE = { good: "#10B981", bad: "#DC2626", wait: "#F59E0B", info: "#94A3B8" } as const;

/** One person's whole journey with us: milestones, what is pulling them in, and every touchpoint. */
export async function ProspectTrack({ contactId, accountId, sellerId, filter }: { contactId: string; accountId: string; sellerId: string; filter?: string }) {
  const [t, intent] = await Promise.all([prospectTrack(contactId), withSeller(sellerId, () => readIntent(accountId, new Date(), contactId))]);
  const kind = filter && filter in KIND ? (filter as TrackKind) : null;
  const items = kind ? t.items.filter((i) => i.kind === kind) : t.items;
  const base = `/people/${contactId}`;

  return (
    <Card className="read" title="Prospect journey" sub={`${t.daysInSystem} day${t.daysInSystem === 1 ? "" : "s"} with us · now at ${t.current}${t.firstTouch ? ` · first touch ${date(t.firstTouch)}` : " · not contacted yet"}`}>
      <div className="mb-4"><Stepper steps={MILESTONES} reached={t.reached} current={t.current} /></div>

      <div className="mb-4 rounded-2xl px-4 py-3" style={{ background: "var(--surface-card-header)", border: "1px solid var(--border-subtle)" }}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <b style={{ color: "var(--text-primary)" }}>Buying intent</b>
          <IntentPill level={intent.level} score={intent.score} title={intent.explain} />
          {intent.families.map((f) => <FamilyChip key={f} family={f} />)}
        </div>
        {intent.whyNow && <p className="secondary mt-2 text-sm"><b style={{ color: "var(--text-primary)" }}>Why now:</b> {intent.whyNow}</p>}
        {intent.signals.length > 0 && (
          <ul className="mt-2 grid gap-1 text-xs">
            {intent.signals.slice(0, 6).map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mono shrink-0" style={{ color: s.strength < 0 ? "#DC2626" : "#059669", minWidth: 34 }}>{s.strength < 0 ? "−" : "+"}{Math.round(Math.abs(s.strength) * 100)}</span>
                <span className="shrink-0" style={{ minWidth: 104 }}><FamilyChip family={s.family} /></span>
                <span className="secondary">{s.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter the journey">
        <Link role="tab" aria-selected={!kind} href={base} className="badge" style={{ border: `1px solid ${!kind ? "#6366F1" : "transparent"}` }}>All {t.items.length}</Link>
        {(Object.keys(KIND) as TrackKind[]).filter((k) => t.counts[k]).map((k) => (
          <Link key={k} role="tab" aria-selected={kind === k} href={`${base}?track=${k}`} className="badge" style={{ color: KIND[k].color, border: `1px solid ${kind === k ? KIND[k].color : "transparent"}` }}>{KIND[k].label} {t.counts[k]}</Link>
        ))}
      </div>

      {items.length === 0 ? <Empty title="Nothing here yet" /> : (
        <ul className="timeline">
          {items.slice(0, 150).map((i, n) => (
            <li key={n} className="tl-item" style={{ ["--tl" as string]: TONE[i.tone] }}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm">
                  <span className="mr-1.5 text-[0.68rem] font-semibold uppercase tracking-wide" style={{ color: KIND[i.kind].color }}>{KIND[i.kind].label}</span>
                  <b style={{ color: "var(--text-primary)" }}>{i.href ? <Link href={i.href} className="hover:underline">{i.title}</Link> : i.title}</b>
                  {i.detail && <div className="secondary mt-0.5 whitespace-pre-wrap text-xs">{i.detail}</div>}
                </span>
                <span className="mono muted whitespace-nowrap text-xs">{date(i.at)}{i.by ? ` · ${i.by}` : ""}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
