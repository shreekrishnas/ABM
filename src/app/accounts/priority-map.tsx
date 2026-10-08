import Link from "next/link";
import type { Tier } from "@prisma/client";
import { Avatar } from "@/components/ui";
import type { IntentLevel } from "@/components/v2";

interface Dot { id: string; name: string; tier: Tier | null; fit: number | null; intent: { score: number; level: IntentLevel; whyNow: string | null } | null }

const SIZE: Record<string, number> = { T1: 38, T2: 30, T3: 24 };
const QUAD = [
  { x: "right", y: "top", title: "Act now", sub: "Strong fit and buying signals", color: "var(--intent-hot)" },
  { x: "left", y: "top", title: "Signals, weaker fit", sub: "Check before investing", color: "var(--intent-warm)" },
  { x: "right", y: "bottom", title: "Great fit, quiet", sub: "Warm them up", color: "var(--accent-indigo)" },
  { x: "left", y: "bottom", title: "Park", sub: "Low fit, no signals", color: "var(--intent-cold)" },
] as const;

/** Companies placed by fit (across) and buying intent (up): where to spend time is the top-right. */
export function PriorityMap({ accounts }: { accounts: Dot[] }) {
  // Position, then nudge marks apart so two companies with near-equal scores never cover each other.
  const placed = accounts
    .filter((a) => a.fit != null && a.intent)
    .map((a) => ({ ...a, x: Math.min(90, Math.max(8, a.fit ?? 0)), y: Math.min(84, Math.max(10, a.intent!.score)) }))
    .sort((p, q) => q.y - p.y);
  for (let i = 1; i < placed.length; i++) {
    for (let j = 0; j < i; j++) {
      if (Math.abs(placed[i].x - placed[j].x) < 14 && Math.abs(placed[i].y - placed[j].y) < 8) placed[i].y = Math.max(4, placed[j].y - 9);
    }
  }
  const waiting = accounts.filter((a) => a.fit == null || !a.intent);
  return (
    <div className="glass-card-static read card-pad">
      <div className="relative" style={{ height: 520, marginLeft: 28, marginBottom: 26 }}>
        {/* quadrants */}
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 overflow-hidden" style={{ borderRadius: "1rem", border: "1px solid var(--border-subtle)" }}>
          {[QUAD[1], QUAD[0], QUAD[3], QUAD[2]].map((q, i) => (
            <div key={q.title} className="relative p-3" style={{ background: i === 1 ? "color-mix(in srgb, var(--intent-hot) 6%, transparent)" : i === 2 ? "transparent" : "var(--surface-card-header)", borderRight: i % 2 === 0 ? "1px dashed var(--border-default)" : undefined, borderBottom: i < 2 ? "1px dashed var(--border-default)" : undefined }}>
              <div className={`absolute ${q.y === "top" ? "top-3" : "bottom-3"} ${q.x === "right" ? "right-4 text-right" : "left-4"}`}>
                <div className="text-sm font-bold" style={{ color: q.color }}>{q.title}</div>
                <div className="muted text-xs">{q.sub}</div>
              </div>
            </div>
          ))}
        </div>
        {/* axes */}
        <div className="micro absolute" style={{ left: -28, top: "50%", transform: "rotate(-90deg) translateX(50%)", transformOrigin: "left top" }}>Buying intent ↑</div>
        <div className="micro absolute" style={{ bottom: -24, left: "50%", transform: "translateX(-50%)" }}>Fit with the seller →</div>
        {/* companies */}
        {placed.map((a) => {
          const s = SIZE[a.tier ?? "T3"];
          const { x, y } = a;
          const flip = x > 62; // label on the left near the right edge so it is never clipped
          return (
            <Link key={a.id} href={`/accounts/${a.id}`} title={a.intent!.whyNow ?? a.name} className={`group absolute flex items-center gap-1.5 ${flip ? "flex-row-reverse" : ""}`} style={{ left: `${x}%`, bottom: `${y}%`, transform: flip ? "translate(calc(-100% + 20px), 50%)" : "translate(-20px, 50%)", zIndex: Math.round(y) }}>
              <span className="rounded-full" style={{ boxShadow: a.intent!.level === "hot" ? "0 0 0 3px var(--surface-base), 0 0 0 5px var(--intent-hot)" : "0 0 0 3px var(--surface-base)" }}><Avatar name={a.name} id={a.id} size={s} round /></span>
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap transition-transform group-hover:-translate-y-0.5" style={{ background: "var(--surface-card-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-pill)" }}>{a.name}</span>
            </Link>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs secondary">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full" style={{ boxShadow: "0 0 0 2px var(--intent-hot)" }} /> Hot: signals converging</span>
        <span>Bigger mark = higher tier (T1 · T2 · T3)</span>
        {waiting.length > 0 && <span className="muted">Not on the map yet ({waiting.length}): {waiting.slice(0, 6).map((w, i) => <Link key={w.id} href={`/accounts/${w.id}`} className="hover:underline">{i ? ", " : ""}{w.name}</Link>)}{waiting.length > 6 ? "…" : ""}</span>}
      </div>
    </div>
  );
}
