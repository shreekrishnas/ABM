import Link from "next/link";
import { Check } from "lucide-react";
import { prospectTrack, MILESTONES, type TrackKind } from "@/lib/journey/track";
import { readIntent } from "@/lib/brain/intent";
import { withSeller } from "@/lib/seller";
import { Badge, Card, Empty, date } from "@/components/ui";

const KIND: Record<TrackKind, { label: string; color: string }> = {
  linkedin: { label: "LinkedIn", color: "#0A66C2" },
  email: { label: "Email", color: "#4F46E5" },
  brain: { label: "Brain", color: "#7C3AED" },
  engagement: { label: "Engagement", color: "#DB2777" },
  data: { label: "Data checks", color: "#0D9488" },
  people: { label: "People & reviews", color: "#B45309" },
};
const TONE = { good: "#10B981", bad: "#DC2626", wait: "#F59E0B", info: "#94A3B8" } as const;
const LEVEL = { hot: "#DC2626", warm: "#F59E0B", cold: "#64748B" } as const;

/** One person's whole journey with us: milestones, what is pulling them in, and every touchpoint. */
export async function ProspectTrack({ contactId, accountId, sellerId, filter }: { contactId: string; accountId: string; sellerId: string; filter?: string }) {
  const [t, intent] = await Promise.all([prospectTrack(contactId), withSeller(sellerId, () => readIntent(accountId, new Date(), contactId))]);
  const kind = filter && filter in KIND ? (filter as TrackKind) : null;
  const items = kind ? t.items.filter((i) => i.kind === kind) : t.items;
  const base = `/people/${contactId}`;

  return (
    <Card title="Prospect journey" sub={`${t.daysInSystem} day${t.daysInSystem === 1 ? "" : "s"} with us · now at ${t.current}${t.firstTouch ? ` · first touch ${date(t.firstTouch)}` : " · not contacted yet"}`}>
      <ol className="mb-4 flex flex-wrap items-center gap-1.5" aria-label="Milestones">
        {MILESTONES.map((m, i) => {
          const done = t.reached[m];
          const here = m === t.current;
          return (
            <li key={m} className="flex items-center gap-1.5">
              <span className="badge" aria-current={here ? "step" : undefined} style={{ background: done ? (here ? "rgba(99,102,241,0.16)" : "rgba(16,185,129,0.12)") : "var(--surface-card-header)", color: done ? (here ? "#4338CA" : "#047857") : "var(--text-tertiary, #94A3B8)", border: here ? "1px solid #6366F1" : "1px solid transparent" }}>
                {done && !here && <Check size={11} className="mr-1 inline" />}{m}
              </span>
              {i < MILESTONES.length - 1 && <span className="muted text-xs" aria-hidden>›</span>}
            </li>
          );
        })}
      </ol>

      <div className="mb-4 rounded-xl px-3 py-3" style={{ background: "var(--surface-card-header)" }}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <b style={{ color: "var(--text-primary)" }}>Buying intent</b>
          <Badge color={LEVEL[intent.level]} dot>{intent.level} · {intent.score}</Badge>
          <span className="muted text-xs">{intent.explain}</span>
        </div>
        {intent.whyNow && <p className="secondary mt-2 text-sm"><b style={{ color: "var(--text-primary)" }}>Why now:</b> {intent.whyNow}</p>}
        {intent.signals.length > 0 && (
          <ul className="mt-2 grid gap-1 text-xs">
            {intent.signals.slice(0, 6).map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mono shrink-0" style={{ color: s.strength < 0 ? "#DC2626" : "#059669", minWidth: 34 }}>{s.strength < 0 ? "−" : "+"}{Math.round(Math.abs(s.strength) * 100)}</span>
                <span className="muted shrink-0" style={{ minWidth: 92 }}>{s.family.replace("_", " ")}</span>
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
